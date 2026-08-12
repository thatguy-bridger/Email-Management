import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listRules, createRule, updateOrDeleteRule, reapplyRules } from '../../lib/routes/rules.js';
import { importGmailFilters } from '../../lib/gmailImport.js';

// Single static file, dispatching on ?id= and ?action= in the query string
// rather than on path segments -- see api/auth/index.js for why.
export default withApi(async (req, res) => {
  const { id, action } = req.query;
  const user = await requireUser(req);

  if (action === 'reapply') {
    return reapplyRules(user, req, res);
  }

  if (action === 'import') {
    return importGmailFilters(user, req, res);
  }

  if (id) {
    return updateOrDeleteRule(user, id, req, res);
  }

  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return listRules(user, req, res);
  return createRule(user, req, res);
});
