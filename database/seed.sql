USE lumen_db;

-- Safe to rerun: skips movies with the same title and release date.
-- This script does not delete or update existing movie records.

INSERT INTO movies (
    title,
    country_of_origin,
    genre,
    duration_minutes,
    language,
    description,
    release_date,
    status,
    release_status
)
SELECT
    seed.title,
    seed.country_of_origin,
    seed.genre,
    seed.duration_minutes,
    seed.language,
    seed.description,
    seed.release_date,
    seed.status,
    seed.release_status
FROM (
    SELECT
        'Jailer 2' AS title,
        'India' AS country_of_origin,
        'Action, Thriller' AS genre,
        165 AS duration_minutes,
        'Tamil, Telugu' AS language,
        'Retired jailer Tiger Muthuvel Pandian returns to action when a new criminal threat endangers his family and legacy.' AS description,
        '2026-10-15' AS release_date,
        'ACTIVE' AS status,
        'NOW_SHOWING' AS release_status

    UNION ALL SELECT
        'Drishyam The Conclusion', 'India',
        'Drama, Mystery, Thriller', 150, 'Hindi',
        'Vijay Salgaonkar and his family face renewed pressure when a determined Crime Branch officer threatens to reopen a past murder case.',
        '2026-10-02', 'ACTIVE', 'NOW_SHOWING'

    UNION ALL SELECT
        'Udta Teer', 'India',
        'Action, Comedy', 137, 'Hindi',
        'A spy mission spirals into comic chaos in a world where everyone appears to have a secret.',
        '2026-10-23', 'ACTIVE', 'NOW_SHOWING'

    UNION ALL SELECT
        'Pehla Pyaar Doosri Baar', 'India',
        'Comedy, Romance', 142, 'Hindi',
        'Ten years after school, three friends attend a reunion hoping to confess their feelings to their first crushes.',
        '2026-10-23', 'ACTIVE', 'NOW_SHOWING'

    UNION ALL SELECT
        'Clayface', 'USA',
        'Horror, Thriller', NULL, 'English',
        'A disfigured aspiring actor seeks an experimental treatment that restores his appearance but undermines his grip on reality and drives him toward revenge.',
        '2026-10-21', 'ACTIVE', 'NOW_SHOWING'

    UNION ALL SELECT
        'Namit Malhotra''s Ramayana', 'India',
        'Action, Adventure, Mythological', 195, 'Hindi, Multilingual',
        'A cinematic adaptation of the epic Ramayana, depicting the story of Rama, Sita and Ravana.',
        '2026-11-05', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'King', 'India',
        'Action, Thriller', NULL, 'Hindi',
        'Upcoming action thriller starring Shah Rukh Khan and Suhana Khan. The detailed official plot synopsis has not been released.',
        '2026-12-24', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Love & War', 'India',
        'Drama, Romance', NULL, 'Hindi',
        'A film directed by Sanjay Leela Bhansali starring Ranbir Kapoor, Alia Bhatt and Vicky Kaushal. Detailed plot information remains limited.',
        '2027-01-21', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Varanasi', 'India',
        'Action, Adventure, Fantasy', NULL, 'Telugu',
        'An upcoming action-adventure directed by S. S. Rajamouli, starring Mahesh Babu, Priyanka Chopra Jonas and Prithviraj Sukumaran.',
        '2027-04-07', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'The Hunger Games: Sunrise on the Reaping', 'USA',
        'Action, Adventure, Sci-Fi', NULL, 'English',
        'Twenty-four years before Katniss Everdeen''s story, young Haymitch Abernathy competes in the 50th Hunger Games.',
        '2026-11-20', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Avengers: Doomsday', 'USA',
        'Action, Adventure, Sci-Fi', NULL, 'English',
        'Heroes from three distinct universes face an existential threat in the next major Avengers instalment.',
        '2026-12-18', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Dune: Part Three', 'USA',
        'Sci-Fi, Adventure, Drama', NULL, 'English',
        'The next instalment in Denis Villeneuve''s Dune film series. Detailed official plot information remains limited.',
        '2026-12-18', 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Godzilla Minus Zero', 'Japan',
        'Action, Sci-Fi', NULL, 'Japanese',
        'Two years after Godzilla Minus One, Japan struggles to recover from war before a new threat endangers its fragile peace.',
        NULL, 'ACTIVE', 'UPCOMING'

    UNION ALL SELECT
        'Spider-Man: Beyond the Spider-Verse', 'USA',
        'Animation, Action, Adventure', NULL, 'English',
        'Miles Morales is hunted by the Spider Society and searches for a way home while trying to protect his endangered family.',
        '2027-06-18', 'ACTIVE', 'UPCOMING'
) AS seed
WHERE NOT EXISTS (
    SELECT 1
    FROM movies AS existing
    WHERE existing.title = seed.title
      AND existing.release_date <=> seed.release_date
);