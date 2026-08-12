import { withApi, methodGuard } from '../../lib/http.js';
import { clearSessionCookie } from '../../lib/auth.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});
