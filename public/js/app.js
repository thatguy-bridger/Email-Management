import { api } from './api.js';

const PALETTES = [
  { id: 'default', color: '#6366f1' },
  { id: 'mint', color: '#14b8a6' },
  { id: 'sunset', color: '#f97316' },
  { id: 'midnight', color: '#4338ca' },
  { id: 'rose', color: '#ec4899' },
  { id: 'monochrome', color: '#737373' },
];

const state = {
  view: 'home',
  user: null,
  categories: [],
  accounts: [],
  providers: {},
  rules: [],
  inbox: {
    mailbox: 'inbox',
    category: null,
    q: '',
    messages: [],
    selectedId: null,
    offset: 0,
    hasMore: false,
    filterFlag: null, // null | 'unread' | 'needsReply' | 'flagged'
    selected: new Set(),
    // Fingerprint of the mailbox/category/search/filter combo behind the
    // currently-rendered `messages` -- lets loadMessages() tell "revisiting
    // the same view" apart from "the filters actually changed", so it only
    // wipes the list to a spinner in the latter case.
    lastParamsKey: null,
  },
};

// ===================== Theme / palette =====================
function applyTheme(pref) {
  const effective = pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
  document.body.classList.toggle('dark-theme', effective === 'dark');
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.classList.toggle('btn-primary', btn.dataset.themeChoice === pref);
  });
}
function initTheme() {
  const pref = localStorage.getItem('mail-theme') || 'system';
  applyTheme(pref);
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem('mail-theme', btn.dataset.themeChoice);
      applyTheme(btn.dataset.themeChoice);
    });
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem('mail-theme') || 'system';
    if (current === 'system') applyTheme('system');
  });
}
function initPalette() {
  const row = document.getElementById('palette-swatch-row');
  const current = localStorage.getItem('mail-palette') || 'default';
  if (current !== 'default') document.body.setAttribute('data-palette', current);
  row.innerHTML = PALETTES.map(
    (p) => `<button class="palette-swatch ${p.id === current ? 'selected' : ''}" data-palette="${p.id}" style="background:${p.color}" title="${p.id}"></button>`
  ).join('');
  row.querySelectorAll('.palette-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.palette;
      localStorage.setItem('mail-palette', id);
      if (id === 'default') document.body.removeAttribute('data-palette');
      else document.body.setAttribute('data-palette', id);
      row.querySelectorAll('.palette-swatch').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });
}

// ===================== Navigation =====================
function switchView(view) {
  closeCategoryPicker();
  state.view = view;
  document.querySelectorAll('.app-view').forEach((el) => el.classList.toggle('hidden', el.id !== `view-${view}`));
  document.querySelectorAll('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  if (view === 'home') loadHome();
  if (view === 'inbox') loadInbox();
  if (view === 'categories') loadCategories();
  if (view === 'accounts') loadAccounts();
  if (view === 'settings') renderSettingsAccount();
}
function initNav() {
  document.querySelectorAll('.nav-link').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.goto)));
}

// ===================== Background refresh indicator =====================
// A thin top-of-viewport progress bar for data refreshes that happen behind
// already-visible content (see the load* functions below, which keep
// showing cached data instead of wiping to a spinner every time a view is
// revisited). Counter-based so overlapping refreshes (e.g. sorting a
// message while the inbox itself is mid-refresh) don't hide the bar the
// instant the first one finishes while another is still in flight.
let activeFetchCount = 0;
function showProgress() {
  activeFetchCount++;
  const bar = document.getElementById('top-progress-bar');
  bar.classList.remove('done');
  void bar.offsetWidth; // restart the width transition if it was already mid-animation
  bar.classList.add('active');
}
function hideProgress() {
  activeFetchCount = Math.max(0, activeFetchCount - 1);
  if (activeFetchCount > 0) return;
  const bar = document.getElementById('top-progress-bar');
  bar.classList.remove('active');
  bar.classList.add('done');
  setTimeout(() => bar.classList.remove('done'), 500);
}

// The topbar logo doubles as a manual refresh button (the "make the app
// icon the refresh button" request) -- re-runs whichever view is currently
// active, reusing the same load* functions the nav already calls, so it's
// a real re-fetch rather than a fake spinner.
function initRefreshButton() {
  const btn = document.getElementById('app-refresh-btn');
  btn.onclick = async () => {
    btn.classList.add('refreshing');
    try {
      if (state.view === 'home') await loadHome();
      else if (state.view === 'inbox') await loadInbox();
      else if (state.view === 'categories') await loadCategories();
      else if (state.view === 'accounts') await loadAccounts();
    } finally {
      btn.classList.remove('refreshing');
    }
  };
}

// ===================== Helpers =====================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}
function catById(id) {
  return state.categories.find((c) => c.id === id);
}
function categoryChildren(parentId) {
  return state.categories
    .filter((c) => (c.parent_id || null) === (parentId || null))
    .sort((a, b) => a.sort_order - b.sort_order);
}
function categoryPath(id) {
  const names = [];
  let cur = catById(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    names.unshift(cur.name);
    cur = cur.parent_id ? catById(cur.parent_id) : null;
  }
  return names.join(' / ');
}
// Used to keep a category out of its own parent-picker options -- a
// category (or any of its descendants) can never become its own ancestor.
function categoryDescendantIds(id) {
  const ids = new Set();
  const walk = (parentId) => {
    for (const c of categoryChildren(parentId)) {
      ids.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return ids;
}

// ===================== Category tree picker (popover) =====================
// One shared popover, reused everywhere a category needs picking (rule
// modal, category modal's parent field, each Inbox row's "Sort into..."):
// an arbitrary-depth tree with per-node expand/collapse, rather than a flat
// <select> listing every category (which is what caused the clutter with 70+
// imported categories in the first place).
let activeCategoryPicker = null;
const PICKER_PALETTE = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#f97316', '#14b8a6', '#8b5cf6', '#ef4444'];
const EMOJI_ICON_CHOICES = [
  '📧', '💰', '🧾', '📦', '🛍️', '✈️', '📰', '👥', '⚠️', '🎉',
  '💼', '🏠', '🎓', '⚽', '🎮', '🎵', '📚', '🏥', '💊', '🚗',
  '🐾', '🎁', '💳', '📅', '🔔', '🤝', '📢', '🗂️', '💬', '⭐',
];

function closeCategoryPicker() {
  if (!activeCategoryPicker) return;
  activeCategoryPicker.el.remove();
  document.removeEventListener('mousedown', activeCategoryPicker.onDocClick, true);
  window.removeEventListener('scroll', activeCategoryPicker.onDocClick, true);
  activeCategoryPicker = null;
}

function positionCategoryPicker(popover, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.minWidth = `${Math.max(rect.width, 220)}px`;
  popover.style.maxWidth = '320px';
  popover.style.zIndex = '2000';
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 260 && rect.top > 260) {
    popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    popover.style.top = 'auto';
  } else {
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.bottom = 'auto';
  }
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 340))}px`;
}

// opts: selectedId, noneLabel (string to show a "clear"/"top level" row, or
// null to omit it), excludeIds (Set -- hides categories that shouldn't be
// selectable, e.g. a category and its own descendants when picking its
// parent), leafOnly (categories with subcategories are shown so the tree
// stays navigable, but aren't selectable -- clicking one just expands it,
// since only leaf categories can hold mail), onSelect(idOrNull).
function openCategoryPicker(anchorEl, opts) {
  closeCategoryPicker();
  const { selectedId = null, noneLabel = null, excludeIds = new Set(), leafOnly = false, onSelect } = opts;

  const popover = document.createElement('div');
  popover.className = 'cat-picker-popover glass-card';
  document.body.appendChild(popover);

  // Expand every ancestor of the current selection so it's visible without
  // the user having to click down into the tree just to see what's picked.
  const expanded = new Set();
  if (selectedId) {
    let cur = catById(selectedId);
    while (cur && cur.parent_id) {
      expanded.add(cur.parent_id);
      cur = catById(cur.parent_id);
    }
  }
  let creatingNew = false;

  function rowHtml(c, depth) {
    const children = categoryChildren(c.id).filter((ch) => !excludeIds.has(ch.id));
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(c.id);
    const unselectable = leafOnly && hasChildren;
    return `
      <div class="cat-picker-row ${c.id === selectedId ? 'active' : ''} ${unselectable ? 'unselectable' : ''}" data-pick-cat="${c.id}" data-has-children="${hasChildren}" style="padding-left:${0.5 + depth * 1.1}rem;">
        ${hasChildren ? `<span class="cat-tree-toggle ${isExpanded ? 'expanded' : ''}" data-pick-toggle="${c.id}">&#9656;</span>` : '<span class="cat-tree-toggle-spacer"></span>'}
        <span class="chip-dot" style="background:${c.color};width:0.55rem;height:0.55rem;border-radius:50%;flex-shrink:0;"></span>
        <span style="flex:1;">${escapeHtml(c.name)}</span>
        ${unselectable ? '<span class="form-hint" style="font-size:0.68rem;">has subs</span>' : ''}
      </div>
      ${hasChildren ? `<div class="${isExpanded ? '' : 'hidden'}" data-pick-children-of="${c.id}">${children.map((ch) => rowHtml(ch, depth + 1)).join('')}</div>` : ''}`;
  }

  function render() {
    const top = categoryChildren(null).filter((c) => !excludeIds.has(c.id));
    const newRowHtml = creatingNew
      ? `<div class="cat-picker-new-form">
          <input type="text" class="form-input" id="cat-picker-new-name" placeholder="New category name">
          <button type="button" class="icon-btn" id="cat-picker-new-confirm" title="Create">&#10003;</button>
          <button type="button" class="icon-btn" id="cat-picker-new-cancel" title="Cancel">&times;</button>
        </div>`
      : `<div class="cat-picker-row cat-picker-new-row" id="cat-picker-new-btn"><span class="cat-tree-toggle-spacer"></span><span>+ New category</span></div>`;

    popover.innerHTML =
      (noneLabel !== null
        ? `<div class="cat-picker-row ${selectedId === null ? 'active' : ''}" data-pick-cat="">${escapeHtml(noneLabel)}</div><div class="cat-picker-sep"></div>`
        : '') +
      (top.length ? top.map((c) => rowHtml(c, 0)).join('') : '<div class="form-hint" style="padding:0.5rem;">No categories yet.</div>') +
      `<div class="cat-picker-sep"></div>${newRowHtml}`;

    popover.querySelectorAll('[data-pick-toggle]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.pickToggle;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        render();
      };
    });
    popover.querySelectorAll('[data-pick-cat]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.pickCat || null;
        // A parent category isn't a valid mail target in leaf-only mode --
        // clicking it just navigates the tree instead of selecting it.
        if (id && leafOnly && el.dataset.hasChildren === 'true') {
          if (expanded.has(id)) expanded.delete(id);
          else expanded.add(id);
          render();
          return;
        }
        closeCategoryPicker();
        onSelect(id);
      };
    });

    if (creatingNew) {
      const input = popover.querySelector('#cat-picker-new-name');
      input.onclick = (e) => e.stopPropagation();
      input.focus();
      const submitNew = async () => {
        const name = input.value.trim();
        if (!name) return;
        const color = PICKER_PALETTE[state.categories.length % PICKER_PALETTE.length];
        try {
          const { category } = await api.createCategory({ name, color, parentId: null });
          state.categories.push(category);
          closeCategoryPicker();
          onSelect(category.id);
        } catch (err) {
          alert(err.message);
        }
      };
      popover.querySelector('#cat-picker-new-confirm').onclick = (e) => {
        e.stopPropagation();
        submitNew();
      };
      popover.querySelector('#cat-picker-new-cancel').onclick = (e) => {
        e.stopPropagation();
        creatingNew = false;
        render();
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitNew();
        } else if (e.key === 'Escape') {
          creatingNew = false;
          render();
        }
      };
    } else {
      popover.querySelector('#cat-picker-new-btn').onclick = (e) => {
        e.stopPropagation();
        creatingNew = true;
        render();
      };
    }
  }
  render();
  positionCategoryPicker(popover, anchorEl);

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) closeCategoryPicker();
  };
  // Deferred so the click that opened the popover doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onDocClick, true), 0);
  window.addEventListener('scroll', onDocClick, true);
  activeCategoryPicker = { el: popover, onDocClick };
}
function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}
// A category's `icon` column defaults to legacy plain-word ids ('tag',
// 'inbox', 'folder') that were never meant to be rendered as text -- a
// custom icon is only ever a user-picked emoji, which is never plain ASCII,
// so that's what distinguishes "has a custom icon" from "still on the
// legacy default" without needing a separate boolean column.
function isEmojiIcon(icon) {
  return !!icon && !/^[a-zA-Z_-]+$/.test(icon);
}
function categoryGlyph(c) {
  return isEmojiIcon(c.icon) ? c.icon : initials(c.name);
}
function showBanner(container, type, message) {
  container.innerHTML = `<div class="banner ${type}">${escapeHtml(message)}</div>`;
}

// ===================== Modal =====================
// opts.wide: use the roomier modal-box variant (message reading modal) instead
// of the default form-width one.
function openModal(html, onMount, opts = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="active-modal-overlay"><div class="modal-box${opts.wide ? ' modal-box-wide' : ''}">${html}</div></div>`;
  const overlay = document.getElementById('active-modal-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  if (onMount) onMount(overlay);
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  // The category picker popover renders into document.body (so it can
  // float outside the modal box), so it won't get cleared by wiping
  // modal-root above -- close it explicitly or it's left orphaned on screen.
  closeCategoryPicker();
}

