import { query } from '../../../lib/db.js';
import { runAccountSync } from '../../../lib/runSync.js';
import { withApi, methodGuard, HttpError } from '../../../lib/http.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;
  const { id } = req.query;

  const { rows } = await query('SELECT * FROM accounts WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Account not found');

  const result = await runAccountSync(rows[0]);
  res.status(200).json(result);
});
