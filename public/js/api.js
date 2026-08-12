const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // api.onUnauthorized is app.js's hook for "the session cookie expired
    // mid-use, bounce back to the sign-in gate." It no-ops harmlessly during
    // boot's initial /auth/me check and during login/signup failures too --
    // app.js only acts on it when state.user is already set, i.e. this
    // wasn't an expected 401.
    if (res.status === 401 && typeof api.onUnauthorized === 'function') api.onUnauthorized();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Every backend route dispatches on ?id=/?action= in the query string now,
// not on path segments -- see api/auth/index.js server-side for why.
export const api = {
  onUnauthorized: null,

  // auth
  me: () => request('/auth?action=me'),
  signup: (payload) => request('/auth?action=signup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/auth?action=login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request('/auth?action=logout', { method: 'POST' }),
  changePassword: (payload) => request('/auth?action=password', { method: 'POST', body: JSON.stringify(payload) }),
  deleteMyAccount: (password) => request('/auth?action=me', { method: 'DELETE', body: JSON.stringify({ password }) }),

  // accounts
  listAccounts: () => request('/accounts'),
  testAccount: (payload) => request('/accounts?action=test', { method: 'POST', body: JSON.stringify(payload) }),
  createAccount: (payload) => request('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (id, payload) => request(`/accounts?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAccount: (id) => request(`/accounts?id=${id}`, { method: 'DELETE' }),
  syncAccount: (id) => request(`/accounts?id=${id}&action=sync`, { method: 'POST' }),

  // messages
  listMessages: (params) => request(`/messages?${new URLSearchParams(params)}`),
  getMessage: (id) => request(`/messages?id=${id}`),
  updateMessage: (id, payload) => request(`/messages?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // categories
  listCategories: () => request('/categories'),
  createCategory: (payload) => request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id, payload) => request(`/categories?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCategory: (id) => request(`/categories?id=${id}`, { method: 'DELETE' }),

  // rules
  listRules: () => request('/rules'),
  createRule: (payload) => request('/rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateRule: (id, payload) => request(`/rules?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRule: (id) => request(`/rules?id=${id}`, { method: 'DELETE' }),
  reapplyRules: () => request('/rules?action=reapply', { method: 'POST' }),

  // stats
  getStats: () => request('/stats'),
};