// In-app replacement for window.confirm() -- styled like the rest of the
// app instead of the browser's native dialog, and Promise-based so call
// sites just `await showConfirm(...)` where they used to check the return
// value of confirm(...) directly. danger:true swaps the confirm button to
// the red/destructive style for delete-type actions.
function showConfirm(message, opts = {}) {
  const { title = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = opts;
  return new Promise((resolve) => {
    let settled = false;
    openModal(
      `
      <h2>${escapeHtml(title)}</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.55;margin:0 0 0.25rem;">${escapeHtml(message)}</p>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="confirm-cancel-btn">${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">${escapeHtml(confirmText)}</button>
      </div>`,
      (overlay) => {
        const finish = (result) => {
          // closeModal() (via the overlay's own click-outside handler, or a
          // second button click racing this one) could fire twice -- only
          // the first resolves the promise.
          if (settled) return;
          settled = true;
          closeModal();
          resolve(result);
        };
        overlay.querySelector('#confirm-cancel-btn').onclick = () => finish(false);
        overlay.querySelector('#confirm-ok-btn').onclick = () => finish(true);
        // Clicking the dark overlay backdrop closes the modal (openModal's
        // own handler) without going through finish() -- treat that the
        // same as Cancel rather than leaving the promise unresolved forever.
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) finish(false);
        });
      }
    );
  });
}

// ===================== HOME =====================
// Collapsed by default -- a dashboard widget dumping 20+ categories flat
// was exactly the clutter problem the Categories page tree already solved,
// so this gets the same "summary first, expand to see the list" treatment.
const HOME_CATEGORY_BREAKDOWN_KEY = 'mail_home_cat_breakdown_expanded';

