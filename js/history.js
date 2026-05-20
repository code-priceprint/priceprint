// History screen. Every price log ever, newest first. Click any row to edit.
// Paginated — shows 50 rows at a time with a "show more" button to avoid
// rendering hundreds of <li>s on first paint.
import { getAllPriceLogs, getAllItems, getAllStores, updatePriceLog, deletePriceLog } from './db.js';
import { formatPrice, formatUnitPrice, formatFriendlyDate, formatCount, computeUnitPrice, UNIT_LABELS, FAMILIES } from './normalize.js';
import { openEditModal } from './edit.js';
import { mountDropdown } from './dropdown.js';

const PAGE_SIZE = 50;

export async function mountHistory(root) {
  const [logs, items, stores] = await Promise.all([getAllPriceLogs(), getAllItems(), getAllStores()]);

  if (logs.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">History</h2>
        <p class="empty-state">No price logs yet. Add one on <strong>LOG PRICE</strong> and it will appear here.</p>
      </section>
    `;
    return;
  }

  const itemById = new Map(items.map(i => [i.id, i]));
  const storeById = new Map(stores.map(s => [s.id, s]));

  // Per-item purchase counts so users can sort by most/least purchased item.
  const countByItem = new Map();
  for (const log of logs) countByItem.set(log.item_id, (countByItem.get(log.item_id) || 0) + 1);

  const SORT_KEY   = 'priceprint.history.sort';
  const STORE_KEY  = 'priceprint.history.store';
  const SEARCH_KEY = 'priceprint.history.search';

  const SORT_OPTIONS = [
    { value: 'date-desc',      label: 'Newest first' },
    { value: 'date-asc',       label: 'Oldest first' },
    { value: 'purchased-desc', label: 'Most purchased item' },
    { value: 'purchased-asc',  label: 'Least purchased item' },
    { value: 'unit-desc',      label: 'Highest unit price' },
    { value: 'unit-asc',       label: 'Lowest unit price' },
    { value: 'price-desc',     label: 'Highest price paid' },
    { value: 'price-asc',      label: 'Lowest price paid' },
    { value: 'item',           label: 'Item A → Z' },
    { value: 'store',          label: 'Store A → Z' },
  ];

  const STORE_OPTIONS = [
    { value: 'all', label: 'All stores' },
    ...stores.map(s => ({ value: String(s.id), label: s.name })),
  ];

  const sortMode  = sessionStorage.getItem(SORT_KEY)  || 'date-desc';
  const storeFilter = sessionStorage.getItem(STORE_KEY) || 'all';
  const searchQuery = sessionStorage.getItem(SEARCH_KEY) || '';

  function sortLogs(arr, mode) {
    arr = [...arr];
    if (mode === 'date-asc')        return arr.sort((a, b) => a.date.localeCompare(b.date));
    if (mode === 'price-desc')      return arr.sort((a, b) => b.price - a.price);
    if (mode === 'price-asc')       return arr.sort((a, b) => a.price - b.price);
    if (mode === 'unit-desc')       return arr.sort((a, b) => b.unit_price - a.unit_price);
    if (mode === 'unit-asc')        return arr.sort((a, b) => a.unit_price - b.unit_price);
    if (mode === 'purchased-desc')  return arr.sort((a, b) => (countByItem.get(b.item_id) || 0) - (countByItem.get(a.item_id) || 0));
    if (mode === 'purchased-asc')   return arr.sort((a, b) => (countByItem.get(a.item_id) || 0) - (countByItem.get(b.item_id) || 0));
    if (mode === 'item')            return arr.sort((a, b) => (itemById.get(a.item_id)?.name || '').localeCompare(itemById.get(b.item_id)?.name || ''));
    if (mode === 'store')           return arr.sort((a, b) => (storeById.get(a.store_id)?.name || '').localeCompare(storeById.get(b.store_id)?.name || ''));
    return arr.sort((a, b) => b.date.localeCompare(a.date));
  }

  function applyFilters(allLogs, storeId, query, mode) {
    let result = allLogs;
    if (storeId !== 'all') {
      const sid = Number(storeId);
      result = result.filter(l => l.store_id === sid);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(l => {
        const itemName = (itemById.get(l.item_id)?.name || '').toLowerCase();
        const storeName = (storeById.get(l.store_id)?.name || '').toLowerCase();
        return itemName.includes(q) || storeName.includes(q);
      });
    }
    return sortLogs(result, mode);
  }

  let sorted = applyFilters(logs, storeFilter, searchQuery, sortMode);

  let shown = Math.min(PAGE_SIZE, sorted.length);

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">History</h2>
      <div class="list-head">
        <span>${formatCount(logs.length)} log${logs.length === 1 ? '' : 's'}</span>
        <span>${formatCount(items.length)} item${items.length === 1 ? '' : 's'} · ${formatCount(stores.length)} store${stores.length === 1 ? '' : 's'}</span>
      </div>
      <div class="history-search">
        <input id="historySearch" type="text" autocomplete="off"
               placeholder="search by item or store…" value="${escapeHTML(searchQuery)}" />
        <button id="historySearchClear" class="history-search-clear" type="button"
                aria-label="clear search" ${searchQuery ? '' : 'hidden'}>×</button>
      </div>

      <div class="list-sort">
        <span class="list-sort-label">sort by</span>
        <div class="list-sort-dropdown" id="historySort"></div>
        <span class="list-sort-label" style="margin-left:8px">at</span>
        <div class="list-sort-dropdown" id="historyStore"></div>
      </div>
      <div id="historySummary"></div>
      <ul class="data-list" id="historyList"></ul>
      <div class="show-more-wrap" id="showMoreWrap" hidden>
        <div class="show-more-actions">
          <button id="showMoreBtn" class="link-btn" type="button">Show more</button>
          <span class="sep" id="showMoreSep" hidden>·</span>
          <button id="showLessBtn" class="link-btn" type="button" hidden>Show less</button>
        </div>
        <span id="showMoreNote" class="show-more-note"></span>
      </div>
    </section>
  `;

  const listEl = root.querySelector('#historyList');
  const moreWrap = root.querySelector('#showMoreWrap');
  const moreBtn = root.querySelector('#showMoreBtn');
  const lessBtn = root.querySelector('#showLessBtn');
  const sepEl   = root.querySelector('#showMoreSep');
  const moreNote = root.querySelector('#showMoreNote');

  function renderSummary() {
    const summaryEl = root.querySelector('#historySummary');
    if (!sorted.length) { summaryEl.innerHTML = ''; return; }
    const ups = sorted.map(l => l.unit_price);
    const minUP = Math.min(...ups);
    const avgUP = ups.reduce((s, p) => s + p, 0) / ups.length;
    const minLog = sorted.find(l => l.unit_price === minUP);
    const minStore = storeById.get(minLog.store_id);

    // Most frequent store across filtered set
    const storeCounts = new Map();
    for (const log of sorted) if (log.store_id) storeCounts.set(log.store_id, (storeCounts.get(log.store_id) || 0) + 1);
    let topStoreId = null, topCount = 0;
    for (const [sid, c] of storeCounts) if (c > topCount) { topCount = c; topStoreId = sid; }
    const topStore = topStoreId ? storeById.get(topStoreId) : null;

    // Most logged item across filtered set
    const itemCounts = new Map();
    for (const log of sorted) itemCounts.set(log.item_id, (itemCounts.get(log.item_id) || 0) + 1);
    let topItemId = null, topItemCount = 0;
    for (const [iid, c] of itemCounts) if (c > topItemCount) { topItemCount = c; topItemId = iid; }
    const topItem = topItemId ? itemById.get(topItemId) : null;

    // Earliest log date — "logging since X"
    const earliest = sorted.reduce((a, b) => (a.date < b.date ? a : b)).date;

    // Only show $/unit stats when the filtered set is a single item — mixed
    // items have inconsistent units and the avg/min would be meaningless.
    const uniqueItems = new Set(sorted.map(l => l.item_id));
    const singleItem = uniqueItems.size === 1;
    const displayUnit = singleItem ? displayUnitForUnit(sorted[0].unit) : null;

    summaryEl.innerHTML = `
      <div class="history-summary">
        <span class="hs-pill"><strong>${formatCount(sorted.length)}</strong> log${sorted.length === 1 ? '' : 's'}</span>
        ${singleItem ? `
          <span class="hs-pill">cheapest <strong>${formatUnitPrice(minUP, displayUnit)}</strong>${minStore ? ` at ${escapeHTML(minStore.name)}` : ''}</span>
          <span class="hs-pill">avg <strong>${formatUnitPrice(avgUP, displayUnit)}</strong></span>
        ` : ''}
        ${!singleItem && topItem ? `<span class="hs-pill">most logged: <strong>${escapeHTML(topItem.name)}</strong> (${formatCount(topItemCount)}×)</span>` : ''}
        ${topStore ? `<span class="hs-pill">most often at <strong>${escapeHTML(topStore.name)}</strong></span>` : ''}
        <span class="hs-pill">logging since <strong>${escapeHTML(formatFriendlyDate(earliest))}</strong></span>
      </div>
    `;
  }

  function renderRows() {
    renderSummary();
    listEl.innerHTML = sorted.slice(0, shown).map(log => rowHTML(log, itemById, storeById)).join('');
    const hasMore = shown < sorted.length;
    const hasLess = shown > PAGE_SIZE;
    moreBtn.hidden = !hasMore;
    lessBtn.hidden = !hasLess;
    sepEl.hidden = !(hasMore && hasLess);
    moreWrap.hidden = !(hasMore || hasLess);
    moreNote.textContent = hasMore
      ? `showing ${formatCount(shown)} of ${formatCount(sorted.length)}`
      : `showing all ${formatCount(sorted.length)}`;

    applyFlash(listEl, 'logId', 'data-id');
  }

  renderRows();

  moreBtn.addEventListener('click', () => {
    shown = Math.min(shown + PAGE_SIZE, sorted.length);
    renderRows();
  });
  lessBtn.addEventListener('click', () => {
    shown = PAGE_SIZE;
    renderRows();
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let currentSort   = sortMode;
  let currentStore  = storeFilter;
  let currentSearch = searchQuery;

  function reapply() {
    sorted = applyFilters(logs, currentStore, currentSearch, currentSort);
    shown = Math.min(PAGE_SIZE, sorted.length);
    renderRows();
  }

  mountDropdown(root.querySelector('#historySort'), {
    options: SORT_OPTIONS,
    value: sortMode,
    onChange: (mode) => {
      currentSort = mode;
      sessionStorage.setItem(SORT_KEY, mode);
      reapply();
    },
  });

  mountDropdown(root.querySelector('#historyStore'), {
    options: STORE_OPTIONS,
    value: storeFilter,
    onChange: (val) => {
      currentStore = val;
      sessionStorage.setItem(STORE_KEY, val);
      reapply();
    },
  });

  const searchEl = root.querySelector('#historySearch');
  const clearEl  = root.querySelector('#historySearchClear');
  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    clearEl.hidden = !searchEl.value;
    searchTimer = setTimeout(() => {
      currentSearch = searchEl.value;
      sessionStorage.setItem(SEARCH_KEY, currentSearch);
      reapply();
    }, 120);
  });
  clearEl.addEventListener('click', () => {
    searchEl.value = '';
    currentSearch = '';
    sessionStorage.setItem(SEARCH_KEY, '');
    clearEl.hidden = true;
    reapply();
    searchEl.focus();
  });


  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('li.clickable');
    if (!li) return;
    const id = Number(li.dataset.id);
    const log = sorted.find(l => l.id === id);
    if (!log) return;
    const item = itemById.get(log.item_id);
    const store = storeById.get(log.store_id);
    openEditModal({
      title: `Edit log: ${item ? item.name : 'item'}${store ? ` @ ${store.name}` : ''}`,
      fields: [
        { name: 'price', label: 'Price paid', type: 'number', step: '0.01', min: 0, value: log.price },
        { name: 'size',  label: 'Size',       type: 'number', step: 'any',  min: 0, value: log.size },
        { name: 'date',  label: 'When',       type: 'datetime-local', value: ensureDatetimeLocal(log.date) },
      ],
      onSave: async (vals) => {
        const price = parseFloat(vals.price);
        const size  = parseFloat(vals.size);
        if (!isFinite(price) || price <= 0) throw new Error('Price must be positive.');
        if (!isFinite(size)  || size  <= 0) throw new Error('Size must be positive.');
        if (!vals.date) throw new Error('When is required.');
        const calc = computeUnitPrice(size, log.unit, price);
        await updatePriceLog({
          ...log,
          price, size,
          date: vals.date,
          unit_price: calc ? calc.unit_price : log.unit_price,
        });
        window.dispatchEvent(new CustomEvent('priceprint:saved', { detail: { logId: log.id } }));
      },
      onDelete: async () => {
        await deletePriceLog(log.id);
        window.dispatchEvent(new CustomEvent('priceprint:saved'));
      },
    });
  });
}

