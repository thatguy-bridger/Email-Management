const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
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
