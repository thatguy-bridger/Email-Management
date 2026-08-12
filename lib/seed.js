import crypto from 'crypto';
import { query } from './db.js';

// Seeds a starting point, not a fixed taxonomy -- "Primary" is the only
// category the app depends on (it's the fallback when no rule matches).
// The rest are ordinary editable/deletable rows, here just to show what a
// rule looks like on first run.
const STARTER_CATEGORIES = [
  { id: 'cat-primary', name: 'Primary', color: '#6366f1', icon: 'inbox', is_builtin: true, sort_order: 0 },
  { id: 'cat-receipts', name: 'Receipts', color: '#22c55e', icon: 'receipt', is_builtin: false, sort_order: 1 },
  { id: 'cat-newsletters', name: 'Newsletters', color: '#f59e0b', icon: 'newspaper', is_builtin: false, sort_order: 2 },
  { id: 'cat-travel', name: 'Travel', color: '#06b6d4', icon: 'plane', is_builtin: false, sort_order: 3 },
];

const STARTER_RULES = [
  { id: 'rule-receipts-1', name: 'Receipts by subject', field: 'subject', operator: 'contains', value: 'receipt', category_id: 'cat-receipts', priority: 10 },
  { id: 'rule-receipts-2', name: 'Invoices by subject', field: 'subject', operator: 'contains', value: 'invoice', category_id: 'cat-receipts', priority: 10 },
  { id: 'rule-newsletters-1', name: 'Newsletter by subject', field: 'subject', operator: 'contains', value: 'newsletter', category_id: 'cat-newsletters', priority: 5 },
  { id: 'rule-travel-1', name: 'Flight confirmations', field: 'subject', operator: 'contains', value: 'itinerary', category_id: 'cat-travel', priority: 5 },
];

export async function seedDefaults() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM categories');
  if (rows[0].n > 0) return;

  for (const c of STARTER_CATEGORIES) {
    await query(
      `INSERT INTO categories (id, name, color, icon, is_builtin, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.color, c.icon, c.is_builtin, c.sort_order]
    );
  }
  for (const r of STARTER_RULES) {
    await query(
      `INSERT INTO rules (id, name, field, operator, value, category_id, priority, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name, r.field, r.operator, r.value, r.category_id, r.priority]
    );
  }
}

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
