import { ensureSchema } from './db.js';

// Every handler needs the schema present and wants uniform JSON error
// handling; wrapping here keeps that out of each of the ~15 route files.
export function withApi(handler) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await handler(req, res);
    } catch (err) {
      console.error(err);
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message || 'Internal error' });
    }
  };
}

export function methodGuard(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return false;
  }
  return true;
}

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
