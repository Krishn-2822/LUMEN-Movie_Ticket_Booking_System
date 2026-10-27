from decimal import Decimal

from flask import Flask, jsonify, render_template, request

from db import get_db_connection


app = Flask(__name__)


# --------------------------------------------------
# 1. HEALTH CHECK
# --------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "application": "LUMEN",
        "status": "ok"
    }), 200


# --------------------------------------------------
# 2. HOMEPAGE
# --------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html")


# --------------------------------------------------
# 3. GET MOVIES
# --------------------------------------------------

@app.route("/api/movies", methods=["GET"])
def get_movies():
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                movie_id, title, country_of_origin, genre,
                duration_minutes, language, description,
                poster_url, release_date, release_status
            FROM movies
            WHERE status = 'ACTIVE'
            ORDER BY (release_date IS NULL), release_date, title
        """)

        movies = cursor.fetchall()

        for movie in movies:
            if movie["release_date"] is not None:
                movie["release_date"] = (
                    movie["release_date"].isoformat()
                )

        return jsonify({"movies": movies}), 200

    except Exception:
        app.logger.exception("Failed to retrieve movies")
        return jsonify(error="Could not retrieve movies"), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


# --------------------------------------------------
# 4. RELEASE EXPIRED HOLDS
# Must be called inside a transaction while the
# corresponding showtime row is locked.
# --------------------------------------------------

def release_expired_holds(cursor, showtime_id):
    cursor.execute("""
        SELECT DISTINCT booking_id
        FROM showtime_seats
        WHERE showtime_id = %s
          AND status = 'HELD'
          AND hold_expires_at <= NOW()
          AND booking_id IS NOT NULL
    """, (showtime_id,))

    expired_ids = [
        row["booking_id"] for row in cursor.fetchall()
    ]

    for booking_id in expired_ids:
        cursor.execute("""
            UPDATE bookings
            SET booking_status = 'EXPIRED'
            WHERE booking_id = %s
              AND showtime_id = %s
              AND booking_status = 'PENDING'
        """, (booking_id, showtime_id))

        cursor.execute("""
            UPDATE payments
            SET payment_status = 'FAILED'
            WHERE booking_id = %s
              AND payment_status = 'PENDING'
        """, (booking_id,))

        cursor.execute("""
            UPDATE showtime_seats
            SET status = 'AVAILABLE',
                booking_id = NULL,
                hold_expires_at = NULL
            WHERE booking_id = %s
              AND showtime_id = %s
              AND status = 'HELD'
              AND hold_expires_at <= NOW()
        """, (booking_id, showtime_id))


# --------------------------------------------------
# 5. GET SHOWTIMES
# Returns scheduled showtimes with movie, screen, and cinema details.
# --------------------------------------------------

@app.route("/api/showtimes", methods=["GET"])
def get_showtimes():
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                st.showtime_id,
                st.start_time,
                st.end_time,
                st.ticket_price,
                st.status AS showtime_status,

                m.movie_id,
                m.title AS movie_title,
                m.genre,
                m.duration_minutes,
                m.language,
                m.release_date,

                s.screen_id,
                s.screen_name,
                s.auditorium_tier,
                s.screen_aspect_ratio,

                c.cinema_id,
                c.cinema_name,
                c.city

            FROM showtimes AS st
            JOIN movies AS m
                ON st.movie_id = m.movie_id
            JOIN screens AS s
                ON st.screen_id = s.screen_id
            JOIN cinemas AS c
                ON s.cinema_id = c.cinema_id

            WHERE st.status = 'SCHEDULED'
              AND m.status = 'ACTIVE'
              AND c.status = 'ACTIVE'

            ORDER BY st.start_time ASC
        """)

        showtimes = cursor.fetchall()

        for showtime in showtimes:
            if showtime["start_time"] is not None:
                showtime["start_time"] = showtime["start_time"].isoformat(sep=" ")
            if showtime["end_time"] is not None:
                showtime["end_time"] = showtime["end_time"].isoformat(sep=" ")

            showtime["ticket_price"] = str(showtime["ticket_price"])
            showtime["release_date"] = (
                showtime["release_date"].isoformat()
                if showtime["release_date"] is not None
                else None
            )

        return jsonify({"showtimes": showtimes}), 200

    except Exception:
        app.logger.exception("Failed to retrieve showtimes")
        return jsonify(error="Could not retrieve showtimes"), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


