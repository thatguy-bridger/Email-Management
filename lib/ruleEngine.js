// Front-and-center replacement for Gmail's buried filter settings: rules are
// plain "field operator value -> category (+ optional delete/mark-read)"
// records, evaluated in priority order, first match wins. No nested
// filter/label graph to reason about.

function fieldValue(message, field) {
  switch (field) {
    case 'from':
      return `${message.from_name || ''} ${message.from_email || ''}`.toLowerCase();
    case 'domain':
      return (message.from_email || '').toLowerCase().split('@')[1] || '';
    case 'to':
      return (message.to_json || [])
        .map((t) => `${t.name || ''} ${t.address || ''}`)
        .join(' ')
        .toLowerCase();
    case 'subject':
      return (message.subject || '').toLowerCase();
    case 'body':
      return (message.body_text || message.snippet || '').toLowerCase();
    default:
      return '';
  }
}

function matches(value, operator, target) {
  const t = target.toLowerCase();
  switch (operator) {
    case 'contains':
      return value.includes(t);
    case 'equals':
      return value === t;
    case 'starts_with':
      return value.startsWith(t);
    case 'ends_with':
      return value.endsWith(t);
    default:
      return false;
  }
}

// `rules` should already be sorted by priority descending; ties keep
// insertion order so the UI's rule list order is a legitimate tiebreaker.
// Returns the whole matched rule row (so callers can read category_id,
// mark_trashed, mark_seen off it) rather than just a category id, since a
// rule's effect on arriving mail isn't only "assign a category" anymore.
export function findMatchingRule(message, rules) {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = fieldValue(message, rule.field);
    if (matches(value, rule.operator, rule.value)) {
      return rule;
    }
  }
  return null;
}
