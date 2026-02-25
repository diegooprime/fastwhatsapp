package main

const appSchema = `
CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    push_name TEXT NOT NULL DEFAULT '',
    number TEXT NOT NULL DEFAULT '',
    is_group INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    is_group INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_msg_ts INTEGER,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    sender_jid TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    from_me INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL DEFAULT 0,
    has_media INTEGER NOT NULL DEFAULT 0,
    media_type TEXT,
    raw_proto BLOB
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, timestamp DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content=messages, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
    INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
);
`