async function loadHome() {
  const greeting = document.getElementById('home-greeting');
  const hour = new Date().getHours();
  greeting.textContent = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';

  const bannerContainer = document.getElementById('home-banner-container');
  bannerContainer.innerHTML = '';
  showProgress();
  try {
    const [stats] = await Promise.all([api.getStats(), refreshCategories()]);

    document.getElementById('home-stat-grid').innerHTML = `
      <div class="glass-card stat-tile accent-1" data-stat="unread" style="cursor:pointer;"><div class="stat-value">${stats.unread}</div><div class="stat-label">Unread</div></div>
      <div class="glass-card stat-tile accent-3" data-stat="needsReply" style="cursor:pointer;"><div class="stat-value">${stats.needsReply}</div><div class="stat-label">Needs Reply</div></div>
      <div class="glass-card stat-tile" data-stat="flagged" style="cursor:pointer;"><div class="stat-value">${stats.flagged}</div><div class="stat-label">Flagged</div></div>
      <div class="glass-card stat-tile" data-stat="accounts" style="cursor:pointer;"><div class="stat-value">${stats.accounts.length}</div><div class="stat-label">Accounts</div></div>
    `;
    document.querySelectorAll('#home-stat-grid [data-stat]').forEach((tile) => {
      tile.onclick = () => {
        const key = tile.dataset.stat;
        if (key === 'accounts') return switchView('accounts');
        state.inbox.filterFlag = key;
        switchView('inbox');
      };
    });
    const unreadBadge = document.getElementById('nav-unread-badge');
    unreadBadge.textContent = stats.unread;
    unreadBadge.classList.toggle('hidden', stats.unread === 0);

    {
      const expanded = localStorage.getItem(HOME_CATEGORY_BREAKDOWN_KEY) === 'true';
      const totalUnread = stats.categories.reduce((sum, c) => sum + (c.unread || 0), 0);
      document.getElementById('home-category-breakdown').innerHTML =
        stats.categories.length === 0
          ? '<div class="empty-state">No categories yet.</div>'
          : `
        <button type="button" class="rule-group-header" id="home-cat-toggle" style="padding-left:0;">
          <span class="cat-tree-expand-btn ${expanded ? 'expanded' : ''}" style="pointer-events:none;">&#9656;</span>
          <span style="flex:1;font-weight:700;">${stats.categories.length} categor${stats.categories.length === 1 ? 'y' : 'ies'}</span>
          <span class="form-hint">${totalUnread > 0 ? `${totalUnread} unread` : ''}</span>
        </button>
        <div id="home-cat-list" class="${expanded ? '' : 'hidden'}">
          ${stats.categories
            .map(
              (c) => `
          <div class="account-status-row">
            <span class="color-dot" style="background:${c.color}"></span>
            <span style="flex:1;">${escapeHtml(c.name)}</span>
            <span class="form-hint">${c.total} total${c.unread > 0 ? ` &middot; ${c.unread} unread` : ''}</span>
          </div>`
            )
            .join('')}
        </div>`;
      document.getElementById('home-cat-toggle')?.addEventListener('click', () => {
        const list = document.getElementById('home-cat-list');
        const isHidden = list.classList.toggle('hidden');
        document.querySelector('#home-cat-toggle .cat-tree-expand-btn').classList.toggle('expanded', !isHidden);
        localStorage.setItem(HOME_CATEGORY_BREAKDOWN_KEY, String(!isHidden));
      });
    }

    document.getElementById('home-account-status').innerHTML =
      stats.accounts.length === 0
        ? '<div class="empty-state">No accounts connected yet.<br><button class="btn btn-primary btn-sm" data-goto="accounts" style="margin-top:0.75rem;">Connect one</button></div>'
        : stats.accounts
            .map(
              (a) => `
        <div class="account-status-row">
          <span class="color-dot" style="background:${a.color}"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.email)}</span>
          <span class="status-pill ${a.sync_status}">${a.sync_status}</span>
        </div>`
            )
            .join('');
    document.querySelectorAll('#home-account-status [data-goto]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.goto)));

    document.getElementById('home-recent-list').innerHTML =
      stats.recent.length === 0
        ? '<div class="empty-state">No mail yet. Connect an account to get started.</div>'
        : stats.recent
            .map((m) => {
              const cat = catById(m.category_id);
              const unreadStyle = !m.seen && cat ? `border-left-color:${cat.color};` : '';
              return `
        <div class="message-row ${m.seen ? '' : 'unread'}" data-open-message="${m.id}" style="margin-bottom:0.5rem;${unreadStyle}">
          ${cat ? `<span class="msg-cat-dot" style="background:${cat.color}"></span>` : '<span class="msg-cat-dot" style="background:transparent"></span>'}
          <div class="msg-main">
            <div class="msg-top-line"><span class="msg-from">${escapeHtml(m.from_name || m.from_email)}</span><span class="msg-date">${timeAgo(m.date)}</span></div>
            <div class="msg-subject">${escapeHtml(m.subject)}</div>
            <div class="msg-snippet">${escapeHtml(m.snippet)}</div>
          </div>
        </div>`;
            })
            .join('');
    document.querySelectorAll('#home-recent-list [data-open-message]').forEach((row) =>
      row.addEventListener('click', () => {
        switchView('inbox');
        setTimeout(() => selectMessage(row.dataset.openMessage), 50);
      })
    );
  } catch (err) {
    showBanner(bannerContainer, 'error', err.message);
  } finally {
    hideProgress();
  }

  document.getElementById('home-sync-all-btn').onclick = async (e) => {
    e.target.disabled = true;
    e.target.innerHTML = '<span class="spinner"></span> Syncing...';
    try {
      await Promise.all(state.accounts.map((a) => api.syncAccount(a.id).catch(() => {})));
      showBanner(bannerContainer, 'success', 'Sync complete.');
    } catch (err) {
      showBanner(bannerContainer, 'error', err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Sync all accounts';
      loadHome();
    }
  };
}

// ===================== INBOX =====================
async function refreshCategories() {
  const { categories } = await api.listCategories();
  state.categories = categories;
  return categories;
}

// A chip per category (as this used to be) turns into 50+ wrapping buttons
// once a Gmail import happens -- same clutter problem the Categories page
// tree already solved. "All" stays a one-click chip since it's the common
// case; everything else lives behind a single dropdown button that opens
// the same collapsible category tree popover used everywhere else, instead
// of dumping every category flat into the toolbar.
function renderCategoryRail() {
  const rail = document.getElementById('inbox-category-rail');
  const active = state.inbox.category ? catById(state.inbox.category) : null;
  rail.innerHTML = `
    <button class="category-chip ${state.inbox.category === null ? 'active' : ''}" id="cat-rail-all" style="${state.inbox.category === null ? 'background:var(--accent-grad);' : ''}">All</button>
    <button type="button" class="category-chip cat-picker-btn" id="cat-rail-filter-btn" style="${active ? `background:${active.color};color:#fff;border-color:transparent;` : ''}">
      ${active ? `<span class="chip-dot" style="background:rgba(255,255,255,.6)"></span>${escapeHtml(categoryPath(active.id))}` : 'Filter by category'}
      ${active && active.unread_count > 0 ? `<span class="chip-count">${active.unread_count}</span>` : ''}
    </button>`;
  document.getElementById('cat-rail-all').onclick = () => {
    state.inbox.category = null;
    renderCategoryRail();
    loadMessages();
  };
  document.getElementById('cat-rail-filter-btn').onclick = (e) => {
    openCategoryPicker(e.currentTarget, {
      selectedId: state.inbox.category,
      leafOnly: true, // only leaf categories ever hold mail, so a parent is never a useful filter
      onSelect: (id) => {
        state.inbox.category = id;
        renderCategoryRail();
        loadMessages();
      },
    });
  };
}

const QUICK_FILTER_LABELS = { unread: 'Unread', needsReply: 'Needs Reply', flagged: 'Flagged' };

// Reflects state.inbox.filterFlag in the UI: the Unread toggle's active
// state, and a dismissible banner for the other two (which arrive via a
// click on a Home stat tile, not a control that's already visible here).
function syncQuickFilterUI() {
  document.getElementById('unread-filter-toggle').classList.toggle('active', state.inbox.filterFlag === 'unread');

  const banner = document.getElementById('inbox-quick-filter-banner');
  if (state.inbox.filterFlag && state.inbox.filterFlag !== 'unread') {
    banner.innerHTML = `<div class="banner" style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
      <span>Showing: ${QUICK_FILTER_LABELS[state.inbox.filterFlag]}</span>
      <button class="btn btn-sm btn-ghost" id="clear-quick-filter-btn" style="margin-left:auto;">Clear</button>
    </div>`;
    document.getElementById('clear-quick-filter-btn').onclick = () => {
      state.inbox.filterFlag = null;
      syncQuickFilterUI();
      loadMessages();
    };
  } else {
    banner.innerHTML = '';
  }
}

function updateBulkBar() {
  const bar = document.getElementById('inbox-bulk-bar');
  const count = state.inbox.selected.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('inbox-bulk-count').textContent = `${count} selected`;
}

async function runBulkAction(payload) {
  const ids = [...state.inbox.selected];
  if (!ids.length) return;
  await Promise.all(ids.map((id) => api.updateMessage(id, payload).catch(() => {})));
  state.inbox.selected.clear();
  updateBulkBar();
  loadMessages();
}

async function loadInbox() {
  showProgress();
  try {
    await refreshCategories();
    if (!state.accounts.length) await refreshAccounts();
    renderCategoryRail();
    await loadMessages();
  } catch (err) {
    document.getElementById('inbox-message-list').innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  } finally {
    hideProgress();
  }

  // Wired unconditionally (a failed initial fetch above shouldn't leave the
  // tabs/search dead for the rest of the session) and via .onclick rather
  // than addEventListener, since loadInbox() re-runs every time the Inbox
  // nav item is clicked and addEventListener would stack duplicate handlers.
  // Scoped to [data-mailbox] specifically so the Unread toggle -- same
  // "mailbox-tab" styling class, but not a mailbox switch -- isn't swept
  // into this loop.
  document.querySelectorAll('.mailbox-tab[data-mailbox]').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.mailbox-tab[data-mailbox]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.inbox.mailbox = tab.dataset.mailbox;
      loadMessages();
    };
  });

  document.getElementById('unread-filter-toggle').onclick = () => {
    state.inbox.filterFlag = state.inbox.filterFlag === 'unread' ? null : 'unread';
    syncQuickFilterUI();
    loadMessages();
  };

  document.getElementById('mark-all-read-btn').onclick = async (e) => {
    const unreadIds = state.inbox.messages.filter((m) => !m.seen).map((m) => m.id);
    if (!unreadIds.length) return;
    e.target.disabled = true;
    await Promise.all(unreadIds.map((id) => api.updateMessage(id, { seen: true }).catch(() => {})));
    e.target.disabled = false;
    loadMessages();
  };

  document.getElementById('bulk-cancel-btn').onclick = () => {
    state.inbox.selected.clear();
    document.querySelectorAll('.msg-select-checkbox').forEach((cb) => (cb.checked = false));
    updateBulkBar();
  };
  document.getElementById('bulk-mark-read-btn').onclick = () => runBulkAction({ seen: true });
  document.getElementById('bulk-archive-btn').onclick = () => runBulkAction({ archived: true });
  document.getElementById('bulk-trash-btn').onclick = () => runBulkAction({ trashed: true });

  syncQuickFilterUI();

  const search = document.getElementById('inbox-search');
  let debounce;
  search.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.inbox.q = search.value;
      loadMessages();
    }, 250);
  };
}

const MESSAGES_PAGE_SIZE = 50;

function messageRowHtml(m) {
  const cat = catById(m.category_id);
  const unreadStyle = !m.seen && cat ? ` style="border-left-color:${cat.color};"` : '';
  return `
      <div class="message-row ${m.seen ? '' : 'unread'} ${m.id === state.inbox.selectedId ? 'selected' : ''}" data-id="${m.id}"${unreadStyle}>
        <input type="checkbox" class="msg-select-checkbox" data-select-id="${m.id}" ${state.inbox.selected.has(m.id) ? 'checked' : ''} onclick="event.stopPropagation()">
        ${cat ? `<span class="msg-cat-dot" style="background:${cat.color}"></span>` : '<span class="msg-cat-dot" style="background:transparent"></span>'}
        <div class="msg-main">
          <div class="msg-top-line">
            <span class="msg-from">${escapeHtml(m.from_name || m.from_email)}</span>
            <span class="msg-date">${m.flagged ? '<span class="msg-flag">&#9733;</span> ' : ''}${timeAgo(m.date)}</span>
          </div>
          <div class="msg-subject">${escapeHtml(m.subject)}</div>
          <div class="msg-snippet">${escapeHtml(m.snippet)}</div>
          <button type="button" class="sort-select cat-picker-btn" data-sort-btn="${m.id}" onclick="event.stopPropagation()">${cat ? escapeHtml(cat.name) : 'Sort into&hellip;'}</button>
        </div>
      </div>`;
}

// Wiring uses assignment (.onclick =) rather than addEventListener so this
// can safely be called on the whole list container every render -- initial
// load and each "Load more" page both re-wire everything without stacking
// duplicate listeners on rows that were already there.
function wireMessageRows(container) {
  container.querySelectorAll('.message-row').forEach((row) => {
    row.onclick = () => selectMessage(row.dataset.id);
  });
  container.querySelectorAll('.msg-select-checkbox').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) state.inbox.selected.add(cb.dataset.selectId);
      else state.inbox.selected.delete(cb.dataset.selectId);
      updateBulkBar();
    };
  });
  container.querySelectorAll('[data-sort-btn]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.sortBtn;
      const msg = state.inbox.messages.find((m) => m.id === id);
      openCategoryPicker(btn, {
        selectedId: msg?.category_id || null,
        noneLabel: 'Uncategorized',
        leafOnly: true,
        onSelect: async (categoryId) => {
          await api.updateMessage(id, { categoryId });
          await refreshCategories();
          renderCategoryRail();
          loadMessages();
        },
      });
    };
  });
  const loadMoreBtn = document.getElementById('load-more-messages-btn');
  if (loadMoreBtn) {
    loadMoreBtn.onclick = () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.innerHTML = '<span class="spinner"></span>';
      loadMessages(false);
    };
  }
}

// reset=true (the default) replaces the list from offset 0 -- used for a
// fresh mailbox/category/search. reset=false appends the next page, used
// only by the "Load more" button.
async function loadMessages(reset = true) {
  const list = document.getElementById('inbox-message-list');
  // Identifies the mailbox/category/search/filter combo, deliberately
  // without offset -- pagination shouldn't affect whether this counts as
  // "the same view" for caching purposes below.
  const viewKey = JSON.stringify({
    mailbox: state.inbox.mailbox,
    category: state.inbox.category || null,
    q: state.inbox.q || '',
    filterFlag: state.inbox.filterFlag || null,
  });

  if (reset) {
    // Revisiting the exact same mailbox/category/search/filter combo that's
    // already on screen -- keep showing it and refresh quietly instead of
    // wiping to a spinner, which is what made switching back to Inbox feel
    // like a full reload every time even though nothing had changed.
    const isSameView = viewKey === state.inbox.lastParamsKey && state.inbox.messages.length > 0;
    state.inbox.offset = 0;
    if (!isSameView) {
      state.inbox.messages = [];
      state.inbox.selected.clear();
      updateBulkBar();
      list.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
    }
  }
  const params = { mailbox: state.inbox.mailbox, limit: String(MESSAGES_PAGE_SIZE), offset: String(state.inbox.offset) };
  if (state.inbox.category) params.category = state.inbox.category;
  if (state.inbox.q) params.q = state.inbox.q;
  if (state.inbox.filterFlag === 'unread') params.unread = 'true';
  if (state.inbox.filterFlag === 'needsReply') params.needsReply = 'true';
  if (state.inbox.filterFlag === 'flagged') params.flagged = 'true';

  showProgress();
  try {
    const { messages } = await api.listMessages(params);
    state.inbox.hasMore = messages.length === MESSAGES_PAGE_SIZE;
    state.inbox.offset += messages.length;
    state.inbox.messages = reset ? messages : [...state.inbox.messages, ...messages];
    if (reset) state.inbox.lastParamsKey = viewKey;

    if (!state.inbox.messages.length) {
      list.innerHTML = '<div class="empty-state">Nothing here.</div>';
      return;
    }

    list.innerHTML =
      state.inbox.messages.map(messageRowHtml).join('') +
      (state.inbox.hasMore
        ? '<button class="btn btn-ghost btn-sm" id="load-more-messages-btn" style="width:100%;justify-content:center;margin-top:0.25rem;">Load more</button>'
        : '');
    wireMessageRows(list);
  } catch (err) {
    list.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  } finally {
    hideProgress();
  }
}

function messageBodyHtml(m) {
  return m.body_html
    ? sanitizeHtmlBody(m.body_html)
    : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(m.body_text || m.snippet || '')}</pre>`;
}

// The primary card (the message actually clicked) gets the action buttons
// and a highlighted border; sibling thread messages are read-only context
// around it, same as a Gmail conversation view.
function messageCardHtml(m, isPrimary) {
  const cat = catById(m.category_id);
  return `
    <div class="glass-card" style="margin-bottom:1rem;${isPrimary ? `border-color:var(--accent-1);` : ''}" data-thread-card="${m.id}">
      <div class="reading-pane-header" style="margin-bottom:0.75rem;padding-bottom:0.75rem;">
        <div>
          <div class="reading-pane-meta">
            ${escapeHtml(m.from_name || m.from_email)} &lt;${escapeHtml(m.from_email)}&gt; &middot; ${new Date(m.date).toLocaleString()}
          </div>
          ${cat ? `<span class="category-chip" style="margin-top:0.5rem;background:${cat.color};color:#fff;border:none;"><span class="chip-dot" style="background:rgba(255,255,255,.6)"></span>${escapeHtml(cat.name)}</span>` : ''}
        </div>
        ${
          isPrimary
            ? `<div class="reading-pane-actions">
                <button class="icon-btn" data-act="flag" title="${m.flagged ? 'Unflag' : 'Flag'}">${m.flagged ? '&#9733;' : '&#9734;'}</button>
                <button class="icon-btn" data-act="archive" title="Archive">&#128229;</button>
                <button class="icon-btn" data-act="trash" title="Trash">&#128465;</button>
              </div>`
            : ''
        }
      </div>
      <div class="reading-pane-body">${messageBodyHtml(m)}</div>
    </div>`;
}

// Opening a message is a modal rather than a side-by-side reading pane --
// the Inbox list stays full width and doesn't reserve space for content
// that isn't there until something's clicked.
async function selectMessage(id) {
  state.inbox.selectedId = id;
  document.querySelectorAll('.message-row').forEach((r) => r.classList.toggle('selected', r.dataset.id === id));

  openModal(
    `
    <button type="button" class="modal-close-x" id="msg-modal-close" title="Close">&times;</button>
    <div id="msg-modal-content"><div class="reading-pane-empty"><span class="spinner"></span></div></div>`,
    async (overlay) => {
      overlay.querySelector('#msg-modal-close').onclick = closeModal;
      const content = overlay.querySelector('#msg-modal-content');
      try {
        const { message: m } = await api.getMessage(id);

        let thread = [m];
        if (m.thread_id) {
          const { messages: siblings } = await api.listMessages({ threadId: m.thread_id, limit: '200' });
          if (siblings.length > 1) thread = [...siblings].reverse(); // API returns newest-first; a conversation reads oldest-first
        }

        content.innerHTML =
          `<h2 style="margin-bottom:0.75rem;padding-right:1.5rem;">${escapeHtml(m.subject || '(no subject)')}</h2>` +
          (thread.length > 1
            ? `<div class="form-hint" style="margin-bottom:0.75rem;">${thread.length} messages in this conversation</div>`
            : '') +
          thread.map((tm) => messageCardHtml(tm, tm.id === id)).join('');

        const primaryCard = content.querySelector(`[data-thread-card="${id}"]`);
        primaryCard.querySelector('[data-act="flag"]').onclick = async () => {
          await api.updateMessage(id, { flagged: !m.flagged });
          selectMessage(id);
        };
        primaryCard.querySelector('[data-act="archive"]').onclick = async () => {
          await api.updateMessage(id, { archived: true });
          closeModal();
          loadMessages();
        };
        primaryCard.querySelector('[data-act="trash"]').onclick = async () => {
          await api.updateMessage(id, { trashed: true });
          closeModal();
          loadMessages();
        };
        // reflect read state in the list without a full reload
        const row = document.querySelector(`.message-row[data-id="${id}"]`);
        if (row) row.classList.remove('unread');
      } catch (err) {
        content.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
      }
    },
    { wide: true }
  );
}

// Message bodies come from real IMAP mail, so they're rendered as inert text
// rather than raw HTML -- no script/style/event-handler execution, no
// remote-tracking-pixel-style image loads. Good enough for a personal,
// single-user viewer without pulling in a full HTML sanitizer dependency.
function sanitizeHtmlBody(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((el) => el.remove());
  div.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (attr.name === 'src' && el.tagName === 'IMG') el.removeAttribute('src');
    });
  });
  return div.innerHTML;
}

