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

-- Added after the initial table existed on already-deployed databases, so
-- CREATE TABLE IF NOT EXISTS alone wouldn't add these to a live install --
-- ALTER ... ADD COLUMN IF NOT EXISTS is the idempotent form that does.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

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

-- Historical backfill (syncing more than just the most recent watermark
-- forward) walks backward from backfill_before_uid toward UID 1 in bounded
-- batches -- fetching thousands of full message bodies can't happen in one
-- 60s serverless invocation, so this tracks resumable progress across many
-- sync calls. sync_mailbox records which mailbox path last_uid/
-- backfill_before_uid are actually counted against (IMAP UIDs are
-- mailbox-scoped, not global) -- if the detected sync source changes (e.g.
-- an account synced under the old INBOX-only behavior now has an All Mail
-- folder available), the next sync sees the mismatch and resets both
-- watermarks instead of comparing UIDs from two different numbering spaces.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sync_mailbox TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS backfill_before_uid INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS backfill_complete BOOLEAN NOT NULL DEFAULT false;

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

-- True arbitrary-depth tree (superseded the one-level group_name column
-- below, which couldn't express "sub-sub-categories"). ON DELETE SET NULL
-- rather than CASCADE: deleting a parent promotes its children to
-- top-level instead of wiping out an entire branch.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- One-time, idempotent migration: turn every existing flat group_name
-- string into a real parent category row, so data from before the tree
-- model existed doesn't just vanish. Cheap no-op on every run after the
-- first, since by then no row has group_name set anymore.
DO $$
DECLARE
  r RECORD;
  parent_id_var TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'group_name') THEN
    FOR r IN SELECT DISTINCT user_id, group_name FROM categories WHERE group_name IS NOT NULL LOOP
      SELECT id INTO parent_id_var FROM categories
        WHERE user_id = r.user_id AND name = r.group_name AND parent_id IS NULL AND group_name IS NULL
        LIMIT 1;
      IF parent_id_var IS NULL THEN
        -- md5(random + clock) rather than gen_random_uuid(): this file's
        -- whole point is not depending on any Postgres extension or
        -- version-gated builtin, and every Postgres version has these.
        parent_id_var := 'cat-' || md5(random()::text || clock_timestamp()::text);
        INSERT INTO categories (id, user_id, name, color, icon, is_builtin, sort_order)
          VALUES (parent_id_var, r.user_id, r.group_name, '#6366f1', 'folder', false, 0);
      END IF;
      UPDATE categories SET parent_id = parent_id_var WHERE user_id = r.user_id AND group_name = r.group_name;
    END LOOP;
  END IF;
END $$;

ALTER TABLE categories DROP COLUMN IF EXISTS group_name;

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
-- A rule can act on arrival beyond just categorizing -- mirrors Gmail's
-- "Delete it" / "Mark as read" filter actions. category_id is already
-- nullable, so a rule can be delete-only or mark-read-only with no label.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS mark_trashed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS mark_seen BOOLEAN NOT NULL DEFAULT false;

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

-- IMAP UIDs are scoped to a single mailbox, so the same physical email gets
-- a *different* uid depending on which mailbox it was fetched from (e.g.
-- INBOX vs Gmail's All Mail). UNIQUE(account_id, uid, mailbox) above only
-- catches literal re-fetches from the same mailbox; this catches the same
-- email arriving via two different mailboxes (which happens whenever an
-- account's sync source changes) using message_id, which is stable
-- regardless of which mailbox a message is fetched from. Partial (only
-- when message_id is present) since not every message has one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_account_msgid
  ON messages(account_id, message_id) WHERE message_id IS NOT NULL;
