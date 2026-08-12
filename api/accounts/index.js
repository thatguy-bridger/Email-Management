import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listAccounts, createAccount, testAccount, updateOrDeleteAccount, syncAccountRoute } from '../../lib/routes/accounts.js';

// Single static file, dispatching on ?id= and ?action= in the query string
// rather than on path segments -- see api/auth/index.js for why. URLs this
// project's own frontend used to call (/api/accounts/:id/sync etc.) are
// gone; public/js/api.js was updated alongside this to match.
export default withApi(async (req, res) => {
  const { id, action } = req.query;

  if (action === 'test') {
    await requireUser(req);
    if (!methodGuard(req, res, ['POST'])) return;
    return testAccount(req, res);
  }

  const user = await requireUser(req);

  if (id && action === 'sync') {
    return syncAccountRoute(user, id, req, res);
  }

  if (id) {
    return updateOrDeleteAccount(user, id, req, res);
  }

  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return listAccounts(user, req, res);
  return createAccount(user, req, res);
});
