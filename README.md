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
  clickable and jump straight into a pre-filtered Inbox. The category
  breakdown starts collapsed behind a one-line "N categories" summary
  (expand state remembered) instead of listing every one flat — the same
  reasoning as the Categories page tree.
- **Inbox** — a single full-width message list (50 messages a page with a
  "Load more" button for older mail), not a list-plus-reading-pane split.
  Clicking a message opens it in a modal instead — thread messages (if it's
  part of a conversation) stack oldest-first inside it, with flag/archive/
  trash actions right there, and closing it (the × button, or click outside)
  drops you right back on the list. An "All" chip plus a single "Filter by
  category" dropdown (the same collapsible tree popover used elsewhere) sit
  above the list — not one chip per category, which stopped being usable
  past a couple dozen. Every message row has a
  "Sort into…" dropdown — the sorting UI Gmail hides behind Settings ▸
  Filters is the primary surface here instead. An "Unread only" toggle and
  "Mark all as read" sit next to the mailbox tabs. Checkboxes on each row
  bring up a bulk action bar (mark read / archive / trash several at once).
  Unread mail gets a colored left edge matching its category (not a fixed
  color) so unread state and category are both visible at a glance; already
  categorized-uncategorized unread mail falls back to the accent color.
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
  to "+ New Category" separately. A checkbox on every non-Primary row
  enables mass selection — the bulk bar that appears can move every selected
  category under a new parent in one go (same "would demote the target"
  confirmation as a single drag) or delete them all at once. Below the tree, the rule builder: rules
  are grouped into a collapsible dropdown per target category (collapsed by
  default, same reasoning as the tree above) instead of one long flat list
  — a 70-rule Gmail import is unreadable any other way. Grouping is purely
  a display convenience; evaluation order is unaffected; it's still
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

- Each account syncs from the broadest mailbox its provider exposes: Gmail's
  "All Mail" (every message, archived included) if the server reports it via
  the IMAP SPECIAL-USE extension, else a real "Archive" folder if one exists,
  else falls back to INBOX. Whether a message counts as inbox vs. archived
  locally comes from Gmail's `\Inbox` label (via the `X-GM-EXT-1` extension)
  when syncing from All Mail, from folder membership when syncing from a
  dedicated Archive folder, or is always "inbox" when there's no special-use
  folder at all.
- Each account tracks the highest IMAP UID it has already fetched
  (`last_uid`), scoped to whichever mailbox it's currently syncing from
  (`sync_mailbox`) — IMAP UIDs are only meaningful within a single mailbox,
  so switching sync source (e.g. the first time an All Mail folder becomes
  available) resets the watermark instead of comparing UIDs from two
  different numbering spaces. New mail past that watermark is always fetched
  in full on every sync — bounded and fast, which matters because sync runs
  inside a serverless function with a hard time limit (`vercel.json` sets 60s
  for the sync routes).
- A brand-new account has no watermark yet, so its first sync immediately
  fetches the most recent 50 messages, then starts backfilling everything
  older than that in the background.
- **Backfill:** older mail (potentially thousands of messages) can't fit in
  one 60s sync call, so it's pulled in 150-message chunks walking backward
  from the initial watermark toward the oldest message — but rather than
  stopping after one chunk, a sync call keeps pulling further-back chunks
  until it's spent a ~30s time budget (leaving margin under the 60s hard
  limit), so a fast connection with modestly-sized mail gets through many
  chunks per call instead of just one. Each call persists how far it's
  gotten (`backfill_before_uid`/`backfill_complete`), so it resumes
  correctly across calls instead of restarting, and never advances past a
  chunk it didn't fully finish. While an account is still catching up, Home
  and the Accounts page both show a live "Backfilling… 1,240 / ~5,000"
  readout (the total is an estimate off the mailbox's highest known UID, not
  an exact count — see the `backfill_total_estimate` column comment in
  schema.sql); a chain of sync calls runs automatically in the background
  for as long as you're signed in — not only while the Accounts page happens
  to be open — instead of making you click "Sync now" repeatedly. (Cron
  alone would otherwise only advance backfill once a day on the Hobby plan;
  the in-app chain is what actually gets a large archive fully synced in a
  reasonable time.)
- Messages are inserted in batches (multiple rows per DB round trip, not one
  round trip per message) — with thousands of messages fetched in a single
  backfill call, that was the main remaining bottleneck once fetching itself
  sped up.
- Messages are deduplicated on `(account_id, uid, mailbox)` for straight
  re-syncs, and additionally on `(account_id, message_id)` to catch the same
  email arriving under a different UID when the sync source mailbox changes.
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

## "What's new" popup

Signing in (fresh login or an already-valid session loading the app) checks a
`CHANGELOG` array in `public/js/app.js` against the highest entry id you've
already seen (tracked in `localStorage`) and shows a dismissible popup
listing every entry you haven't — not just the latest one, so nothing gets
skipped if you haven't opened the app in a while. It's marked seen the
moment it's shown, not only on an explicit "Got it" click, so however you
close it, it won't show again until a new entry is added. To ship a new
one: append `{ id: <next number>, date: '...', items: [...] }` to
`CHANGELOG`.

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
