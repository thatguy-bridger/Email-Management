import crypto from 'crypto';
import { query } from './db.js';

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// A starting point, not a fixed taxonomy -- "Primary" is the only category
// the app depends on (it's the per-user fallback when no rule matches). The
// rest are ordinary editable/deletable rows, here just to show what a rule
// looks like on a brand-new account.
const STARTER_CATEGORIES = [
  { name: 'Primary', color: '#6366f1', icon: 'inbox', is_builtin: true },
  { name: 'Receipts', color: '#22c55e', icon: 'receipt', is_builtin: false },
  { name: 'Newsletters', color: '#f59e0b', icon: 'newspaper', is_builtin: false },
  { name: 'Travel', color: '#06b6d4', icon: 'plane', is_builtin: false },
];

const STARTER_RULES = [
  { catName: 'Receipts', name: 'Receipts by subject', field: 'subject', operator: 'contains', value: 'receipt', priority: 10 },
  { catName: 'Receipts', name: 'Invoices by subject', field: 'subject', operator: 'contains', value: 'invoice', priority: 10 },
  { catName: 'Newsletters', name: 'Newsletter by subject', field: 'subject', operator: 'contains', value: 'newsletter', priority: 5 },
  { catName: 'Travel', name: 'Flight confirmations', field: 'subject', operator: 'contains', value: 'itinerary', priority: 5 },
];

export async function seedDefaultCategoriesForUser(userId) {
  const categoryIdByName = {};
  let sortOrder = 0;
  for (const c of STARTER_CATEGORIES) {
    const id = newId('cat');
    categoryIdByName[c.name] = id;
    await query(
      `INSERT INTO categories (id, user_id, name, color, icon, is_builtin, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, userId, c.name, c.color, c.icon, c.is_builtin, sortOrder++]
    );
  }
  for (const r of STARTER_RULES) {
    await query(
      `INSERT INTO rules (id, user_id, name, field, operator, value, category_id, priority, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
      [newId('rule'), userId, r.name, r.field, r.operator, r.value, categoryIdByName[r.catName], r.priority]
    );
  }
}
