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
function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}
function showBanner(container, type, message) {
  container.innerHTML = `<div class="banner ${type}">${escapeHtml(message)}</div>`;
}

// ===================== Modal =====================
function openModal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="active-modal-overlay"><div class="modal-box">${html}</div></div>`;
  const overlay = document.getElementById('active-modal-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  if (onMount) onMount(overlay);
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// ===================== HOME =====================
async function loadHome() {
  const greeting = document.getElementById('home-greeting');
  const hour = new Date().getHours();
  greeting.textContent = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';

  const bannerContainer = document.getElementById('home-banner-container');
  bannerContainer.innerHTML = '';
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

    document.getElementById('home-category-breakdown').innerHTML =
      stats.categories.length === 0
        ? '<div class="empty-state">No categories yet.</div>'
        : stats.categories
            .map(
              (c) => `
        <div class="account-status-row">
          <span class="color-dot" style="background:${c.color}"></span>
          <span style="flex:1;">${escapeHtml(c.name)}</span>
          <span class="form-hint">${c.total} total${c.unread > 0 ? ` &middot; ${c.unread} unread` : ''}</span>
        </div>`
            )
            .join('');

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
              return `
        <div class="message-row ${m.seen ? '' : 'unread'}" data-open-message="${m.id}" style="margin-bottom:0.5rem;">
          ${m.seen ? '' : '<span class="unread-dot"></span>'}
          ${cat ? `<span class="msg-cat-dot" style="background:${cat.color}"></span>` : ''}
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