function rowHTML(log, itemById, storeById) {
  const item = itemById.get(log.item_id);
  const store = storeById.get(log.store_id);
  const displayUnit = displayUnitForUnit(log.unit);
  const unitPrice = formatUnitPrice(log.unit_price, displayUnit);
  return `
    <li class="data-row clickable" data-id="${log.id}" data-item-id="${log.item_id}">
      <div class="data-row-main">
        <span class="data-name">${escapeHTML(item ? item.name : 'unknown item')}</span>
        ${log.is_sale ? `<span class="data-tag data-tag-sale">STORE SALE</span>` : ''}
      </div>
      <div class="data-row-meta">
        <span>${formatPrice(log.price)} · ${log.size}${UNIT_LABELS[log.unit] || log.unit}${store ? ` · ${escapeHTML(store.name)}` : ''}</span>
        <span class="data-unit-price">${unitPrice}</span>
      </div>
      <div class="data-row-date">${escapeHTML(formatFriendlyDate(log.date))}</div>
    </li>
  `;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

function ensureDatetimeLocal(d) {
  if (!d) return '';
  if (d.includes('T')) return d.slice(0, 16);
  return `${d}T12:00`; // date-only → noon as a sane default
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Read the relayed edit id from sessionStorage and apply a brief flash
// highlight to that row. One-shot — cleared after applying.
function applyFlash(listEl, key, dataAttr) {
  const raw = sessionStorage.getItem('priceprint.flashEdit');
  if (!raw) return;
  try {
    const detail = JSON.parse(raw);
    const id = detail[key];
    if (id == null) return;
    const row = listEl.querySelector(`li[${dataAttr}="${id}"]`);
    if (!row) return;
    // Defer to next frame so the animation actually plays after mount
    requestAnimationFrame(() => {
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1800);
    });
  } catch {}
  sessionStorage.removeItem('priceprint.flashEdit');
}
