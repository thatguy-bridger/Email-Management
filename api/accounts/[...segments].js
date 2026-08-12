import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { testAccount, updateOrDeleteAccount, syncAccountRoute } from '../../lib/routes/accounts.js';

// [...segments].js (single bracket, required) rather than [[...segments]].js
// (optional, double bracket) -- Vercel's generic function routing only
// supports the required form outside of Next.js, so this only ever
// receives 1+ path segments; the zero-segment case (/api/accounts itself)
// is handled by index.js instead.
export default withApi(async (req, res) => {
  const segments = req.query.segments || [];

  // /api/accounts/test needs auth but no specific account row.
  if (segments.length === 1 && segments[0] === 'test') {
    await requireUser(req);
    if (!methodGuard(req, res, ['POST'])) return;
    return testAccount(req, res);
  }

  const user = await requireUser(req);

  if (segments.length === 1) {
    return updateOrDeleteAccount(user, segments[0], req, res);
  }

  if (segments.length === 2 && segments[1] === 'sync') {
    return syncAccountRoute(user, segments[0], req, res);
  }

  throw new HttpError(404, 'Not found');
});