// ===================== CATEGORIES / RULES =====================

// Which categories are expanded on the Categories page tree, persisted
// across visits/reloads. Starts empty (everything collapsed but the top
// level) so a large imported label tree doesn't dump every sub/sub-sub
// category on screen at once.
const CAT_TREE_EXPANDED_KEY = 'mail_cat_tree_expanded';
function loadCategoryTreeExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CAT_TREE_EXPANDED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveCategoryTreeExpanded() {
  localStorage.setItem(CAT_TREE_EXPANDED_KEY, JSON.stringify([...categoryTreeExpanded]));
}
const categoryTreeExpanded = loadCategoryTreeExpanded();

// Mass-selection for bulk move/delete -- a plain Set rather than something
// tied to render output, so it survives expand/collapse re-renders (only
// cleared by an explicit Cancel or after a bulk action completes).
const categoryBulkSelected = new Set();

function categoryTreeRowHtml(c, depth) {
  const children = categoryChildren(c.id);
  const hasChildren = children.length > 0;
  const isExpanded = categoryTreeExpanded.has(c.id);
  // The built-in Primary category is excluded from drag-and-drop, bulk
  // selection, and everything else that could move/delete it -- it's the
  // permanent fallback for uncategorized mail.
  return `
    <div class="cat-tree-row" data-cat-row="${c.id}" ${c.is_builtin ? '' : 'draggable="true"'} style="padding-left:${depth * 1.5}rem;">
      ${c.is_builtin ? '<span class="cat-bulk-checkbox-spacer"></span>' : `<input type="checkbox" class="cat-bulk-checkbox" data-bulk-select="${c.id}" ${categoryBulkSelected.has(c.id) ? 'checked' : ''} onclick="event.stopPropagation()">`}
      ${hasChildren ? `<button type="button" class="cat-tree-expand-btn ${isExpanded ? 'expanded' : ''}" data-toggle-cat="${c.id}" title="${isExpanded ? 'Collapse' : 'Expand'}">&#9656;</button>` : '<span class="cat-tree-expand-spacer"></span>'}
      <div class="cat-icon" style="background:${c.color};width:1.9rem;height:1.9rem;font-size:${isEmojiIcon(c.icon) ? '1rem' : '0.78rem'};">${categoryGlyph(c)}</div>
      <span class="cat-tree-name">${escapeHtml(c.name)}</span>
      <span class="form-hint">${c.total ?? 0} total &middot; ${c.unread_count ?? 0} unread${hasChildren ? ` &middot; ${children.length} sub${children.length === 1 ? '' : 's'}` : ''}</span>
      <button class="icon-btn" data-add-sub-cat="${c.id}" title="Add subcategory">+</button>
      ${c.is_builtin ? '' : `<button class="icon-btn" data-edit-cat="${c.id}" title="Edit">&#9998;</button><button class="icon-btn" data-del-cat="${c.id}" title="Delete">&times;</button>`}
    </div>
    ${hasChildren ? `<div class="cat-tree-children ${isExpanded ? '' : 'hidden'}" data-children-of="${c.id}">${children.map((ch) => categoryTreeRowHtml(ch, depth + 1)).join('')}</div>` : ''}`;
}

function updateCategoryBulkBar() {
  const bar = document.getElementById('category-bulk-bar');
  const count = categoryBulkSelected.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('category-bulk-count').textContent = `${count} selected`;
}

async function runCategoryBulkMove() {
  const ids = [...categoryBulkSelected];
  if (!ids.length) return;
  const excludeIds = new Set(ids);
  for (const id of ids) for (const d of categoryDescendantIds(id)) excludeIds.add(d);

  const anchor = document.getElementById('category-bulk-move-btn');
  openCategoryPicker(anchor, {
    noneLabel: 'Top level',
    excludeIds,
    onSelect: async (targetId) => {
      if (targetId) {
        const target = catById(targetId);
        const directRuleCount = state.rules.filter((r) => r.category_id === targetId).length;
        const directMailCount = target?.total ?? 0;
        if (directMailCount > 0 || directRuleCount > 0) {
          const parts = [];
          if (directMailCount > 0) parts.push(`${directMailCount} message${directMailCount === 1 ? '' : 's'}`);
          if (directRuleCount > 0) parts.push(`${directRuleCount} rule${directRuleCount === 1 ? '' : 's'}`);
          const ok = await showConfirm(
            `"${target.name}" currently has ${parts.join(' and ')} filed directly under it. Moving ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'} under it turns "${target.name}" into a parent category, which can't hold mail itself -- ${parts.join(' and ')} will be uncategorized or lose that category.`,
            { title: `Move into "${target.name}"?`, confirmText: 'Move', danger: true }
          );
          if (!ok) return;
        }
      }

      let moved = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await api.updateCategory(id, { parentId: targetId });
          moved++;
        } catch {
          failed++;
        }
      }
      if (targetId) {
        categoryTreeExpanded.add(targetId);
        saveCategoryTreeExpanded();
      }
      categoryBulkSelected.clear();
      await loadCategories();
      const msg = failed
        ? `Moved ${moved} categor${moved === 1 ? 'y' : 'ies'}, ${failed} failed (likely a conflict with another selected category).`
        : `Moved ${moved} categor${moved === 1 ? 'y' : 'ies'}.`;
      showBanner(document.getElementById('category-tree-banner'), failed ? 'error' : 'success', msg);
    },
  });
}

async function runCategoryBulkDelete() {
  const ids = [...categoryBulkSelected];
  if (!ids.length) return;
  const ok = await showConfirm(
    `Mail in them becomes uncategorized, and any of their subcategories that aren't also selected move up a level.`,
    { title: `Delete ${ids.length} selected categor${ids.length === 1 ? 'y' : 'ies'}?`, confirmText: 'Delete', danger: true }
  );
  if (!ok) return;

  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await api.deleteCategory(id);
      deleted++;
    } catch {
      failed++;
    }
  }
  categoryBulkSelected.clear();
  await loadCategories();
  const msg = failed ? `Deleted ${deleted}, ${failed} failed.` : `Deleted ${deleted} categor${deleted === 1 ? 'y' : 'ies'}.`;
  showBanner(document.getElementById('category-tree-banner'), failed ? 'error' : 'success', msg);
}

