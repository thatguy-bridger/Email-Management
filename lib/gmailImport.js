import { query } from './db.js';
import { HttpError, methodGuard } from './http.js';
import { newId } from './seed.js';
import { demoteToParent } from './routes/categories.js';

// Parses the plain-text listing shown on Gmail's Settings > Filters and
// Blocked Addresses page (each filter renders as a "Matches: ..." line
// followed by a "Do this: ... editdelete" line) and turns it into this
// app's categories + rules. Built specifically against that export format,
// not a general Gmail search-syntax parser -- Gmail's filter search syntax
// is much larger than what filters actually use in practice, and the goal
// here is a safe, predictable import of the common cases, not full parity.

function parseEntries(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchesIdx = line.indexOf('Matches:');
    if (matchesIdx === -1) continue;
    const criteria = line.slice(matchesIdx + 'Matches:'.length).trim();
    let actionText = '';
    const next = lines[i + 1];
    if (next) {
      const doIdx = next.indexOf('Do this:');
      if (doIdx !== -1) {
        actionText = next
          .slice(doIdx + 'Do this:'.length)
          .replace(/editdelete\s*$/i, '')
          .trim();
        i++;
      }
    }
    entries.push({ criteria, actionText });
  }
  return entries;
}

function splitList(raw) {
  return raw
    .split(/\s+OR\s+|,/i)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// Returns an array of {field, operator, value} matchers -- a filter with
// multiple OR'd senders becomes multiple single-value rules pointing at the
// same category, since this app's rule engine matches one value per rule.
function parseCriteria(criteria, ownerEmail) {
  let matchers = [];

  const fromMatch = criteria.match(/from:\(([^)]*)\)/i);
  if (fromMatch) {
    for (const part of splitList(fromMatch[1])) {
      if (part.startsWith('@')) {
        matchers.push({ field: 'domain', operator: 'equals', value: part.slice(1).toLowerCase() });
      } else if (part.includes('@')) {
        matchers.push({ field: 'from', operator: 'contains', value: part.toLowerCase() });
      }
    }
    // "From my own address" as the *only* signal is too broad to safely
    // automate -- it would match anything the account owner ever sends
    // themselves. Drop it so a subject:()/bare criteria elsewhere in the
    // same filter can take over, or so the whole entry gets skipped.
    if (
      matchers.length === 1 &&
      matchers[0].field === 'from' &&
      ownerEmail &&
      matchers[0].value === ownerEmail.toLowerCase()
    ) {
      matchers = [];
    }
  }

  if (matchers.length === 0) {
    const subjectMatch = criteria.match(/subject:\(([^)]*)\)/i);
    if (subjectMatch) {
      for (const part of splitList(subjectMatch[1])) {
        matchers.push({ field: 'subject', operator: 'contains', value: part.toLowerCase() });
      }
    }
  }

  if (matchers.length === 0) {
    const bare = criteria.match(/^\(([^)]*)\)$/);
    if (bare) {
      for (const part of splitList(bare[1])) {
        matchers.push({ field: 'subject', operator: 'contains', value: part.toLowerCase() });
      }
    }
  }

  return matchers;
}

function parseAction(actionText) {
  if (!actionText) return null;
  const result = { categoryPath: null, trash: false, markSeen: false };
  const labelMatch = actionText.match(/Apply label "([^"]+)"/i);
  if (labelMatch) result.categoryPath = labelMatch[1];
  if (/Delete it/i.test(actionText)) result.trash = true;
  if (/Mark as read/i.test(actionText)) result.markSeen = true;
  // "Never mark it as important", "Star it", etc. have no equivalent here
  // and are silently ignored; if that was the *only* instruction, there's
  // nothing actionable left.
  if (!result.categoryPath && !result.trash && !result.markSeen) return null;
  return result;
}

const PALETTE = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#f97316', '#14b8a6', '#8b5cf6', '#ef4444'];

