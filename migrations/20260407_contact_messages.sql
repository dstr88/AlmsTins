-- Contact / FAQ question inbox
CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT    PRIMARY KEY NOT NULL,
  subject    TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  persisted  INTEGER NOT NULL DEFAULT 0,
  ip_hash    TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON contact_messages (created_at DESC);