# --------------------------------------------------
# 6. GET SEAT AVAILABILITY
# Also cleans up expired holds when this endpoint
# is requested.
# --------------------------------------------------

@app.route(
    "/api/showtimes/<int:showtime_id>/seats",
    methods=["GET"]
)
def get_showtime_seats(showtime_id):
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        connection.start_transaction()

        # Serialize expiry cleanup and reservations.
        cursor.execute("""
            SELECT showtime_id
            FROM showtimes
            WHERE showtime_id = %s
              AND status = 'SCHEDULED'
            FOR UPDATE
        """, (showtime_id,))

        if cursor.fetchone() is None:
            connection.rollback()
            return jsonify(error="Showtime not found"), 404

        release_expired_holds(cursor, showtime_id)

        cursor.execute("""
            SELECT
                ss.seat_id,
                s.seat_number,
                s.seat_type,
                ss.status,
                ss.ticket_price
            FROM showtime_seats AS ss
            JOIN seats AS s ON s.seat_id = ss.seat_id
            WHERE ss.showtime_id = %s
            ORDER BY s.seat_number
        """, (showtime_id,))

        rows = cursor.fetchall()

        result = [{
            "seat_id": row["seat_id"],
            "seat_number": row["seat_number"],
            "seat_type": row["seat_type"],
            "status": row["status"],
            "ticket_price": str(row["ticket_price"])
        } for row in rows]

        connection.commit()

        return jsonify({
            "showtime_id": showtime_id,
            "seats": result
        }), 200

    except Exception:
        if connection is not None and connection.is_connected():
            connection.rollback()

        app.logger.exception("Failed to retrieve seat availability")
        return jsonify(error="Could not retrieve seats"), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


# --------------------------------------------------
# 7. CREATE A TEMPORARY BOOKING
# Seats are HELD for 10 minutes, not confirmed yet.
# --------------------------------------------------

