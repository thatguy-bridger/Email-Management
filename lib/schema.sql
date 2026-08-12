-- IDs are generated in application code with crypto.randomUUID() rather than
-- relying on a Postgres UUID default, so this works on any Postgres host
-- (Vercel/Neon, Supabase, plain RDS) without needing the pgcrypto extension.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  provider TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT true,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  last_uid INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT NOT NULL DEFAULT 'inbox',
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  message_id TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  from_name TEXT,
  from_email TEXT,
  to_json JSONB,
  subject TEXT,
  snippet TEXT,
  body_html TEXT,
  body_text TEXT,
  date TIMESTAMPTZ,
  seen BOOLEAN NOT NULL DEFAULT false,
  flagged BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  trashed BOOLEAN NOT NULL DEFAULT false,
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  category_locked BOOLEAN NOT NULL DEFAULT false,
  needs_reply BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, uid, mailbox)
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(seen);