// Dragging draggedId onto targetId would nest draggedId under targetId --
// valid unless it's a no-op, a self/cycle, or either side is the built-in
// Primary category (which can neither be nested nor gain subcategories).
function isValidCategoryDrop(draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return false;
  const dragged = catById(draggedId);
  const target = catById(targetId);
  if (!dragged || !target || dragged.is_builtin || target.is_builtin) return false;
  if ((dragged.parent_id || null) === targetId) return false;
  if (categoryDescendantIds(draggedId).has(targetId)) return false;
  return true;
}

async function nestCategoryOnto(draggedId, targetId) {
  const dragged = catById(draggedId);
  const target = catById(targetId);
  const directRuleCount = state.rules.filter((r) => r.category_id === targetId).length;
  const directMailCount = target.total ?? 0;
  if (directMailCount > 0 || directRuleCount > 0) {
    const parts = [];
    if (directMailCount > 0) parts.push(`${directMailCount} message${directMailCount === 1 ? '' : 's'}`);
    if (directRuleCount > 0) parts.push(`${directRuleCount} rule${directRuleCount === 1 ? '' : 's'}`);
    const ok = await showConfirm(
      `"${target.name}" currently has ${parts.join(' and ')} filed directly under it. Nesting "${dragged.name}" under it turns "${target.name}" into a parent category, which can't hold mail itself -- ${parts.join(' and ')} will be uncategorized or lose that category.`,
      { title: `Nest "${dragged.name}" under "${target.name}"?`, confirmText: 'Nest it', danger: true }
    );
    if (!ok) return;
  }
  try {
    const { demotedParent } = await api.updateCategory(draggedId, { parentId: targetId });
    // Reveal the nesting that just happened rather than leaving the moved
    // category hidden inside a still-collapsed parent.
    categoryTreeExpanded.add(targetId);
    saveCategoryTreeExpanded();
    if (demotedParent) {
      const bits = [];
      if (demotedParent.messagesUncategorized) bits.push(`${demotedParent.messagesUncategorized} message(s) uncategorized`);
      if (demotedParent.rulesRemoved) bits.push(`${demotedParent.rulesRemoved} rule(s) removed`);
      if (demotedParent.rulesUpdated) bits.push(`${demotedParent.rulesUpdated} rule(s) lost their category`);
      if (bits.length) showBanner(document.getElementById('category-tree-banner'), 'success', bits.join(', ') + '.');
    }
    await loadCategories();
  } catch (err) {
    showBanner(document.getElementById('category-tree-banner'), 'error', err.message);
  }
}

let dragCategoryId = null;

function wireCategoryDragAndDrop() {
  document.querySelectorAll('[data-cat-row]').forEach((row) => {
    const id = row.dataset.catRow;
    if (!row.draggable) return;
    row.addEventListener('dragstart', (e) => {
      dragCategoryId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.cat-tree-row.drag-over').forEach((r) => r.classList.remove('drag-over'));
      dragCategoryId = null;
    });
  });
  document.querySelectorAll('[data-cat-row]').forEach((row) => {
    const id = row.dataset.catRow;
    row.addEventListener('dragover', (e) => {
      if (!isValidCategoryDrop(dragCategoryId, id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const draggedId = dragCategoryId;
      dragCategoryId = null;
      if (!isValidCategoryDrop(draggedId, id)) return;
      nestCategoryOnto(draggedId, id);
    });
  });
}

function renderCategoryTree() {
  const top = categoryChildren(null);
  document.getElementById('category-grid').innerHTML =
    '<div id="category-tree-banner"></div>' +
    (top.length
      ? `<div class="cat-tree glass-card">${top.map((c) => categoryTreeRowHtml(c, 0)).join('')}</div>`
      : '<div class="empty-state">No categories yet.</div>');

  document.querySelectorAll('[data-toggle-cat]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.toggleCat;
      if (categoryTreeExpanded.has(id)) categoryTreeExpanded.delete(id);
      else categoryTreeExpanded.add(id);
      saveCategoryTreeExpanded();
      renderCategoryTree();
    };
  });
  document.querySelectorAll('[data-bulk-select]').forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.bulkSelect;
      if (cb.checked) categoryBulkSelected.add(id);
      else categoryBulkSelected.delete(id);
      updateCategoryBulkBar();
    };
  });
  updateCategoryBulkBar();
  document.querySelectorAll('[data-add-sub-cat]').forEach((btn) => {
    btn.onclick = () => openCategoryModal(null, btn.dataset.addSubCat);
  });
  document.querySelectorAll('[data-edit-cat]').forEach((btn) => {
    btn.onclick = () => openCategoryModal(catById(btn.dataset.editCat));
  });
  document.querySelectorAll('[data-del-cat]').forEach((btn) => {
    btn.onclick = async () => {
      const cat = catById(btn.dataset.delCat);
      const childCount = categoryChildren(cat.id).length;
      const msg = childCount
        ? `Mail in it becomes uncategorized, and its ${childCount} subcategor${childCount === 1 ? 'y moves' : 'ies move'} up a level.`
        : 'Mail in it becomes uncategorized.';
      if (!(await showConfirm(msg, { title: `Delete "${cat.name}"?`, confirmText: 'Delete', danger: true }))) return;
      await api.deleteCategory(btn.dataset.delCat);
      loadCategories();
    };
  });
  wireCategoryDragAndDrop();
}

// Which rule groups are expanded on the Categories page's rule list,
// persisted like the category tree's expand state -- collapsed by default
// so a large Gmail-imported rule set (70+ rules) doesn't dump every row on
// screen at once.
const RULE_GROUPS_EXPANDED_KEY = 'mail_rule_groups_expanded';
function loadRuleGroupsExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(RULE_GROUPS_EXPANDED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveRuleGroupsExpanded() {
  localStorage.setItem(RULE_GROUPS_EXPANDED_KEY, JSON.stringify([...ruleGroupsExpanded]));
}
const ruleGroupsExpanded = loadRuleGroupsExpanded();
const NO_CATEGORY_RULE_GROUP_KEY = '__none__';

function ruleRowHtml(r) {
  const actionBadges = [
    r.mark_trashed ? '<span class="rule-action-badge trash">Delete</span>' : '',
    r.mark_seen ? '<span class="rule-action-badge seen">Mark read</span>' : '',
  ].join('');
  const categoryLabel = r.category_id
    ? `<span class="chip-dot" style="background:${r.category_color};display:inline-block;width:0.6rem;height:0.6rem;border-radius:50%;margin-right:0.4rem;"></span>${escapeHtml(categoryPath(r.category_id))}`
    : '<span class="form-hint">(no label)</span>';
  return `
    <div class="rule-row">
      <span>${escapeHtml(r.name)}</span>
      <span class="form-hint">${r.field}</span>
      <span class="form-hint">${r.operator.replace('_', ' ')}</span>
      <span class="form-hint">"${escapeHtml(r.value)}"</span>
      <span>${categoryLabel}</span>
      <span class="rule-action-badges">${actionBadges}</span>
      <span style="display:flex;gap:0.3rem;">
        <button class="icon-btn" data-edit-rule="${r.id}" title="Edit">&#9998;</button>
        <button class="icon-btn" data-del-rule="${r.id}" title="Delete">&times;</button>
      </span>
    </div>`;
}

// Rules evaluate strictly by priority regardless of category (unaffected by
// any of this -- it's purely a display grouping), but a flat list of 70+
// imported rules is unreadable, so they're clustered into a collapsible
// dropdown per target category instead.
function renderRuleGroups() {
  const list = document.getElementById('rule-list');
  if (!state.rules.length) {
    list.innerHTML = '<div class="empty-state">No rules yet. Add one to start auto-sorting mail.</div>';
    return;
  }

  const groups = new Map();
  for (const r of state.rules) {
    const key = r.category_id || NO_CATEGORY_RULE_GROUP_KEY;
    if (!groups.has(key)) {
      groups.set(key, {
        label: r.category_id ? categoryPath(r.category_id) : 'No category (delete / mark-read only)',
        color: r.category_id ? r.category_color : null,
        rules: [],
      });
    }
    groups.get(key).rules.push(r);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === NO_CATEGORY_RULE_GROUP_KEY) return 1;
    if (b === NO_CATEGORY_RULE_GROUP_KEY) return -1;
    return groups.get(a).label.localeCompare(groups.get(b).label);
  });

  list.innerHTML = sortedKeys
    .map((key) => {
      const group = groups.get(key);
      const isExpanded = ruleGroupsExpanded.has(key);
      return `
      <div class="rule-group">
        <button type="button" class="rule-group-header" data-toggle-rule-group="${key}">
          <span class="cat-tree-expand-btn ${isExpanded ? 'expanded' : ''}" style="pointer-events:none;">&#9656;</span>
          <span class="chip-dot" style="background:${group.color || 'var(--text-muted)'};"></span>
          <span class="rule-group-label">${escapeHtml(group.label)}</span>
          <span class="form-hint">${group.rules.length} rule${group.rules.length === 1 ? '' : 's'}</span>
        </button>
        <div class="rule-group-body ${isExpanded ? '' : 'hidden'}">
          ${group.rules.map(ruleRowHtml).join('')}
        </div>
      </div>`;
    })
    .join('');

  document.querySelectorAll('[data-toggle-rule-group]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.toggleRuleGroup;
      if (ruleGroupsExpanded.has(key)) ruleGroupsExpanded.delete(key);
      else ruleGroupsExpanded.add(key);
      saveRuleGroupsExpanded();
      renderRuleGroups();
    };
  });
  document.querySelectorAll('[data-edit-rule]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRuleModal(state.rules.find((r) => r.id === btn.dataset.editRule));
    })
  );
  document.querySelectorAll('[data-del-rule]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rule = state.rules.find((r) => r.id === btn.dataset.delRule);
      if (!(await showConfirm('This stops it from matching any new mail.', { title: `Delete "${rule?.name || 'this rule'}"?`, confirmText: 'Delete', danger: true }))) return;
      await api.deleteRule(btn.dataset.delRule);
      loadCategories();
    })
  );
}

