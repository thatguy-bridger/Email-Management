import { withApi, HttpError } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { updateOrDeleteRule, reapplyRules } from '../../lib/routes/rules.js';

// [...segments].js (required catch-all, 1+ segments) -- see
// api/accounts/[...segments].js for why this isn't [[...segments]].js.
export default withApi(async (req, res) => {
  const segments = req.query.segments || [];
  const user = await requireUser(req);

  if (segments.length === 1 && segments[0] === 'reapply') {
    return reapplyRules(user, req, res);
  }

  if (segments.length === 1) {
    return updateOrDeleteRule(user, segments[0], req, res);
  }

  throw new HttpError(404, 'Not found');
});