export async function importGmailFilters(user, req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const { text } = req.body || {};
  if (!text || !text.trim()) throw new HttpError(400, 'text is required');

  const entries = parseEntries(text);
  if (!entries.length) {
    throw new HttpError(400, "Couldn't find any \"Matches: ... / Do this: ...\" pairs in that text");
  }

  const { rows: existingCats } = await query('SELECT id, name, parent_id FROM categories WHERE user_id = $1', [
    user.id,
  ]);
  // Keyed by parentId + lowercased name, not the old slash-joined path, so
  // an import can find/reuse a category at any depth rather than just the
  // two levels group_name used to support.
  const categoryCache = new Map();
  for (const c of existingCats) {
    categoryCache.set(`${c.parent_id || ''}::${c.name.toLowerCase()}`, c.id);
  }

  const { rows: sortRows } = await query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE user_id = $1', [
    user.id,
  ]);
  let nextSort = sortRows[0].m + 1;
  let paletteIdx = existingCats.length;
  let categoriesCreated = 0;
  // Every category that ends up as *someone's* parent during this import --
  // a multi-level path like "Finance/Bank/Wire" can turn "Bank" (which an
  // earlier entry may have already pointed a rule at directly) into a
  // parent partway through the same import, so it needs the same
  // direct-mail/rule cleanup a drag-and-drop nesting gets.
  const parentsTouched = new Set();

  async function getOrCreateSegment(parentId, name) {
    const key = `${parentId || ''}::${name.toLowerCase()}`;
    if (categoryCache.has(key)) return categoryCache.get(key);
    const id = newId('cat');
    const color = PALETTE[paletteIdx++ % PALETTE.length];
    await query(
      `INSERT INTO categories (id, user_id, name, color, icon, is_builtin, sort_order, parent_id)
       VALUES ($1,$2,$3,$4,'tag',false,$5,$6)`,
      [id, user.id, name, color, nextSort++, parentId || null]
    );
    categoryCache.set(key, id);
    categoriesCreated++;
    return id;
  }

  // "Missionaries/Zach Reber" (or deeper, "A/B/C") becomes a real parent
  // chain: each segment is its own category row, nested under the previous
  // one, created only if it doesn't already exist under that same parent.
  async function getOrCreateCategory(path) {
    const segments = path
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    let parentId = null;
    let id = null;
    for (const segment of segments) {
      id = await getOrCreateSegment(parentId, segment);
      if (parentId) parentsTouched.add(parentId);
      parentId = id;
    }
    return id;
  }

  const { rows: priorityRows } = await query('SELECT COALESCE(MAX(priority), 0) AS m FROM rules WHERE user_id = $1', [
    user.id,
  ]);
  const basePriority = priorityRows[0].m;

  // Some real Gmail filter exports contain near-duplicate entries (the same
  // sender filed twice under slightly different wording). Rather than
  // create two identical rules, track field:operator:value:category seen
  // so far -- both from already-existing rules and within this import -- and
  // skip an exact repeat.
  const { rows: existingRules } = await query(
    'SELECT field, operator, value, category_id FROM rules WHERE user_id = $1',
    [user.id]
  );
  const seenRuleKeys = new Set(
    existingRules.map((r) => `${r.field}:${r.operator}:${r.value}:${r.category_id || ''}`)
  );

  let rulesCreated = 0;
  let duplicateRulesSkipped = 0;
  let skipped = 0;
  const skippedDetails = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const { criteria, actionText } = entries[idx];
    const matchers = parseCriteria(criteria, user.email);
    const action = parseAction(actionText);

    if (!matchers.length || !action) {
      skipped++;
      if (skippedDetails.length < 20) skippedDetails.push(criteria || actionText || '(empty entry)');
      continue;
    }

    let categoryId = null;
    if (action.categoryPath) {
      categoryId = await getOrCreateCategory(action.categoryPath);
    }

    const ruleName = action.categoryPath || (action.trash ? 'Auto-delete' : 'Auto mark as read');
    const priority = basePriority + (entries.length - idx);
    for (const m of matchers) {
      const key = `${m.field}:${m.operator}:${m.value}:${categoryId || ''}`;
      if (seenRuleKeys.has(key)) {
        duplicateRulesSkipped++;
        continue;
      }
      seenRuleKeys.add(key);
      await query(
        `INSERT INTO rules (id, user_id, name, field, operator, value, category_id, priority, enabled, mark_trashed, mark_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,
        [newId('rule'), user.id, ruleName, m.field, m.operator, m.value, categoryId, priority, action.trash, action.markSeen]
      );
      rulesCreated++;
    }
  }

  // A category can end up a parent partway through this same import (see
  // parentsTouched above) -- clean up any direct mail/rule assignments on
  // those now-parent categories the same way a manual drag-and-drop nesting
  // would, so the "only leaves hold mail" invariant holds by the time this
  // import finishes, regardless of what order the filters happened to list.
  let demotedParentsCount = 0;
  for (const parentId of parentsTouched) {
    if (await demoteToParent(user.id, parentId)) demotedParentsCount++;
  }

  res.status(200).json({
    entriesFound: entries.length,
    categoriesCreated,
    rulesCreated,
    duplicateRulesSkipped,
    skipped,
    skippedDetails,
    demotedParentsCount,
  });
}
