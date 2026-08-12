import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listAccounts, createAccount } from '../../lib/routes/accounts.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req);
  if (req.method === 'GET') return listAccounts(user, req, res);
  return createAccount(user, req, res);
});
