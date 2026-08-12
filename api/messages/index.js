import { withApi, methodGuard } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { listMessages, getOrUpdateMessage } from '../../lib/routes/messages.js';

// Single static file, dispatching on ?id= in the query string rather than
// on path segments -- see api/auth/index.js for why. The list endpoint
// already uses several other query params (mailbox/category/q/etc.); none
// of them are named "id", so there's no collision.
export default withApi(async (req, res) => {
  const { id } = req.query;
  const user = await requireUser(req);

  if (id) {
    return getOrUpdateMessage(user, id, req, res);
  }

  if (!methodGuard(req, res, ['GET'])) return;
  return listMessages(user, req, res);
});
