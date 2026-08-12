import { withAuth } from '../../lib/withAuth.js';
import { methodGuard } from '../../lib/http.js';

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;
  res.status(200).json({ user: req.user });
});
