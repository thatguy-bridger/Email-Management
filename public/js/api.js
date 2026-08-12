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

export const api = {
  onUnauthorized: null,

  // auth
  me: () => request('/auth/me'),
  signup: (payload) => request('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (payload) => request('/auth/password', { method: 'POST', body: JSON.stringify(payload) }),
  deleteMyAccount: (password) => request('/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }),

  // accounts
  listAccounts: () => request('/accounts'),
  testAccount: (payload) => request('/accounts/test', { method: 'POST', body: JSON.stringify(payload) }),
  createAccount: (payload) => request('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (id, payload) => request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  syncAccount: (id) => request(`/accounts/${id}/sync`, { method: 'POST' }),

  // messages
  listMessages: (params) => request(`/messages?${new URLSearchParams(params)}`),
  getMessage: (id) => request(`/messages/${id}`),
  updateMessage: (id, payload) => request(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // categories
  listCategories: () => request('/categories'),
  createCategory: (payload) => request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id, payload) => request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  // rules
  listRules: () => request('/rules'),
  createRule: (payload) => request('/rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateRule: (id, payload) => request(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRule: (id) => request(`/rules/${id}`, { method: 'DELETE' }),
  reapplyRules: () => request('/rules/reapply', { method: 'POST' }),

  // stats
  getStats: () => request('/stats'),
};