@app.route("/api/bookings/hold", methods=["POST"])
def hold_booking_seats():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="A JSON request body is required"), 400

    user_id = data.get("user_id")
    showtime_id = data.get("showtime_id")
    seat_ids = data.get("seat_ids")

    if (
        type(user_id) is not int or user_id <= 0
        or type(showtime_id) is not int or showtime_id <= 0
    ):
        return jsonify(error="Invalid customer or showtime ID"), 400

    if (
        not isinstance(seat_ids, list)
        or not 1 <= len(seat_ids) <= 8
        or any(type(seat_id) is not int or seat_id <= 0
               for seat_id in seat_ids)
    ):
        return jsonify(error="Choose between 1 and 8 valid seat IDs"), 400

    if len(set(seat_ids)) != len(seat_ids):
        return jsonify(error="Duplicate seat IDs"), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        connection.start_transaction()

        cursor.execute("""
            SELECT user_id
            FROM users
            WHERE user_id = %s AND role = 'CUSTOMER'
        """, (user_id,))

        if cursor.fetchone() is None:
            connection.rollback()
            return jsonify(error="Customer not found"), 404

        # All reservations for this showtime use the same
        # lock, preventing simultaneous competing bookings.
        cursor.execute("""
            SELECT showtime_id
            FROM showtimes
            WHERE showtime_id = %s
              AND status = 'SCHEDULED'
              AND start_time > NOW()
            FOR UPDATE
        """, (showtime_id,))

        if cursor.fetchone() is None:
            connection.rollback()
            return jsonify(error="Showtime unavailable"), 404

        release_expired_holds(cursor, showtime_id)

        placeholders = ", ".join(["%s"] * len(seat_ids))
        ordered_ids = sorted(seat_ids)

        cursor.execute(f"""
            SELECT seat_id, status, ticket_price
            FROM showtime_seats
            WHERE showtime_id = %s
              AND seat_id IN ({placeholders})
            ORDER BY seat_id
            FOR UPDATE
        """, tuple([showtime_id] + ordered_ids))

        seats = cursor.fetchall()

        if len(seats) != len(seat_ids):
            connection.rollback()
            return jsonify(error="Invalid seat for this showtime"), 400

        unavailable = [
            seat["seat_id"] for seat in seats
            if seat["status"] != "AVAILABLE"
        ]

        if unavailable:
            # Preserve expired-hold cleanup even though this
            # particular reservation attempt was rejected.
            connection.commit()
            return jsonify(
                error="One or more seats are unavailable",
                unavailable_seat_ids=unavailable
            ), 409

        total = sum(
            (seat["ticket_price"] for seat in seats),
            Decimal("0.00")
        )

        cursor.execute("""
            INSERT INTO bookings (
                user_id, showtime_id, total_amount, booking_status
            )
            VALUES (%s, %s, %s, 'PENDING')
        """, (user_id, showtime_id, total))

        booking_id = cursor.lastrowid

        cursor.execute(f"""
            UPDATE showtime_seats
            SET status = 'HELD',
                booking_id = %s,
                hold_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
            WHERE showtime_id = %s
              AND seat_id IN ({placeholders})
              AND status = 'AVAILABLE'
        """, tuple([booking_id, showtime_id] + ordered_ids))

        if cursor.rowcount != len(seat_ids):
            raise RuntimeError("Could not reserve every requested seat")

        cursor.executemany("""
            INSERT INTO booking_seats (
                booking_id, seat_id, ticket_price
            )
            VALUES (%s, %s, %s)
        """, [
            (booking_id, seat["seat_id"], seat["ticket_price"])
            for seat in seats
        ])

        cursor.execute("""
            INSERT INTO payments (
                booking_id, amount, payment_method, payment_status
            )
            VALUES (%s, %s, 'SIMULATED', 'PENDING')
        """, (booking_id, total))

        payment_id = cursor.lastrowid

        cursor.execute("""
            SELECT MAX(hold_expires_at) AS expires_at
            FROM showtime_seats
            WHERE booking_id = %s AND showtime_id = %s
        """, (booking_id, showtime_id))

        expires_at = cursor.fetchone()["expires_at"]

        connection.commit()

        return jsonify({
            "message": "Seats held; payment is pending",
            "booking_id": booking_id,
            "payment_id": payment_id,
            "showtime_id": showtime_id,
            "seat_ids": ordered_ids,
            "total_amount": format(total, ".2f"),
            "booking_status": "PENDING",
            "hold_expires_at": (
                expires_at.isoformat() if expires_at else None
            )
        }), 201

    except Exception:
        if connection is not None and connection.is_connected():
            connection.rollback()

        app.logger.exception("Failed to hold seats")
        return jsonify(error="Reservation failed"), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


# --------------------------------------------------
# 8. SIMULATED PAYMENT RESULT
# This is for the DBMS demonstration, not real payments.
# --------------------------------------------------

