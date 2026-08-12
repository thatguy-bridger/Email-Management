import { query } from '../../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../../lib/http.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;
  const { id } = req.query;

  if (req.method === 'DELETE') {
    const { rowCount } = await query('DELETE FROM accounts WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Account not found');
    return res.status(204).end();
  }

  const { displayName, color } = req.body || {};
  const { rows } = await query(
    `UPDATE accounts SET
       display_name = COALESCE($2, display_name),
       color = COALESCE($3, color)
     WHERE id = $1
     RETURNING id, email, display_name, provider, imap_host, imap_port, imap_secure,
               username, color, last_synced_at, sync_status, sync_error, created_at`,
    // node-postgres rejects `undefined` params outright, so omitted body
    // fields (which destructure to undefined) have to become null before
    // they reach COALESCE.
    [id, displayName ?? null, color ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Account not found');
  res.status(200).json({ account: rows[0] });
});
