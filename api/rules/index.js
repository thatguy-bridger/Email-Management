import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listRules, createRule } from '../../lib/routes/rules.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req);
  if (req.method === 'GET') return listRules(user, req, res);
  return createRule(user, req, res);
});
