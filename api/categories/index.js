import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listCategories, createCategory, updateOrDeleteCategory } from '../../lib/routes/categories.js';

// Single static file, dispatching on ?id= in the query string rather than
// on path segments -- see api/auth/index.js for why.
export default withApi(async (req, res) => {
  const { id } = req.query;
  const user = await requireUser(req);

  if (id) {
    return updateOrDeleteCategory(user, id, req, res);
  }

  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return listCategories(user, req, res);
  return createCategory(user, req, res);
});
