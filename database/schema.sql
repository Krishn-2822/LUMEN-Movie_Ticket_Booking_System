-- LUMEN database schema
-- MySQL 8.0+
-- Safe for initial setup: CREATE TABLE IF NOT EXISTS does not drop existing data.
-- Running this file recreates only the four named triggers; it does not drop tables.
-- Demo records belong in seed.sql, not in this file.

CREATE DATABASE IF NOT EXISTS lumen_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
USE lumen_db;

-- 1. Cinemas
CREATE TABLE IF NOT EXISTS cinemas (
    cinema_id INT NOT NULL AUTO_INCREMENT,
    cinema_name VARCHAR(150) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address VARCHAR(255) DEFAULT NULL,
    contact_number VARCHAR(30) DEFAULT NULL,
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cinema_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Movies
CREATE TABLE IF NOT EXISTS movies (
    movie_id INT NOT NULL AUTO_INCREMENT,
    title VARCHAR(150) NOT NULL,
    genre VARCHAR(80) DEFAULT NULL,
    duration_minutes INT DEFAULT NULL,
    language VARCHAR(50) DEFAULT NULL,
    description TEXT,
    poster_url VARCHAR(500) DEFAULT NULL,
    release_date DATE DEFAULT NULL,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
    country_of_origin VARCHAR(50) NOT NULL DEFAULT 'India',
    release_status ENUM('NOW_SHOWING', 'UPCOMING') NOT NULL DEFAULT 'UPCOMING',
    PRIMARY KEY (movie_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. Technology catalogue (2D/3D, IMAX, 4DX, Dolby Atmos, etc.)
CREATE TABLE IF NOT EXISTS technologies (
    technology_id INT NOT NULL AUTO_INCREMENT,
    technology_name VARCHAR(100) NOT NULL,
    category ENUM('PROJECTION', 'AUDIO', 'EXPERIENCE', 'PRESENTATION_FORMAT') NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (technology_id),
    UNIQUE KEY uq_technologies_name (technology_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. Users
CREATE TABLE IF NOT EXISTS users (
    user_id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('CUSTOMER', 'ADMIN') DEFAULT 'CUSTOMER',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. Screens belong to a cinema. Aspect ratio is independent of technologies.
CREATE TABLE IF NOT EXISTS screens (
    screen_id INT NOT NULL AUTO_INCREMENT,
    screen_name VARCHAR(100) NOT NULL,
    auditorium_tier VARCHAR(50) DEFAULT NULL,
    cinema_id INT NOT NULL,
    screen_aspect_ratio VARCHAR(12) DEFAULT NULL,
    PRIMARY KEY (screen_id),
    UNIQUE KEY uq_screens_cinema_name (cinema_id, screen_name),
    UNIQUE KEY uq_screens_id_cinema (screen_id, cinema_id),
    CONSTRAINT fk_screens_cinema
        FOREIGN KEY (cinema_id) REFERENCES cinemas (cinema_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. Physical seats within each screen
CREATE TABLE IF NOT EXISTS seats (
    seat_id INT NOT NULL AUTO_INCREMENT,
    screen_id INT NOT NULL,
    seat_number VARCHAR(10) NOT NULL,
    seat_type ENUM('REGULAR', 'PREMIUM') DEFAULT 'REGULAR',
    PRIMARY KEY (seat_id),
    UNIQUE KEY uq_seats_screen_number (screen_id, seat_number),
    UNIQUE KEY uq_seats_id_screen (seat_id, screen_id),
    CONSTRAINT fk_seats_screen
        FOREIGN KEY (screen_id) REFERENCES screens (screen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. Scheduled showings. The triggers below prevent time overlaps on one screen.
CREATE TABLE IF NOT EXISTS showtimes (
    showtime_id INT NOT NULL AUTO_INCREMENT,
    movie_id INT NOT NULL,
    screen_id INT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    ticket_price DECIMAL(10,2) NOT NULL,
    status ENUM('SCHEDULED', 'CANCELLED', 'COMPLETED') DEFAULT 'SCHEDULED',
    PRIMARY KEY (showtime_id),
    UNIQUE KEY uq_showtimes_screen_start (screen_id, start_time),
    UNIQUE KEY uq_showtimes_id_screen (showtime_id, screen_id),
    KEY idx_showtimes_movie (movie_id),
    CONSTRAINT fk_showtimes_movie
        FOREIGN KEY (movie_id) REFERENCES movies (movie_id),
    CONSTRAINT fk_showtimes_screen
        FOREIGN KEY (screen_id) REFERENCES screens (screen_id),
    CONSTRAINT chk_showtime_interval CHECK (end_time > start_time),
    CONSTRAINT chk_showtime_price CHECK (ticket_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 8. Booking header. PENDING means payment is not yet confirmed.
CREATE TABLE IF NOT EXISTS bookings (
    booking_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    showtime_id INT NOT NULL,
    booking_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    booking_status ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'PAYMENT_FAILED')
        NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (booking_id),
    UNIQUE KEY uq_bookings_id_showtime (booking_id, showtime_id),
    KEY idx_bookings_user (user_id),
    KEY idx_bookings_showtime (showtime_id),
    CONSTRAINT fk_bookings_user
        FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_bookings_showtime
        FOREIGN KEY (showtime_id) REFERENCES showtimes (showtime_id),
    CONSTRAINT chk_booking_total CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 9. Historical seat details for each booking
CREATE TABLE IF NOT EXISTS booking_seats (
    booking_id INT NOT NULL,
    seat_id INT NOT NULL,
    ticket_price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (booking_id, seat_id),
    KEY idx_booking_seats_seat (seat_id),
    CONSTRAINT fk_booking_seats_booking
        FOREIGN KEY (booking_id) REFERENCES bookings (booking_id),
    CONSTRAINT fk_booking_seats_seat
        FOREIGN KEY (seat_id) REFERENCES seats (seat_id),
    CONSTRAINT chk_booking_seat_price CHECK (ticket_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 10. Payment attempts/status. This project currently uses simulated payments.
CREATE TABLE IF NOT EXISTS payments (
    payment_id INT NOT NULL AUTO_INCREMENT,
    booking_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(40) NOT NULL DEFAULT 'SIMULATED',
    payment_status ENUM('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    transaction_reference VARCHAR(150) DEFAULT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_id),
    UNIQUE KEY uq_payments_transaction_reference (transaction_reference),
    KEY idx_payments_booking (booking_id),
    CONSTRAINT fk_payments_booking
        FOREIGN KEY (booking_id) REFERENCES bookings (booking_id),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 11. Technologies each screen supports
CREATE TABLE IF NOT EXISTS screen_technologies (
    screen_id INT NOT NULL,
    technology_id INT NOT NULL,
    PRIMARY KEY (screen_id, technology_id),
    KEY idx_screen_technologies_technology (technology_id),
    CONSTRAINT fk_screen_technologies_screen
        FOREIGN KEY (screen_id) REFERENCES screens (screen_id) ON DELETE CASCADE,
    CONSTRAINT fk_screen_technologies_technology
        FOREIGN KEY (technology_id) REFERENCES technologies (technology_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 12. Technologies used by a particular showing
CREATE TABLE IF NOT EXISTS showtime_technologies (
    showtime_id INT NOT NULL,
    technology_id INT NOT NULL,
    PRIMARY KEY (showtime_id, technology_id),
    KEY idx_showtime_technologies_technology (technology_id),
    CONSTRAINT fk_showtime_technologies_showtime
        FOREIGN KEY (showtime_id) REFERENCES showtimes (showtime_id),
    CONSTRAINT fk_showtime_technologies_technology
        FOREIGN KEY (technology_id) REFERENCES technologies (technology_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 13. Live inventory: exactly one row per seat for each showtime.
CREATE TABLE IF NOT EXISTS showtime_seats (
    showtime_id INT NOT NULL,
    screen_id INT NOT NULL,
    seat_id INT NOT NULL,
    status ENUM('AVAILABLE', 'HELD', 'BOOKED') NOT NULL DEFAULT 'AVAILABLE',
    booking_id INT DEFAULT NULL,
    hold_expires_at DATETIME DEFAULT NULL,
    ticket_price DECIMAL(10,2) NOT NULL,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (showtime_id, seat_id),
    KEY idx_showtime_seats_showtime_screen (showtime_id, screen_id),
    KEY idx_showtime_seats_seat_screen (seat_id, screen_id),
    KEY idx_showtime_seats_booking_showtime (booking_id, showtime_id),
    CONSTRAINT fk_showtime_seats_showtime_screen
        FOREIGN KEY (showtime_id, screen_id)
        REFERENCES showtimes (showtime_id, screen_id),
    CONSTRAINT fk_showtime_seats_seat_screen
        FOREIGN KEY (seat_id, screen_id)
        REFERENCES seats (seat_id, screen_id),
    CONSTRAINT fk_showtime_seats_booking_showtime
        FOREIGN KEY (booking_id, showtime_id)
        REFERENCES bookings (booking_id, showtime_id),
    CONSTRAINT chk_showtime_seat_status CHECK (
        (status = 'AVAILABLE' AND booking_id IS NULL AND hold_expires_at IS NULL)
        OR (status = 'HELD' AND booking_id IS NOT NULL AND hold_expires_at IS NOT NULL)
        OR (status = 'BOOKED' AND booking_id IS NOT NULL AND hold_expires_at IS NULL)
    ),
    CONSTRAINT chk_showtime_seat_price CHECK (ticket_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Triggers: definitions are included without a hard-coded DEFINER,
-- making this setup more portable across local MySQL accounts.

DROP TRIGGER IF EXISTS trg_showtime_technology_insert;
DROP TRIGGER IF EXISTS trg_showtime_technology_update;
DROP TRIGGER IF EXISTS trg_showtime_no_overlap_insert;
DROP TRIGGER IF EXISTS trg_showtime_no_overlap_update;

DELIMITER $$

CREATE TRIGGER trg_showtime_technology_insert
BEFORE INSERT ON showtime_technologies
FOR EACH ROW
BEGIN
    DECLARE v_screen_id INT DEFAULT NULL;
    DECLARE v_technology_name VARCHAR(100) DEFAULT NULL;

    SELECT screen_id INTO v_screen_id
    FROM showtimes
    WHERE showtime_id = NEW.showtime_id;

    SELECT technology_name INTO v_technology_name
    FROM technologies
    WHERE technology_id = NEW.technology_id;

    IF v_screen_id IS NULL OR v_technology_name IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Invalid showtime or technology';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM screen_technologies
        WHERE screen_id = v_screen_id
          AND technology_id = NEW.technology_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Screen does not support this technology';
    END IF;

    IF (
        v_technology_name = '2D'
        AND EXISTS (
            SELECT 1
            FROM showtime_technologies AS stt
            JOIN technologies AS t ON t.technology_id = stt.technology_id
            WHERE stt.showtime_id = NEW.showtime_id
              AND t.technology_name = '3D'
        )
    ) OR (
        v_technology_name = '3D'
        AND EXISTS (
            SELECT 1
            FROM showtime_technologies AS stt
            JOIN technologies AS t ON t.technology_id = stt.technology_id
            WHERE stt.showtime_id = NEW.showtime_id
              AND t.technology_name = '2D'
        )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A showtime cannot use both 2D and 3D';
    END IF;
END$$

CREATE TRIGGER trg_showtime_technology_update
BEFORE UPDATE ON showtime_technologies
FOR EACH ROW
BEGIN
    DECLARE v_screen_id INT DEFAULT NULL;
    DECLARE v_technology_name VARCHAR(100) DEFAULT NULL;

    SELECT screen_id INTO v_screen_id
    FROM showtimes
    WHERE showtime_id = NEW.showtime_id;

    SELECT technology_name INTO v_technology_name
    FROM technologies
    WHERE technology_id = NEW.technology_id;

    IF v_screen_id IS NULL OR v_technology_name IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Invalid showtime or technology';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM screen_technologies
        WHERE screen_id = v_screen_id
          AND technology_id = NEW.technology_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Screen does not support this technology';
    END IF;

    IF (
        v_technology_name = '2D'
        AND EXISTS (
            SELECT 1
            FROM showtime_technologies AS stt
            JOIN technologies AS t ON t.technology_id = stt.technology_id
            WHERE stt.showtime_id = NEW.showtime_id
              AND t.technology_name = '3D'
              AND NOT (
                  stt.showtime_id = OLD.showtime_id
                  AND stt.technology_id = OLD.technology_id
              )
        )
    ) OR (
        v_technology_name = '3D'
        AND EXISTS (
            SELECT 1
            FROM showtime_technologies AS stt
            JOIN technologies AS t ON t.technology_id = stt.technology_id
            WHERE stt.showtime_id = NEW.showtime_id
              AND t.technology_name = '2D'
              AND NOT (
                  stt.showtime_id = OLD.showtime_id
                  AND stt.technology_id = OLD.technology_id
              )
        )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A showtime cannot use both 2D and 3D';
    END IF;
END$$

CREATE TRIGGER trg_showtime_no_overlap_insert
BEFORE INSERT ON showtimes
FOR EACH ROW
BEGIN
    DECLARE v_screen_id INT DEFAULT NULL;
    DECLARE v_conflicts INT DEFAULT 0;

    IF NEW.status = 'SCHEDULED' THEN
        SELECT screen_id INTO v_screen_id
        FROM screens
        WHERE screen_id = NEW.screen_id
        FOR UPDATE;

        IF NEW.start_time IS NULL OR NEW.end_time IS NULL
           OR NEW.end_time <= NEW.start_time THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Show end time must be after its start time';
        END IF;

        SELECT COUNT(*) INTO v_conflicts
        FROM showtimes AS existing
        WHERE existing.screen_id = NEW.screen_id
          AND existing.status = 'SCHEDULED'
          AND existing.start_time < NEW.end_time
          AND existing.end_time > NEW.start_time;

        IF v_conflicts > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This screen already has an overlapping showtime';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_showtime_no_overlap_update
BEFORE UPDATE ON showtimes
FOR EACH ROW
BEGIN
    DECLARE v_screen_id INT DEFAULT NULL;
    DECLARE v_conflicts INT DEFAULT 0;

    IF NEW.status = 'SCHEDULED' THEN
        SELECT screen_id INTO v_screen_id
        FROM screens
        WHERE screen_id = NEW.screen_id
        FOR UPDATE;

        IF NEW.start_time IS NULL OR NEW.end_time IS NULL
           OR NEW.end_time <= NEW.start_time THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Show end time must be after its start time';
        END IF;

        SELECT COUNT(*) INTO v_conflicts
        FROM showtimes AS existing
        WHERE existing.screen_id = NEW.screen_id
          AND existing.status = 'SCHEDULED'
          AND existing.showtime_id <> OLD.showtime_id
          AND existing.start_time < NEW.end_time
          AND existing.end_time > NEW.start_time;

        IF v_conflicts > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This screen already has an overlapping showtime';
        END IF;
    END IF;
END$$

DELIMITER ;