function renderCategoryRail() {
  const rail = document.getElementById('inbox-category-rail');
  const chips = [
    `<button class="category-chip ${state.inbox.category === null ? 'active' : ''}" data-cat="" style="${state.inbox.category === null ? 'background:var(--accent-grad);' : ''}">All</button>`,
    ...state.categories.map((c) => {
      const active = state.inbox.category === c.id;
      return `<button class="category-chip ${active ? 'active' : ''}" data-cat="${c.id}" style="${active ? `background:${c.color};` : ''}">
        <span class="chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
        ${c.unread_count > 0 ? `<span class="chip-count">${c.unread_count}</span>` : ''}
      </button>`;
    }),
  ];
  rail.innerHTML = chips.join('');
  rail.querySelectorAll('[data-cat]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.inbox.category = btn.dataset.cat || null;
      renderCategoryRail();
      loadMessages();
    })
  );
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
  try {
    await refreshCategories();
    if (!state.accounts.length) await refreshAccounts();
    renderCategoryRail();
    await loadMessages();
  } catch (err) {
    document.getElementById('inbox-message-list').innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
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
  return `
      <div class="message-row ${m.seen ? '' : 'unread'} ${m.id === state.inbox.selectedId ? 'selected' : ''}" data-id="${m.id}">
        <input type="checkbox" class="msg-select-checkbox" data-select-id="${m.id}" ${state.inbox.selected.has(m.id) ? 'checked' : ''} onclick="event.stopPropagation()">
        ${m.seen ? '' : '<span class="unread-dot"></span>'}
        ${cat ? `<span class="msg-cat-dot" style="background:${cat.color}"></span>` : '<span class="msg-cat-dot" style="background:transparent"></span>'}
        <div class="msg-main">
          <div class="msg-top-line">
            <span class="msg-from">${escapeHtml(m.from_name || m.from_email)}</span>
            <span class="msg-date">${m.flagged ? '<span class="msg-flag">&#9733;</span> ' : ''}${timeAgo(m.date)}</span>
          </div>
          <div class="msg-subject">${escapeHtml(m.subject)}</div>
          <div class="msg-snippet">${escapeHtml(m.snippet)}</div>
          <select class="sort-select" data-sort-id="${m.id}" onclick="event.stopPropagation()">
            <option value="">Sort into&hellip;</option>
            ${state.categories.map((c) => `<option value="${c.id}" ${c.id === m.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
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
  container.querySelectorAll('[data-sort-id]').forEach((sel) => {
    sel.onchange = async () => {
      if (!sel.value) return;
      await api.updateMessage(sel.dataset.sortId, { categoryId: sel.value });
      await refreshCategories();
      renderCategoryRail();
      loadMessages();
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
  if (reset) {
    state.inbox.offset = 0;
    state.inbox.messages = [];
    state.inbox.selected.clear();
    updateBulkBar();
    list.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
  }
  const params = { mailbox: state.inbox.mailbox, limit: String(MESSAGES_PAGE_SIZE), offset: String(state.inbox.offset) };
  if (state.inbox.category) params.category = state.inbox.category;
  if (state.inbox.q) params.q = state.inbox.q;
  if (state.inbox.filterFlag === 'unread') params.unread = 'true';
  if (state.inbox.filterFlag === 'needsReply') params.needsReply = 'true';
  if (state.inbox.filterFlag === 'flagged') params.flagged = 'true';
  try {
    const { messages } = await api.listMessages(params);
    state.inbox.hasMore = messages.length === MESSAGES_PAGE_SIZE;
    state.inbox.offset += messages.length;
    state.inbox.messages = reset ? messages : [...state.inbox.messages, ...messages];

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

async function selectMessage(id) {
  state.inbox.selectedId = id;
  document.querySelectorAll('.message-row').forEach((r) => r.classList.toggle('selected', r.dataset.id === id));
  const pane = document.getElementById('reading-pane');
  pane.innerHTML = '<div class="reading-pane-empty"><span class="spinner"></span></div>';
  try {
    const { message: m } = await api.getMessage(id);

    let thread = [m];
    if (m.thread_id) {
      const { messages: siblings } = await api.listMessages({ threadId: m.thread_id, limit: '200' });
      if (siblings.length > 1) thread = [...siblings].reverse(); // API returns newest-first; a conversation reads oldest-first
    }

    pane.innerHTML =
      (thread.length > 1
        ? `<div class="form-hint" style="margin-bottom:0.75rem;">${thread.length} messages in this conversation</div>`
        : '') + thread.map((tm) => messageCardHtml(tm, tm.id === id)).join('');

    const primaryCard = pane.querySelector(`[data-thread-card="${id}"]`);
    primaryCard.querySelector('[data-act="flag"]').onclick = async () => {
      await api.updateMessage(id, { flagged: !m.flagged });
      selectMessage(id);
    };
    primaryCard.querySelector('[data-act="archive"]').onclick = async () => {
      await api.updateMessage(id, { archived: true });
      pane.innerHTML = '<div class="reading-pane-empty">Archived.</div>';
      loadMessages();
    };
    primaryCard.querySelector('[data-act="trash"]').onclick = async () => {
      await api.updateMessage(id, { trashed: true });
      pane.innerHTML = '<div class="reading-pane-empty">Moved to trash.</div>';
      loadMessages();
    };
    // reflect read state in the list without a full reload
    const row = document.querySelector(`.message-row[data-id="${id}"]`);
    if (row) row.classList.remove('unread');
  } catch (err) {
    pane.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
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
async function loadCategories() {
  try {
    await refreshCategories();
    const { rules } = await api.listRules();
    state.rules = rules;

    document.getElementById('category-grid').innerHTML = state.categories
      .map(
        (c) => `
      <div class="glass-card category-card">
        <div class="cat-icon" style="background:${c.color}">${initials(c.name)}</div>
        <div style="flex:1;">
          <div style="font-weight:700;">${escapeHtml(c.name)}</div>
          <div class="form-hint">${c.total ?? 0} total &middot; ${c.unread_count ?? 0} unread</div>
        </div>
        ${c.is_builtin ? '' : `<button class="icon-btn" data-edit-cat="${c.id}" title="Edit">&#9998;</button><button class="icon-btn" data-del-cat="${c.id}" title="Delete">&times;</button>`}
      </div>`
      )
      .join('');
    document.querySelectorAll('[data-edit-cat]').forEach((btn) => btn.addEventListener('click', () => openCategoryModal(catById(btn.dataset.editCat))));
    document.querySelectorAll('[data-del-cat]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this category? Mail in it becomes uncategorized.')) return;
        await api.deleteCategory(btn.dataset.delCat);
        loadCategories();
      })
    );

    document.getElementById('rule-list').innerHTML = state.rules.length
      ? state.rules
          .map(
            (r) => `
      <div class="rule-row">
        <span>${escapeHtml(r.name)}</span>
        <span class="form-hint">${r.field}</span>
        <span class="form-hint">${r.operator.replace('_', ' ')}</span>
        <span class="form-hint">"${escapeHtml(r.value)}"</span>
        <span><span class="chip-dot" style="background:${r.category_color};display:inline-block;width:0.6rem;height:0.6rem;border-radius:50%;margin-right:0.4rem;"></span>${escapeHtml(r.category_name)}</span>
        <span class="rule-priority-badge">P${r.priority}</span>
        <span style="display:flex;gap:0.3rem;">
          <button class="icon-btn" data-edit-rule="${r.id}" title="Edit">&#9998;</button>
          <button class="icon-btn" data-del-rule="${r.id}" title="Delete">&times;</button>
        </span>
      </div>`
          )
          .join('')
      : '<div class="empty-state">No rules yet. Add one to start auto-sorting mail.</div>';
    document.querySelectorAll('[data-edit-rule]').forEach((btn) => btn.addEventListener('click', () => openRuleModal(state.rules.find((r) => r.id === btn.dataset.editRule))));
    document.querySelectorAll('[data-del-rule]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this rule?')) return;
        await api.deleteRule(btn.dataset.delRule);
        loadCategories();
      })
    );
  } catch (err) {
    document.getElementById('category-grid').innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }

  // Wired unconditionally so a failed initial fetch above doesn't leave
  // these dead for the rest of the session.
  document.getElementById('add-category-btn').onclick = () => openCategoryModal(null);
  document.getElementById('add-rule-btn').onclick = () => openRuleModal(null);
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

function openCategoryModal(category) {
  const isEdit = !!category;
  openModal(
    `
    <h2>${isEdit ? 'Edit category' : 'New category'}</h2>
    <div class="form-field"><label>Name</label><input class="form-input" id="cat-name" value="${escapeHtml(category?.name || '')}"></div>
    <div class="form-field"><label>Color</label><input type="color" id="cat-color" value="${category?.color || '#6366f1'}" style="width:4rem;height:2.4rem;border:none;background:none;"></div>
    <div id="cat-modal-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="cat-cancel">Cancel</button>
      <button class="btn btn-primary" id="cat-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#cat-cancel').onclick = closeModal;
      overlay.querySelector('#cat-save').onclick = async () => {
        const name = overlay.querySelector('#cat-name').value.trim();
        const color = overlay.querySelector('#cat-color').value;
        if (!name) return;
        try {
          if (isEdit) await api.updateCategory(category.id, { name, color });
          else await api.createCategory({ name, color });
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
  openModal(
    `
    <h2>${isEdit ? 'Edit rule' : 'New rule'}</h2>
    <div class="form-field"><label>Name</label><input class="form-input" id="rule-name" value="${escapeHtml(rule?.name || '')}" placeholder="e.g. Flights"></div>
    <div class="form-row">
      <div class="form-field"><label>Field</label><select class="form-select" id="rule-field">${fields.map((f) => `<option value="${f}" ${rule?.field === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="form-field"><label>Operator</label><select class="form-select" id="rule-operator">${operators.map((o) => `<option value="${o}" ${rule?.operator === o ? 'selected' : ''}>${o.replace('_', ' ')}</option>`).join('')}</select></div>
    </div>
    <div class="form-field"><label>Value</label><input class="form-input" id="rule-value" value="${escapeHtml(rule?.value || '')}" placeholder="e.g. delta.com"></div>
    <div class="form-field"><label>Category</label><select class="form-select" id="rule-category">${state.categories.map((c) => `<option value="${c.id}" ${rule?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
    <div class="form-field"><label>Priority (higher wins ties)</label><input class="form-input" type="number" id="rule-priority" value="${rule?.priority ?? 0}"></div>
    <div id="rule-modal-error"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="rule-cancel">Cancel</button>
      <button class="btn btn-primary" id="rule-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>`,
    (overlay) => {
      overlay.querySelector('#rule-cancel').onclick = closeModal;
      overlay.querySelector('#rule-save').onclick = async () => {
        const payload = {
          name: overlay.querySelector('#rule-name').value.trim(),
          field: overlay.querySelector('#rule-field').value,
          operator: overlay.querySelector('#rule-operator').value,
          value: overlay.querySelector('#rule-value').value.trim(),
          categoryId: overlay.querySelector('#rule-category').value,
          priority: parseInt(overlay.querySelector('#rule-priority').value, 10) || 0,
        };
        if (!payload.name || !payload.value) return;
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

// ===================== ACCOUNTS =====================
async function refreshAccounts() {
  const { accounts, providers } = await api.listAccounts();
  state.accounts = accounts;
  state.providers = providers;
  return accounts;
}

async function loadAccounts() {
  const list = document.getElementById('accounts-list');
  list.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
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
    list.querySelectorAll('[data-remove]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this account? Synced mail stays, but it will stop updating.')) return;
        await api.deleteAccount(btn.dataset.remove);
        loadAccounts();
      })
    );
  } catch (err) {
    list.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
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

async function boot() {
  initTheme();
  initPalette();
  initNav();
  initAuthGate();

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
