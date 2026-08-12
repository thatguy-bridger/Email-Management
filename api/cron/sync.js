import { query } from '../../lib/db.js';
import { runAccountSync } from '../../lib/runSync.js';
import { withApi, HttpError } from '../../lib/http.js';

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
// is set on the project -- this rejects everyone else so the sync endpoint
// can't be hit by a stranger who finds the URL. If CRON_SECRET isn't set
// yet (e.g. local dev), the check is skipped.
function assertAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  if (req.headers.authorization !== `Bearer ${secret}`) {
    throw new HttpError(401, 'Unauthorized');
  }
}

export default withApi(async (req, res) => {
  assertAuthorized(req);

  const { rows: accounts } = await query('SELECT * FROM accounts');
  const results = [];
  for (const account of accounts) {
    try {
      const r = await runAccountSync(account);
      results.push({ accountId: account.id, email: account.email, ...r });
    } catch (err) {
      results.push({ accountId: account.id, email: account.email, error: err.message });
    }
  }
  res.status(200).json({ results });
});