async function loadCategories() {
  showProgress();
  try {
    await refreshCategories();
    const { rules } = await api.listRules();
    state.rules = rules;

    renderCategoryTree();
    renderRuleGroups();
  } catch (err) {
    document.getElementById('category-grid').innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  } finally {
    hideProgress();
  }

  // Wired unconditionally so a failed initial fetch above doesn't leave
  // these dead for the rest of the session.
  document.getElementById('add-category-btn').onclick = () => openCategoryModal(null);
  document.getElementById('add-rule-btn').onclick = () => openRuleModal(null);
  document.getElementById('import-filters-btn').onclick = () => openImportFiltersModal();
  document.getElementById('category-bulk-move-btn').onclick = runCategoryBulkMove;
  document.getElementById('category-bulk-delete-btn').onclick = runCategoryBulkDelete;
  document.getElementById('category-bulk-cancel-btn').onclick = () => {
    categoryBulkSelected.clear();
    document.querySelectorAll('.cat-bulk-checkbox').forEach((cb) => (cb.checked = false));
    updateCategoryBulkBar();
  };
  document.getElementById('reapply-rules-btn').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Reapplying...';
    try {
      const r = await api.reapplyRules();
      alert(`Re-evaluated ${r.evaluated} messages, updated ${r.updated}.`);
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Reapply to existing mail';
    }
  };
}

// presetParentId: when opening via a tree row's "+" (add subcategory)
// button, pre-selects that row as the parent for a brand-new category.
function openCategoryModal(category, presetParentId) {
  const isEdit = !!category;
  let selectedParentId = isEdit ? category.parent_id || null : presetParentId || null;
  // A category can never become its own ancestor -- hide it and its whole
  // subtree from its own parent picker (the backend also rejects this, but
  // filtering it out here means you can't even see the option). The
  // built-in Primary category is excluded too -- it's the fallback for
  // uncategorized mail, so it can never itself become a parent.
  const excludeIds = new Set(state.categories.filter((c) => c.is_builtin).map((c) => c.id));
  if (isEdit) {
    excludeIds.add(category.id);
    for (const id of categoryDescendantIds(category.id)) excludeIds.add(id);
  }
  // The icon column defaults to legacy plain-word ids that were never meant
  // to be shown as text (see isEmojiIcon) -- only carry an existing value
  // over into the picker if it's actually a real emoji.
  let selectedIcon = isEmojiIcon(category?.icon) ? category.icon : null;

  openModal(
    `
    <h2>${isEdit ? 'Edit category' : 'New category'}</h2>
    <div class="form-field"><label>Name</label><input class="form-input" id="cat-name" value="${escapeHtml(category?.name || '')}"></div>
    <div class="form-field">
      <label>Parent category (optional)</label>
      <button type="button" class="form-select cat-picker-btn" id="cat-parent-btn" style="width:100%;">
        <span id="cat-parent-btn-label">${selectedParentId ? escapeHtml(categoryPath(selectedParentId)) : 'Top level'}</span>
      </button>
      <span class="form-hint">Nest this under another category to build sub/sub-subcategories -- the tree collapses on the Categories page so this doesn't add clutter.</span>
    </div>
    <div class="form-field"><label>Color</label><input type="color" id="cat-color" value="${category?.color || '#6366f1'}" style="width:4rem;height:2.4rem;border:none;background:none;"></div>
    <div class="form-field">
      <label>Icon</label>
      <div class="emoji-picker">
        <div class="cat-icon" id="cat-icon-preview" style="background:${category?.color || '#6366f1'};width:2.6rem;height:2.6rem;font-size:1rem;"></div>
        <div style="flex:1;min-width:0;">
          <div class="emoji-picker-grid">
            ${EMOJI_ICON_CHOICES.map((e) => `<button type="button" class="emoji-picker-btn" data-emoji="${e}">${e}</button>`).join('')}
          </div>
          <div class="emoji-picker-custom">
            <input type="text" class="form-input" id="cat-icon-custom" maxlength="8" placeholder="Or paste any emoji" value="${selectedIcon ? escapeHtml(selectedIcon) : ''}">
            <button type="button" class="btn btn-ghost btn-sm" id="cat-icon-clear">Use initials</button>
          </div>
        </div>
      </div>
    </div>
    <div id="cat-modal-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="cat-cancel">Cancel</button>
      <button class="btn btn-primary" id="cat-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>`,
    (overlay) => {
      const nameInput = overlay.querySelector('#cat-name');
      const colorInput = overlay.querySelector('#cat-color');
      const customIconInput = overlay.querySelector('#cat-icon-custom');
      const preview = overlay.querySelector('#cat-icon-preview');

      function updateIconPreview() {
        preview.style.background = colorInput.value;
        preview.textContent = selectedIcon || initials(nameInput.value);
        preview.style.fontSize = selectedIcon ? '1.15rem' : '1rem';
        overlay.querySelectorAll('.emoji-picker-btn').forEach((btn) => {
          btn.classList.toggle('selected', btn.dataset.emoji === selectedIcon);
        });
      }
      overlay.querySelectorAll('.emoji-picker-btn').forEach((btn) => {
        btn.onclick = () => {
          selectedIcon = btn.dataset.emoji;
          customIconInput.value = selectedIcon;
          updateIconPreview();
        };
      });
      customIconInput.oninput = () => {
        selectedIcon = customIconInput.value.trim() || null;
        updateIconPreview();
      };
      overlay.querySelector('#cat-icon-clear').onclick = () => {
        selectedIcon = null;
        customIconInput.value = '';
        updateIconPreview();
      };
      nameInput.addEventListener('input', updateIconPreview);
      colorInput.addEventListener('input', updateIconPreview);
      updateIconPreview();

      overlay.querySelector('#cat-parent-btn').onclick = () => {
        openCategoryPicker(overlay.querySelector('#cat-parent-btn'), {
          selectedId: selectedParentId,
          noneLabel: 'Top level',
          excludeIds,
          onSelect: (id) => {
            selectedParentId = id;
            overlay.querySelector('#cat-parent-btn-label').textContent = id ? categoryPath(id) : 'Top level';
          },
        });
      };
      overlay.querySelector('#cat-cancel').onclick = closeModal;
      overlay.querySelector('#cat-save').onclick = async () => {
        const name = nameInput.value.trim();
        const color = colorInput.value;
        if (!name) return;
        const icon = selectedIcon || 'tag';
        try {
          if (isEdit) await api.updateCategory(category.id, { name, color, icon, parentId: selectedParentId });
          else await api.createCategory({ name, color, icon, parentId: selectedParentId });
          closeModal();
          loadCategories();
        } catch (err) {
          showBanner(overlay.querySelector('#cat-modal-error'), 'error', err.message);
        }
      };
    }
  );
}

