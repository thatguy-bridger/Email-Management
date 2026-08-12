import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listCategories, createCategory } from '../../lib/routes/categories.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req);
  if (req.method === 'GET') return listCategories(user, req, res);
  return createCategory(user, req, res);
});
