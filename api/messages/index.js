import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listMessages } from '../../lib/routes/messages.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;
  const user = await requireUser(req);
  return listMessages(user, req, res);
});