function openRuleModal(rule) {
  const isEdit = !!rule;
  const fields = ['from', 'to', 'domain', 'subject', 'body'];
  const operators = ['contains', 'equals', 'starts_with', 'ends_with'];
  let selectedCategoryId = rule?.category_id || null;
  openModal(
    `
    <h2>${isEdit ? 'Edit rule' : 'New rule'}</h2>
    <div class="form-field"><label>Name</label><input class="form-input" id="rule-name" value="${escapeHtml(rule?.name || '')}" placeholder="e.g. Flights"></div>
    <div class="form-row">
      <div class="form-field"><label>Field</label><select class="form-select" id="rule-field">${fields.map((f) => `<option value="${f}" ${rule?.field === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="form-field"><label>Operator</label><select class="form-select" id="rule-operator">${operators.map((o) => `<option value="${o}" ${rule?.operator === o ? 'selected' : ''}>${o.replace('_', ' ')}</option>`).join('')}</select></div>
    </div>
    <div class="form-field"><label>Value</label><input class="form-input" id="rule-value" value="${escapeHtml(rule?.value || '')}" placeholder="e.g. delta.com"></div>
    <div class="form-field">
      <label>Category (optional)</label>
      <button type="button" class="form-select cat-picker-btn" id="rule-category-btn" style="width:100%;">
        <span id="rule-category-btn-label">${selectedCategoryId ? escapeHtml(categoryPath(selectedCategoryId)) : '(no label)'}</span>
      </button>
    </div>
    <div class="form-field">
      <label style="display:flex;align-items:center;gap:0.5rem;font-weight:600;color:var(--text-primary);">
        <input type="checkbox" id="rule-trash" ${rule?.mark_trashed ? 'checked' : ''}> Delete matching mail automatically
      </label>
      <label style="display:flex;align-items:center;gap:0.5rem;font-weight:600;color:var(--text-primary);margin-top:0.4rem;">
        <input type="checkbox" id="rule-seen" ${rule?.mark_seen ? 'checked' : ''}> Mark matching mail as read automatically
      </label>
    </div>
    <div class="form-field"><label>Priority (higher wins ties)</label><input class="form-input" type="number" id="rule-priority" value="${rule?.priority ?? 0}"></div>
    <div id="rule-modal-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="rule-cancel">Cancel</button>
      <button class="btn btn-primary" id="rule-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#rule-category-btn').onclick = () => {
        openCategoryPicker(overlay.querySelector('#rule-category-btn'), {
          selectedId: selectedCategoryId,
          noneLabel: '(no label)',
          leafOnly: true,
          onSelect: (id) => {
            selectedCategoryId = id;
            overlay.querySelector('#rule-category-btn-label').textContent = id ? categoryPath(id) : '(no label)';
          },
        });
      };
      overlay.querySelector('#rule-cancel').onclick = closeModal;
      overlay.querySelector('#rule-save').onclick = async () => {
        const payload = {
          name: overlay.querySelector('#rule-name').value.trim(),
          field: overlay.querySelector('#rule-field').value,
          operator: overlay.querySelector('#rule-operator').value,
          value: overlay.querySelector('#rule-value').value.trim(),
          categoryId: selectedCategoryId,
          markTrashed: overlay.querySelector('#rule-trash').checked,
          markSeen: overlay.querySelector('#rule-seen').checked,
          priority: parseInt(overlay.querySelector('#rule-priority').value, 10) || 0,
        };
        if (!payload.name || !payload.value) return;
        if (!payload.categoryId && !payload.markTrashed && !payload.markSeen) {
          showBanner(overlay.querySelector('#rule-modal-error'), 'error', 'Pick a category, or an automatic action below.');
          return;
        }
        try {
          if (isEdit) await api.updateRule(rule.id, payload);
          else await api.createRule(payload);
          closeModal();
          loadCategories();
        } catch (err) {
          showBanner(overlay.querySelector('#rule-modal-error'), 'error', err.message);
        }
      };
    }
  );
}

function openImportFiltersModal() {
  openModal(
    `
    <h2>Import Gmail filters</h2>
    <p class="form-hint">
      In Gmail: Settings &rarr; See all settings &rarr; Filters and Blocked Addresses, select all your filters, and
      copy the whole list (each one shows as "Matches: ..." / "Do this: ..."). Paste it below. Sender-based label
      filters become categories + rules; "Delete it" and "Mark as read" become automatic actions. Filters with no
      usable sender/subject criteria, or no actionable instruction, are skipped and listed after import.
    </p>
    <div class="form-field"><textarea class="form-input" id="import-text" rows="10" style="min-height:200px;font-family:monospace;font-size:0.78rem;" placeholder="Matches: from:(someone@example.com)&#10;Do this: Apply label &quot;Newsletters/Example&quot;"></textarea></div>
    <div id="import-modal-status"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="import-cancel">Cancel</button>
      <button class="btn btn-primary" id="import-run">Import</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#import-cancel').onclick = closeModal;
      overlay.querySelector('#import-run').onclick = async (e) => {
        const text = overlay.querySelector('#import-text').value;
        const statusEl = overlay.querySelector('#import-modal-status');
        if (!text.trim()) return;
        e.target.disabled = true;
        e.target.innerHTML = '<span class="spinner"></span> Importing...';
        try {
          const r = await api.importFilters(text);
          let msg = `Created ${r.categoriesCreated} categories and ${r.rulesCreated} rules from ${r.entriesFound} filters.`;
          if (r.duplicateRulesSkipped) {
            msg += ` Skipped ${r.duplicateRulesSkipped} duplicate rule${r.duplicateRulesSkipped === 1 ? '' : 's'} (already covered by an existing one).`;
          }
          if (r.skipped) {
            msg += ` Skipped ${r.skipped} filter${r.skipped === 1 ? '' : 's'} with no usable sender/subject match or no actionable instruction.`;
          }
          showBanner(statusEl, 'success', msg);
          if (r.skippedDetails?.length) {
            statusEl.innerHTML += `<div class="form-hint" style="margin-top:0.5rem;max-height:120px;overflow-y:auto;">Skipped: ${r.skippedDetails.map((s) => escapeHtml(s)).join('<br>')}</div>`;
          }
          loadCategories();
        } catch (err) {
          showBanner(statusEl, 'error', err.message);
        } finally {
          e.target.disabled = false;
          e.target.textContent = 'Import';
        }
      };
    }
  );
}

// ===================== ACCOUNTS =====================
async function refreshAccounts() {
  const { accounts, providers } = await api.listAccounts();
  state.accounts = accounts;
  state.providers = providers;
  return accounts;
}

// Account ids with a backfill chain already running -- guards against
// piling up duplicate chains every time loadAccounts() re-renders (it can
// run repeatedly while the accounts view stays open: manual refresh, the
// auto-refresh after "Sync now", etc).
const activeBackfills = new Set();

async function runBackfillChain(accountId) {
  if (activeBackfills.has(accountId)) return;
  activeBackfills.add(accountId);
  try {
    while (state.view === 'accounts') {
      let result;
      try {
        result = await api.syncAccount(accountId);
      } catch {
        break; // sync_status/sync_error already reflects the failure; stop chaining.
      }
      if (state.view !== 'accounts') break;
      loadAccounts();
      if (result.backfillComplete !== false) break;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    activeBackfills.delete(accountId);
  }
}

async function loadAccounts() {
  const list = document.getElementById('accounts-list');
  // Only wipe to a spinner on a genuinely first load -- if we already have
  // accounts rendered from a previous visit, leave them on screen and
  // refresh quietly (the top progress bar covers the "this is updating"
  // signal instead of blanking the page every time this view is revisited).
  if (!state.accounts.length) list.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
  showProgress();
  try {
    await refreshAccounts();
    list.innerHTML = state.accounts.length
      ? state.accounts
          .map(
            (a) => `
      <div class="glass-card account-card" style="margin-bottom:0.75rem;">
        <span class="color-dot" style="background:${a.color}"></span>
        <div class="account-meta">
          <div class="account-email">${escapeHtml(a.display_name || a.email)}</div>
          <div class="account-sub">${escapeHtml(a.email)} &middot; ${escapeHtml(a.imap_host)}</div>
          ${a.sync_error ? `<div class="account-sub" style="color:var(--danger);">${escapeHtml(a.sync_error)}</div>` : ''}
        </div>
        <span class="status-pill ${a.sync_status}">${a.sync_status}</span>
        ${
          !a.backfill_complete && a.sync_status !== 'error'
            ? '<span class="status-pill backfilling" title="Pulling in older mail (including anything archived) in the background, a batch at a time">Backfilling&hellip;</span>'
            : ''
        }
        <button class="icon-btn" data-edit="${a.id}" title="Rename / recolor">&#9998;</button>
        <button class="icon-btn" data-sync="${a.id}" title="Sync now">&#8635;</button>
        <button class="icon-btn" data-remove="${a.id}" title="Remove">&times;</button>
      </div>`
          )
          .join('')
      : '<div class="empty-state">No accounts yet. Add one to start syncing real mail.</div>';

    list.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openEditAccountModal(state.accounts.find((a) => a.id === btn.dataset.edit)))
    );
    list.querySelectorAll('[data-sync]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.syncAccount(btn.dataset.sync);
        } catch (err) {
          alert(err.message);
        } finally {
          loadAccounts();
        }
      })
    );
    // Historical backfill (older mail, including anything archived) happens
    // in small bounded batches per sync call rather than all at once -- see
    // lib/imapSync.js -- so any account that isn't caught up yet gets its
    // next batch pulled in automatically while this page is open, instead
    // of making the user click "Sync now" over and over.
    state.accounts
      .filter((a) => !a.backfill_complete && a.sync_status !== 'error')
      .forEach((a) => runBackfillChain(a.id));
    list.querySelectorAll('[data-remove]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const account = state.accounts.find((a) => a.id === btn.dataset.remove);
        const ok = await showConfirm('Synced mail stays, but it will stop updating.', {
          title: `Remove ${account?.email || 'this account'}?`,
          confirmText: 'Remove',
          danger: true,
        });
        if (!ok) return;
        await api.deleteAccount(btn.dataset.remove);
        loadAccounts();
      })
    );
  } catch (err) {
    list.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  } finally {
    hideProgress();
  }

  document.getElementById('add-account-btn').onclick = openAccountModal;
}

function openEditAccountModal(account) {
  openModal(
    `
    <h2>Edit account</h2>
    <div class="form-field"><label>Display name</label><input class="form-input" id="edit-acct-name" value="${escapeHtml(account.display_name || '')}"></div>
    <div class="form-field"><label>Color</label><input type="color" id="edit-acct-color" value="${account.color}" style="width:4rem;height:2.4rem;border:none;background:none;"></div>
    <div id="edit-acct-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="edit-acct-cancel">Cancel</button>
      <button class="btn btn-primary" id="edit-acct-save">Save</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#edit-acct-cancel').onclick = closeModal;
      overlay.querySelector('#edit-acct-save').onclick = async (e) => {
        e.target.disabled = true;
        try {
          await api.updateAccount(account.id, {
            displayName: overlay.querySelector('#edit-acct-name').value.trim(),
            color: overlay.querySelector('#edit-acct-color').value,
          });
          closeModal();
          loadAccounts();
        } catch (err) {
          showBanner(overlay.querySelector('#edit-acct-error'), 'error', err.message);
          e.target.disabled = false;
        }
      };
    }
  );
}

