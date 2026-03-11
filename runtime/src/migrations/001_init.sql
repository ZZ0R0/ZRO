-- ZRO v3 Initial Schema
-- Applied automatically at runtime startup.

-- Sessions utilisateur
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    username    TEXT NOT NULL,
    role        TEXT NOT NULL,
    groups      TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- État UI persisté par app (state:save / state:restore)
CREATE TABLE IF NOT EXISTS app_states (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    app_slug    TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, app_slug, key)
);
CREATE INDEX IF NOT EXISTS idx_app_states_lookup ON app_states(user_id, app_slug);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL,
    is_revoked  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);

-- Active windows (desktop persistence for the Shell/WM)
CREATE TABLE IF NOT EXISTS active_windows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    app_slug    TEXT NOT NULL,
    window_id   TEXT NOT NULL,
    position_x  INTEGER,
    position_y  INTEGER,
    width       INTEGER,
    height      INTEGER,
    is_minimized INTEGER NOT NULL DEFAULT 0,
    is_maximized INTEGER NOT NULL DEFAULT 0,
    z_index     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, window_id)
);
CREATE INDEX IF NOT EXISTS idx_active_windows_session ON active_windows(session_id);

-- JWT blacklist (revoked tokens before expiration)
CREATE TABLE IF NOT EXISTS jwt_blacklist (
    jti         TEXT PRIMARY KEY,
    expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_expires ON jwt_blacklist(expires_at);
