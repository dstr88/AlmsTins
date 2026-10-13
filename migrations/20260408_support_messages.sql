-- Support messages — simple per-user thread between users and admin.
-- from_admin = 0 means the user sent it; 1 means the admin replied.
CREATE TABLE IF NOT EXISTS support_messages (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  tenant_id    TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  from_admin   INTEGER NOT NULL DEFAULT 0,
  read_at      TEXT,                        -- NULL = unread
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS support_messages_user_id ON support_messages(user_id);
CREATE INDEX IF NOT EXISTS support_messages_created_at ON support_messages(created_at);