function openAccountModal() {
  let selectedProvider = 'icloud';

  openModal(
    `
    <h2>Add account</h2>
    <div class="form-field">
      <label>Provider</label>
      <div class="provider-grid" id="provider-grid"></div>
    </div>
    <div class="form-field hidden" id="custom-host-field">
      <label>IMAP host</label>
      <input class="form-input" id="acct-host" placeholder="imap.example.com">
    </div>
    <div class="form-row">
      <div class="form-field"><label>Email address</label><input class="form-input" id="acct-email" placeholder="you@icloud.com"></div>
      <div class="form-field"><label>Username</label><input class="form-input" id="acct-username" placeholder="usually same as email"></div>
    </div>
    <div class="form-field">
      <label>Password (app-specific password, not your login password)</label>
      <input class="form-input" type="password" id="acct-password">
      <span class="form-hint">iCloud and Gmail both require you to generate a dedicated app password with 2FA enabled &mdash; your normal account password won't work over IMAP.</span>
    </div>
    <div class="form-field"><label>Color</label><input type="color" id="acct-color" value="#6366f1" style="width:4rem;height:2.4rem;border:none;background:none;"></div>
    <div id="acct-modal-status"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="acct-cancel">Cancel</button>
      <button class="btn btn-ghost" id="acct-test">Test connection</button>
      <button class="btn btn-primary" id="acct-save">Connect</button>
    </div>`,
    (overlay) => {
      const grid = overlay.querySelector('#provider-grid');
      const providers = { icloud: 'iCloud', gmail: 'Gmail', yahoo: 'Yahoo', fastmail: 'Fastmail', outlook: 'Outlook', custom: 'Other' };
      grid.innerHTML = Object.entries(providers)
        .map(
          ([id, label]) =>
            `<button type="button" class="provider-btn ${id === selectedProvider ? 'selected' : ''}" data-provider="${id}" ${id === 'outlook' ? 'disabled title="Not supported yet -- requires OAuth"' : ''}>${label}</button>`
        )
        .join('');
      grid.querySelectorAll('[data-provider]').forEach((btn) =>
        btn.addEventListener('click', () => {
          selectedProvider = btn.dataset.provider;
          grid.querySelectorAll('.provider-btn').forEach((b) => b.classList.toggle('selected', b === btn));
          overlay.querySelector('#custom-host-field').classList.toggle('hidden', selectedProvider !== 'custom');
        })
      );

      const gatherPayload = () => ({
        provider: selectedProvider,
        imapHost: selectedProvider === 'custom' ? overlay.querySelector('#acct-host').value.trim() : undefined,
        email: overlay.querySelector('#acct-email').value.trim(),
        username: overlay.querySelector('#acct-username').value.trim() || overlay.querySelector('#acct-email').value.trim(),
        password: overlay.querySelector('#acct-password').value,
        color: overlay.querySelector('#acct-color').value,
      });

      overlay.querySelector('#acct-cancel').onclick = closeModal;
      overlay.querySelector('#acct-test').onclick = async (e) => {
        const statusEl = overlay.querySelector('#acct-modal-status');
        e.target.disabled = true;
        try {
          const result = await api.testAccount(gatherPayload());
          showBanner(statusEl, result.ok ? 'success' : 'error', result.ok ? 'Connection succeeded.' : result.error);
        } catch (err) {
          showBanner(statusEl, 'error', err.message);
        } finally {
          e.target.disabled = false;
        }
      };
      overlay.querySelector('#acct-save').onclick = async (e) => {
        const statusEl = overlay.querySelector('#acct-modal-status');
        e.target.disabled = true;
        e.target.innerHTML = '<span class="spinner"></span> Connecting...';
        try {
          await api.createAccount(gatherPayload());
          closeModal();
          loadAccounts();
        } catch (err) {
          showBanner(statusEl, 'error', err.message);
          e.target.disabled = false;
          e.target.textContent = 'Connect';
        }
      };
    }
  );
}

// ===================== Settings: account =====================
function renderSettingsAccount() {
  const el = document.getElementById('settings-account-info');
  if (!state.user) return;
  el.innerHTML = `
    <div class="account-status-row">
      <span style="flex:1;">${escapeHtml(state.user.display_name || state.user.email)}</span>
      <span class="form-hint">${escapeHtml(state.user.email)}</span>
    </div>
    <button class="btn btn-ghost btn-sm" id="sign-out-btn" style="margin-top:0.75rem;">Sign out</button>
  `;
  document.getElementById('sign-out-btn').onclick = async () => {
    await api.logout().catch(() => {});
    location.reload();
  };

  const pwStatus = document.getElementById('settings-password-status');
  document.getElementById('settings-password-form').onsubmit = async (e) => {
    e.preventDefault();
    pwStatus.innerHTML = '';
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    try {
      await api.changePassword({ currentPassword, newPassword });
      showBanner(pwStatus, 'success', 'Password changed.');
      e.target.reset();
    } catch (err) {
      showBanner(pwStatus, 'error', err.message);
    }
  };

  document.getElementById('delete-account-btn').onclick = () => openDeleteAccountModal();
}

function openDeleteAccountModal() {
  openModal(
    `
    <h2>Delete your account?</h2>
    <p class="form-hint">This permanently deletes your account, connected mail accounts, synced messages,
      categories, and rules. This can't be undone. Enter your password to confirm.</p>
    <div class="form-field"><label>Password</label><input class="form-input" type="password" id="delete-account-password"></div>
    <div id="delete-account-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="delete-account-cancel">Cancel</button>
      <button class="btn btn-danger" id="delete-account-confirm">Delete my account</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#delete-account-cancel').onclick = closeModal;
      overlay.querySelector('#delete-account-confirm').onclick = async (e) => {
        const password = overlay.querySelector('#delete-account-password').value;
        if (!password) return;
        e.target.disabled = true;
        try {
          await api.deleteMyAccount(password);
          location.reload();
        } catch (err) {
          showBanner(overlay.querySelector('#delete-account-error'), 'error', err.message);
          e.target.disabled = false;
        }
      };
    }
  );
}

// ===================== Auth gate =====================
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === 'signup';
  document.getElementById('auth-subtitle').textContent = isSignup ? 'Create your account.' : 'Sign in to your inbox.';
  document.getElementById('auth-name-field').classList.toggle('hidden', !isSignup);
  document.getElementById('auth-password-hint').textContent = isSignup ? 'At least 8 characters.' : '';
  document.getElementById('auth-submit').textContent = isSignup ? 'Create account' : 'Sign in';
  document.getElementById('auth-toggle-mode').textContent = isSignup ? 'Already have an account? Sign in' : 'Need an account? Sign up';
  document.getElementById('auth-error').innerHTML = '';
}

function showAuthGate() {
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
  switchView('home');
  showChangelogIfNeeded();
}

function initAuthGate() {
  setAuthMode('login');
  document.getElementById('auth-toggle-mode').addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
  });
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('auth-error');
    errorEl.innerHTML = '';
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit');
    submitBtn.disabled = true;
    try {
      const { user } =
        authMode === 'signup'
          ? await api.signup({ email, password, displayName: document.getElementById('auth-name').value.trim() })
          : await api.login({ email, password });
      state.user = user;
      showApp();
    } catch (err) {
      showBanner(errorEl, 'error', err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ===================== What's new (changelog) =====================
// A dismissible summary of recent changes, shown once after the entries
// are added -- append a new entry (with the next id) whenever shipping a
// user-facing change. Every entry the user hasn't seen yet (id greater
// than their last-seen id, tracked in localStorage) is shown together in
// one popup, not just the newest one, so nothing gets skipped if they
// haven't opened the app in a while.
const CHANGELOG = [
  {
    id: 1,
    date: 'August 2026',
    items: [
      'Categories: drag one onto another to nest it, mass-select rows to move or delete several at once, and pick a custom emoji icon instead of just an initial.',
      "Only categories without their own subcategories can hold mail now — nesting one under a category that already has mail directly asks first, since it's becoming purely organizational.",
      'Sorting rules and the Categories tree are now collapsible groups instead of one long list, so a big Gmail import doesn’t dump 70+ rows on screen at once.',
      'Opening a message is now a modal instead of a side reading pane, and the Inbox list is full width.',
      "Unread mail's left-edge indicator now matches its category color instead of always being purple.",
      "Confirm dialogs (delete, move, etc.) use the app's own styled popup instead of the browser's native one.",
      'Switching to a page you’ve already visited no longer reloads everything from scratch — content stays up while it refreshes quietly in the background (thin progress bar at the top signals it).',
      'Modals and dropdowns are much less see-through, especially in dark mode.',
    ],
  },
];
const CHANGELOG_SEEN_KEY = 'mail_changelog_last_seen_id';

function showChangelogIfNeeded() {
  const lastSeen = parseInt(localStorage.getItem(CHANGELOG_SEEN_KEY) || '0', 10);
  const unseen = CHANGELOG.filter((entry) => entry.id > lastSeen);
  if (!unseen.length) return;
  // Marked as seen as soon as it's shown (not only on an explicit dismiss
  // click) -- closing it any way (X, click outside, the button) counts,
  // matching how every other "what's new" popup behaves.
  const maxId = Math.max(...CHANGELOG.map((entry) => entry.id));
  localStorage.setItem(CHANGELOG_SEEN_KEY, String(maxId));

  openModal(
    `
    <button type="button" class="modal-close-x" id="changelog-close-x" title="Close">&times;</button>
    <h2 style="padding-right:1.5rem;">What's new</h2>
    ${unseen
      .map(
        (entry) => `
      <div style="margin-bottom:1.1rem;">
        <div class="form-hint" style="margin-bottom:0.4rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(entry.date)}</div>
        <ul style="margin:0;padding-left:1.15rem;font-size:0.87rem;line-height:1.6;color:var(--text-secondary);">
          ${entry.items.map((item) => `<li style="margin-bottom:0.3rem;">${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>`
      )
      .join('')}
    <div class="modal-footer">
      <button class="btn btn-primary" id="changelog-dismiss-btn">Got it</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#changelog-close-x').onclick = closeModal;
      overlay.querySelector('#changelog-dismiss-btn').onclick = closeModal;
    },
    { wide: true }
  );
}

async function boot() {
  initTheme();
  initPalette();
  initNav();
  initAuthGate();
  initRefreshButton();

  // Fires on any 401 from any API call. A no-op during boot's own /auth/me
  // check and during login/signup failures (state.user is still null at
  // that point, so there's nothing to invalidate) -- only acts when a
  // session that was previously valid has expired mid-use.
  api.onUnauthorized = () => {
    if (!state.user) return;
    state.user = null;
    setAuthMode('login');
    showAuthGate();
    showBanner(document.getElementById('auth-error'), 'error', 'Your session expired. Please sign in again.');
  };

  try {
    const { user } = await api.me();
    state.user = user;
    showApp();
  } catch {
    showAuthGate();
  }
}

boot();
