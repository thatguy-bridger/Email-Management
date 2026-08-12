# Mail

A self-hosted email viewer that syncs real IMAP accounts and sorts mail with
front-and-center, user-editable rules instead of buried filters/labels.
Design language (glassmorphism, floating pill topbar, gradient headings,
accent palettes, light/dark themes) mirrors the School Dashboard app.

Built for [Vercel](https://vercel.com): the frontend is static files in
`/public`, the backend is serverless functions in `/api`, storage is
Postgres, and periodic sync runs on Vercel Cron.

`/api` has exactly one static file per *resource* (`accounts`, `auth`,
`categories`, `messages`, `rules`, plus standalone `stats` and
`cron/sync`) — 7 functions total, not one per route (which would have been
17+). Each file dispatches internally on `?id=` and `?action=` in the
**query string**, not on the URL path — e.g. renaming a category is
`PATCH /api/categories?id=cat-123`, not `PATCH /api/categories/cat-123`.
Route logic lives in `lib/routes/*.js`; the files under `/api` are thin
dispatchers.

That's a deliberate, load-bearing choice, not a style preference. Vercel's
Hobby plan caps a deployment at 12 Serverless Functions, and getting fewer
files per resource means using *some* form of dynamic routing to still
handle `/api/accounts/:id`, `/api/accounts/:id/sync`, etc. from one file.
Two different attempts at that failed in real deployment despite passing
locally every time: first `[[...segments]].js` (Next.js's *optional*
catch-all — not recognized by Vercel's generic, non-Next.js function
routing at all), then `[...segments].js` (the *required* form, which
should be supported per Vercel's own docs but still produced identical
404s in production). Query-string dispatch sidesteps the question
entirely — it's parsed identically by every HTTP server regardless of
platform or framework, so there's nothing left to get wrong. If you're
extending this project, keep using this pattern rather than reintroducing
`[param]`-style dynamic route files.

## How it's organized

- **Home** — dashboard: unread/needs-reply/flagged counts, per-category
  breakdown, per-account sync status, recent mail. The stat tiles are
  clickable and jump straight into a pre-filtered Inbox.
- **Inbox** — message list + reading pane, 50 messages a page with a "Load
  more" button for older mail. A category rail sits right above the list
  (always visible, one click to filter), and every message row has a "Sort
  into…" dropdown — the sorting UI Gmail hides behind Settings ▸ Filters is
  the primary surface here instead. An "Unread only" toggle and "Mark all as
  read" sit next to the mailbox tabs. Checkboxes on each row bring up a bulk
  action bar (mark read / archive / trash several at once). Opening a
  message that's part of a conversation shows the whole thread stacked
  oldest-first, not just the one message.
- **Categories** — an arbitrary-depth tree (color-coded, message counts),
  not just Gmail's one-level nested labels: a category can have
  sub-categories, which can have their own sub-sub-categories, and so on.
  Each row collapses/expands independently (state persisted per-browser),
  and starts collapsed below the top level specifically so a large imported
  label tree doesn't dump everything on screen at once. Drag one category
  onto another to nest it there — the row you drop *onto* becomes a parent
  ("head") category. Only leaf categories (no sub-categories of their own)
  can hold mail: nesting something under a category that currently holds
  messages or rules directly asks for confirmation first, then uncategorizes
  those messages and removes/adjusts those rules, since a parent category
  is purely organizational from that point on. Every place a category gets
  picked (this page's parent-category field, a rule's category, an Inbox
  row's "Sort into…") uses the same collapsible tree popover instead of a
  flat list — the rule/Inbox pickers only let you select leaf categories,
  while the parent-category field allows any category (parents can nest
  under other parents). Every picker also has an inline "+ New category" —
  type a name and it's created and selected on the spot, no need to back out
  to "+ New Category" separately. Below the tree, the rule builder:
  `field operator value → category`, evaluated in
  priority order, first match wins. A rule's category is optional if it
  also does something automatic — delete on arrival, mark as read on
  arrival, or both (Gmail's filter actions, minus "star"/"important" which
  have no equivalent here). Editing a rule only affects new mail until you
  hit "Reapply to existing mail" (and reapply only ever touches
  categorization — it never retroactively deletes or marks old mail read).
  **Import Gmail filters**: paste the plain-text listing from Gmail's
  Settings → Filters and Blocked Addresses page (select all, copy) and it's
  parsed into categories + rules automatically — sender/domain lists
  (`OR`/comma-separated) become one rule per address pointing at the same
  category, "Delete it"/"Mark as read" become the automatic actions above,
  and duplicate rules (including near-duplicates already in Gmail's own
  export) are skipped. Filters with no usable sender/subject signal, or no
  actionable instruction, are skipped and listed after import so nothing
  silently vanishes.
- **Accounts** — connect/manage IMAP accounts, rename/recolor an existing
  one, manual "Sync now," per-account status/error.
- **Settings** — account (change password, sign out, delete account), theme
  (light/dark/system), accent palette.

## Accounts and sign-in

This is a real multi-user app, not a single shared inbox: anyone can create
an account (email + password) at the sign-in screen, and every mail account,
category, and rule they add is scoped to them — one person's data is never
visible to another. Sessions are an HttpOnly signed cookie (30-day expiry),
passwords are hashed with scrypt (Node's built-in, salted, no plaintext ever
stored). There's no invite/approval step — whoever reaches the sign-up form
can create a login — so if you don't want that, put the deployment behind
Vercel's [Deployment Protection](https://vercel.com/docs/deployment-protection)
as well.

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

3. **Auth secret.** Session cookies (sign-in state) are signed with a second,
   separate key — don't reuse `ENCRYPTION_KEY` for this:
   ```
   openssl rand -hex 32
   ```
   Set the result as `AUTH_SECRET`.

4. **(Optional) Cron protection.** Set `CRON_SECRET` to a random string in
   the same place. Vercel automatically sends it as a bearer token when it
   invokes `/api/cron/sync`, so anyone else hitting that URL gets rejected.

5. **Deploy.**
   ```
   npm install
   npx vercel deploy
   ```
   or connect the GitHub repo in the Vercel dashboard for automatic deploys.

6. **Local dev.** `vercel dev` runs the functions and static site together;
   point `DATABASE_URL` at a local or hosted Postgres (a free
   [Neon](https://neon.tech) database works well for this).

## Custom domain (mail.bridgerjones.com)

1. In the Vercel project → **Settings → Domains**, add `mail.bridgerjones.com`.
2. Vercel shows you a DNS record to create — for a subdomain like this it's
   almost always a **CNAME** record: `mail` → `cname.vercel-dns.com`. (If it
   asks for an A record instead, use the IP it shows you.)
3. Go to wherever `bridgerjones.com`'s DNS is managed (your registrar, or
   Cloudflare/etc. if you've delegated DNS there) and add that record.
4. Back in Vercel, wait for the domain to show **Valid Configuration** — DNS
   propagation is usually minutes, occasionally longer. Vercel issues the
   TLS certificate automatically once it verifies.

This is a one-time action you have to take in your DNS provider's dashboard
— I don't have access to that account to do it for you.

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
- **Automatic:** `vercel.json` schedules `/api/cron/sync` once a day (13:00
  UTC) to sync every connected account. That's not a stylistic choice —
  Vercel's **Hobby plan caps Cron Jobs at once per day**; anything more
  frequent gets rejected at project-creation/deploy time. If you're on Pro
  (or upgrade later), you can tighten this to e.g. `"0 */2 * * *"` for every
  2 hours.
- **Manual:** the "Sync all accounts" button on Home and the sync icon next
  to each account in Accounts always work on demand, regardless of plan or
  cron schedule — this is the one to lean on for anything more frequent
  than daily while on Hobby.
- Threading is header-based (`References`/`In-Reply-To`), not a proprietary
  thread ID — it works across providers but won't exactly match Gmail's own
  thread grouping for Gmail-originated threads.

## Why views don't flash to a spinner every time

Switching to a view you've already loaded this session (e.g. Inbox → Home →
Inbox with the same filters) keeps showing what was already on screen and
refreshes it quietly in the background instead of wiping to a spinner and
re-fetching from scratch — a thin progress bar at the top of the page is the
only sign a refresh is happening. Only a genuinely new view (first visit, or
switching mailbox/category/search) clears and shows a spinner, since there's
nothing valid to keep showing yet. The topbar logo doubles as a manual
refresh button for the current view if you want to force a re-fetch (e.g.
after mail lands from an account synced outside this browser tab).

## Security notes

- IMAP passwords are encrypted (AES-256-GCM) before being stored; the key
  never touches the database.
- Account passwords are hashed with scrypt + a random salt, never stored in
  plaintext or logged.
- Every API route (except sign-up/sign-in themselves) requires a valid
  session and scopes all queries to `req.user.id` — one user's accounts,
  mail, categories, and rules are not reachable by another user's session,
  even by guessing IDs (verified: cross-user reads/writes return 404).
- HTML email bodies are rendered with scripts, styles, iframes, and inline
  event handlers stripped, and remote images blocked.
- Login is rate-limited: 5 wrong passwords locks that account for 15
  minutes (checked before the password itself, so a correct password
  during a lockout still doesn't get in). Only counted against emails that
  actually exist, so lockout timing can't be used to enumerate accounts.
- Settings lets you change your password (requires the current one) and
  permanently delete your account (requires your password as confirmation)
  — deleting cascades to every mail account, message, category, and rule
  you own via the existing foreign keys.
- If your session cookie expires mid-use, the app notices on the next API
  call and bounces you back to the sign-in screen instead of leaving
  broken views around.
- This still isn't a hardened, audited multi-tenant mail client — it's a
  personal project with real auth, not a SOC2 product. There's still no
  email-verification step on sign-up in this version. If that matters for
  your deployment, add it before relying on this for anything sensitive.