@app.route(
    "/api/bookings/<int:booking_id>/payment-result",
    methods=["POST"]
)
def process_payment_result(booking_id):
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="A JSON request body is required"), 400

    result = data.get("result")

    if result not in ("SUCCESS", "FAILED"):
        return jsonify(error="Result must be SUCCESS or FAILED"), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        connection.start_transaction()

        # Find the associated showtime before taking locks.
        cursor.execute("""
            SELECT showtime_id
            FROM bookings
            WHERE booking_id = %s
        """, (booking_id,))

        booking_ref = cursor.fetchone()

        if booking_ref is None:
            connection.rollback()
            return jsonify(error="Booking not found"), 404

        showtime_id = booking_ref["showtime_id"]

        # Keep the same lock order as the hold endpoint.
        cursor.execute("""
            SELECT showtime_id
            FROM showtimes
            WHERE showtime_id = %s
            FOR UPDATE
        """, (showtime_id,))

        if cursor.fetchone() is None:
            connection.rollback()
            return jsonify(error="Showtime not found"), 404

        release_expired_holds(cursor, showtime_id)

        cursor.execute("""
            SELECT booking_id, showtime_id, total_amount, booking_status
            FROM bookings
            WHERE booking_id = %s
            FOR UPDATE
        """, (booking_id,))

        booking = cursor.fetchone()

        if booking["booking_status"] != "PENDING":
            connection.commit()
            return jsonify({
                "error": "Booking is no longer awaiting payment",
                "booking_status": booking["booking_status"]
            }), 409

        cursor.execute("""
            SELECT payment_id
            FROM payments
            WHERE booking_id = %s
              AND payment_status = 'PENDING'
            ORDER BY payment_id DESC
            LIMIT 1
            FOR UPDATE
        """, (booking_id,))

        payment = cursor.fetchone()

        if payment is None:
            connection.rollback()
            return jsonify(error="Pending payment not found"), 409

        # Ensure all booking seats still have valid holds.
        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM booking_seats
            WHERE booking_id = %s
        """, (booking_id,))

        expected_seats = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM showtime_seats
            WHERE booking_id = %s
              AND showtime_id = %s
              AND status = 'HELD'
              AND hold_expires_at > NOW()
        """, (booking_id, showtime_id))

        held_seats = cursor.fetchone()["total"]

        if expected_seats == 0 or held_seats != expected_seats:
            cursor.execute("""
                UPDATE bookings
                SET booking_status = 'EXPIRED'
                WHERE booking_id = %s
                  AND booking_status = 'PENDING'
            """, (booking_id,))

            cursor.execute("""
                UPDATE payments
                SET payment_status = 'FAILED'
                WHERE booking_id = %s
                  AND payment_status = 'PENDING'
            """, (booking_id,))

            cursor.execute("""
                UPDATE showtime_seats
                SET status = 'AVAILABLE',
                    booking_id = NULL,
                    hold_expires_at = NULL
                WHERE booking_id = %s
                  AND showtime_id = %s
                  AND status = 'HELD'
            """, (booking_id, showtime_id))

            connection.commit()

            return jsonify(error="Seat hold has expired"), 409

        if result == "FAILED":
            cursor.execute("""
                UPDATE payments
                SET payment_status = 'FAILED'
                WHERE payment_id = %s
            """, (payment["payment_id"],))

            cursor.execute("""
                UPDATE bookings
                SET booking_status = 'PAYMENT_FAILED'
                WHERE booking_id = %s
            """, (booking_id,))

            # Release seats immediately on simulated failure.
            cursor.execute("""
                UPDATE showtime_seats
                SET status = 'AVAILABLE',
                    booking_id = NULL,
                    hold_expires_at = NULL
                WHERE booking_id = %s
                  AND showtime_id = %s
                  AND status = 'HELD'
            """, (booking_id, showtime_id))

            connection.commit()

            return jsonify({
                "message": "Payment failed; seats released",
                "booking_id": booking_id,
                "booking_status": "PAYMENT_FAILED",
                "payment_status": "FAILED"
            }), 200

        # Simulated success: confirm payment and booking.
        cursor.execute("""
            UPDATE payments
            SET payment_status = 'SUCCESS'
            WHERE payment_id = %s
        """, (payment["payment_id"],))

        cursor.execute("""
            UPDATE bookings
            SET booking_status = 'CONFIRMED'
            WHERE booking_id = %s
        """, (booking_id,))

        cursor.execute("""
            UPDATE showtime_seats
            SET status = 'BOOKED',
                hold_expires_at = NULL
            WHERE booking_id = %s
              AND showtime_id = %s
              AND status = 'HELD'
              AND hold_expires_at > NOW()
        """, (booking_id, showtime_id))

        if cursor.rowcount != expected_seats:
            raise RuntimeError("Could not confirm every reserved seat")

        connection.commit()

        return jsonify({
            "message": "Simulated payment successful",
            "booking_id": booking_id,
            "booking_status": "CONFIRMED",
            "payment_status": "SUCCESS"
        }), 200

    except Exception:
        if connection is not None and connection.is_connected():
            connection.rollback()

        app.logger.exception("Payment result processing failed")
        return jsonify(error="Could not process payment result"), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


if __name__ == "__main__":
    app.run(debug=True)