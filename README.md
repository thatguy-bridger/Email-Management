# Mail

A self-hosted email viewer that syncs real IMAP accounts and sorts mail with
front-and-center, user-editable rules instead of buried filters/labels.
Design language (glassmorphism, floating pill topbar, gradient headings,
accent palettes, light/dark themes) mirrors the School Dashboard app.

Built for [Vercel](https://vercel.com): the frontend is static files in
`/public`, the backend is serverless functions in `/api`, storage is
Postgres, and periodic sync runs on Vercel Cron.

## How it's organized

- **Home** — dashboard: unread/needs-reply/flagged counts, per-category
  breakdown, per-account sync status, recent mail.
- **Inbox** — message list + reading pane. A category rail sits right above
  the list (always visible, one click to filter), and every message row has
  a "Sort into…" dropdown — the sorting UI Gmail hides behind Settings ▸
  Filters is the primary surface here instead.
- **Categories** — category cards (color-coded, message counts) and the rule
  builder that drives them: `field operator value → category`, evaluated in
  priority order, first match wins. Editing a rule only affects new mail
  until you hit "Reapply to existing mail."
- **Accounts** — connect/manage IMAP accounts, manual "Sync now," per-account
  status/error.
- **Settings** — theme (light/dark/system) and accent palette.

## Why Postgres instead of SQLite

Serverless functions don't have a persistent filesystem between invocations
— `/tmp` is wiped on cold start — so anything written to a local SQLite file
would vanish. All state (accounts, messages, categories, rules) lives in
Postgres instead.

## Setup

1. **Database.** In the Vercel dashboard: Storage → Create → Postgres, and
   connect it to this project. That injects `POSTGRES_URL` automatically —
   nothing else to configure. (Any other Postgres host works too; just set
   `DATABASE_URL` yourself.)

2. **Encryption key.** IMAP passwords are the one sensitive thing this app
   stores, so they're encrypted at rest (AES-256-GCM) with a key that lives
   only in an env var, never in the database:
   ```
   openssl rand -hex 32
   ```
   Set the result as `ENCRYPTION_KEY` in the Vercel project's environment
   variables.

3. **(Optional) Cron protection.** Set `CRON_SECRET` to a random string in
   the same place. Vercel automatically sends it as a bearer token when it
   invokes `/api/cron/sync`, so anyone else hitting that URL gets rejected.

4. **Deploy.**
   ```
   npm install
   npx vercel deploy
   ```
   or connect the GitHub repo in the Vercel dashboard for automatic deploys.

5. **Local dev.** `vercel dev` runs the functions and static site together;
   point `DATABASE_URL` at a local or hosted Postgres (a free
   [Neon](https://neon.tech) database works well for this).

## Connecting an account

Go to **Accounts → Add Account**, pick a provider, and enter an
**app-specific password** — not your normal login password:

- **iCloud Mail** — Apple ID settings → Sign-In and Security → App-Specific
  Passwords.
- **Gmail** — requires 2-Step Verification on, then Google Account →
  Security → App passwords.
- **Yahoo / Fastmail / other IMAP** — most providers with 2FA have an
  equivalent "app password" setting; enter the server's IMAP host/port
  directly under "Other."

**Outlook.com / Office 365 isn't supported yet.** Microsoft retired
plain-password IMAP login in 2024–2025; connecting those accounts needs an
OAuth flow (a registered Azure app, consent screen, token refresh) that
isn't implemented in this version. Everything else above uses standard
password-based IMAP and works today.

## How sync works

- Each account tracks the highest IMAP UID it has already fetched
  (`last_uid`). A sync fetches only messages newer than that — bounded and
  fast, which matters because it runs inside a serverless function with a
  hard time limit (`vercel.json` sets 60s for the sync routes).
- A brand-new account has no watermark yet, so its first sync backfills the
  most recent 50 messages instead of the entire mailbox.
- **Automatic:** `vercel.json` schedules `/api/cron/sync` (default: every 6
  hours) to sync every connected account. Hobby-plan projects may restrict
  cron frequency — check current limits on your plan and adjust the
  schedule.
- **Manual:** the "Sync all accounts" button on Home and the sync icon next
  to each account in Accounts always work on demand, regardless of plan or
  cron schedule.
- Threading is header-based (`References`/`In-Reply-To`), not a proprietary
  thread ID — it works across providers but won't exactly match Gmail's own
  thread grouping for Gmail-originated threads.

## Security notes

- IMAP passwords are encrypted (AES-256-GCM) before being stored; the key
  never touches the database.
- HTML email bodies are rendered with scripts, styles, iframes, and inline
  event handlers stripped, and remote images blocked — this is a
  single-user personal tool, not a hardened multi-tenant mail client, so
  treat it accordingly if you expose it beyond yourself.
- There's no login/auth layer on the API routes in this version — anyone
  who can reach your deployment URL can reach your mail. If you deploy this
  somewhere reachable by more than just you, put it behind Vercel's
  [password protection](https://vercel.com/docs/deployment-protection) (or
  add real auth) before connecting a real account.
