-- Eseguito da Postgres solo al primo avvio, quando il volume dei dati è vuoto.
-- Le altre tabelle (live_matches, user_cards, user_decks) le crea il server da solo all'avvio.
-- Stesso schema di server/README.md.

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    elo         INTEGER DEFAULT 1200,
    created_at  TIMESTAMP DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    terms_version     INTEGER NOT NULL DEFAULT 0,
    terms_accepted_at TIMESTAMPTZ,
    hide_presence     BOOLEAN NOT NULL DEFAULT FALSE,
    bot_level         VARCHAR(16)  -- account dei bot (base, intermediate, advanced): nascosti dagli elenchi
);

CREATE TABLE IF NOT EXISTS games (
    id           SERIAL PRIMARY KEY,
    white_id     INTEGER REFERENCES users(id),
    black_id     INTEGER REFERENCES users(id),
    pgn          TEXT,
    result       VARCHAR(10),
    time_control VARCHAR(20),
    rated        BOOLEAN NOT NULL DEFAULT TRUE,
    played_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
