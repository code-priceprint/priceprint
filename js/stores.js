// Stores screen. Per-store stats + win count (from compare logic) + tap-to-detail
// modal showing best/worst items at that store and sale reliability.
import { getAllStores, getAllItems, getAllPriceLogs, upsertStore, deleteStore } from './db.js';
import { formatCount, formatPrice, formatUnitPrice, FAMILIES } from './normalize.js';
import { openEditModal } from './edit.js';

export async function mountStores(root) {
  const [stores, items, logs] = await Promise.all([getAllStores(), getAllItems(), getAllPriceLogs()]);

  if (stores.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Stores</h2>
        <p class="empty-state">No stores yet. Log a price on <strong>LOG PRICE</strong> and the store name you type will show up here.</p>
        <div class="actions"><button id="addStoreBtnEmpty" class="primary" type="button">+ Add a store</button></div>
      </section>
    `;
    root.querySelector('#addStoreBtnEmpty').addEventListener('click', () => openStoreEditor(null, items, logs));
    return;
  }

  // Per-store stats — items tracked, logs, win count (replicates compare logic)
  const stats = computeStoreStats(stores, items, logs);

  // Rank stores by win count (descending) for the visual badge
  const ranked = [...stores].sort((a, b) => (stats.get(b.id)?.wins || 0) - (stats.get(a.id)?.wins || 0));
  const topStoreId = ranked[0] && stats.get(ranked[0].id)?.wins > 0 ? ranked[0].id : null;

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Stores</h2>

      <div class="add-store-bar">
        <button id="addStoreBtn" class="modal-top-action" type="button">+ Add a new store</button>
      </div>

      <div class="list-head">
        <span>${formatCount(stores.length)} store${stores.length === 1 ? '' : 's'}</span>
        <span>${formatCount(items.length)} item${items.length === 1 ? '' : 's'} tracked</span>
      </div>

      <ul class="data-list" id="storesList">
        ${ranked.map(s => {
          const st = stats.get(s.id) || { logs: 0, items: 0, wins: 0 };
          const isTop = s.id === topStoreId;
          const showChain = s.chain && s.chain.toLowerCase() !== s.name.toLowerCase();
          return `
            <li class="data-row clickable" data-id="${s.id}">
              <div class="data-row-main">
                <span class="data-name">
                  ${isTop ? '<span class="rank-medal">★</span> ' : ''}
                  ${escapeHTML(s.name)}
                  ${s.location ? `<span class="store-loc">· ${escapeHTML(s.location)}</span>` : ''}
                </span>
                ${st.wins > 0
                  ? `<span class="data-delta data-delta-good">${formatCount(st.wins)} win${st.wins === 1 ? '' : 's'}</span>`
                  : ''}
              </div>
              <div class="data-row-meta">
                <span>${formatCount(st.items)} item${st.items === 1 ? '' : 's'} · ${formatCount(st.logs)} log${st.logs === 1 ? '' : 's'}</span>
                ${showChain ? `<span class="data-cat">${escapeHTML(s.chain)}</span>` : ''}
              </div>
              ${isTop ? '<div class="data-row-meta"><span class="store-best-note">overall cheapest store</span></div>' : ''}
            </li>
          `;
        }).join('')}
      </ul>
    </section>
  `;

  // Flash recently-edited row if relayed via sessionStorage
  const storesListEl = root.querySelector('#storesList');
  const flashRaw = sessionStorage.getItem('priceprint.flashEdit');
  if (flashRaw) {
    try {
      const detail = JSON.parse(flashRaw);
      if (detail.storeId != null) {
        const row = storesListEl.querySelector(`li[data-id="${detail.storeId}"]`);
        if (row) requestAnimationFrame(() => {
          row.classList.add('flash');
          setTimeout(() => row.classList.remove('flash'), 1800);
        });
      }
    } catch {}
    sessionStorage.removeItem('priceprint.flashEdit');
  }

  storesListEl.addEventListener('click', (e) => {
    const li = e.target.closest('li.clickable');
    if (!li) return;
    const id = Number(li.dataset.id);
    const s = stores.find(x => x.id === id);
    if (!s) return;
    openStoreEditor(s, items, logs);
  });

  root.querySelector('#addStoreBtn').addEventListener('click', () => openStoreEditor(null, items, logs));
}

// Open the edit modal for a store (or for a new store if s is null), with the
// store-detail analysis (best/worst items + sale reliability) in the body.
function openStoreEditor(s, items, logs) {
  const isNew = !s;
  const detailBody = isNew ? '' : buildStoreDetailBody(s, items, logs);
  const logCount = isNew ? 0 : logs.filter(l => l.store_id === s.id).length;

  openEditModal({
    title: isNew ? 'Add a new store' : s.name,
    body: detailBody,
    fields: [
      { name: 'name',     label: 'Name',                value: isNew ? '' : s.name },
      { name: 'location', label: 'Location (optional)', value: isNew ? '' : (s.location || '') },
      { name: 'chain',    label: 'Chain (optional)',    value: isNew ? '' : (s.chain || '') },
    ],
    onSave: async (vals) => {
      const name = vals.name.trim();
      if (!name) throw new Error('Name is required.');
      const next = {
        ...(isNew ? {} : s),
        name,
        location: vals.location.trim(),
        chain:    vals.chain.trim(),
      };
      const newId = await upsertStore(next);
      const flashId = isNew ? newId : s.id;
      window.dispatchEvent(new CustomEvent('priceprint:saved', { detail: { storeId: flashId } }));
    },
    ...(isNew ? {} : {
      onDelete: async () => {
        await deleteStore(s.id);
        window.dispatchEvent(new CustomEvent('priceprint:saved'));
      },
      deleteLabel: `Delete this store${logCount > 0 ? ` and unlink its ${logCount} log${logCount === 1 ? '' : 's'}` : ''}`,
      deleteMessage: logCount > 0
        ? `Delete this store? Its ${logCount} price log${logCount === 1 ? '' : 's'} will stay in your history but will no longer be associated with this store. This cannot be undone.`
        : `Delete this store? This cannot be undone.`,
    }),
  });
}

// Body content for the store detail modal — stats + best/worst items + sale reliability.
function buildStoreDetailBody(store, items, logs) {
  const myLogs = logs.filter(l => l.store_id === store.id);
  if (myLogs.length === 0) {
    return '<p class="empty-state">No price logs at this store yet.</p>';
  }

  const itemById = new Map(items.map(i => [i.id, i]));

  // Compare each item's avg here vs other stores
  const comparisons = []; // { item, avgHere, avgOthers, deltaPct }
  const byItemHere = new Map();
  for (const log of myLogs) {
    if (!byItemHere.has(log.item_id)) byItemHere.set(log.item_id, []);
    byItemHere.get(log.item_id).push(log.unit_price);
  }
  for (const [itemId, prices] of byItemHere) {
    const otherLogs = logs.filter(l => l.item_id === itemId && l.store_id && l.store_id !== store.id);
    if (otherLogs.length === 0) continue; // can't compare
    const avgHere = prices.reduce((s, p) => s + p, 0) / prices.length;
    const avgOthers = otherLogs.reduce((s, l) => s + l.unit_price, 0) / otherLogs.length;
    const deltaPct = avgOthers > 0 ? ((avgHere - avgOthers) / avgOthers) * 100 : 0;
    const item = itemById.get(itemId);
    if (!item) continue;
    comparisons.push({ item, avgHere, avgOthers, deltaPct, count: prices.length, unit: myLogs.find(l => l.item_id === itemId)?.unit });
  }

  // Top 5 best (most below other stores) and top 5 worst (most above)
  const best = [...comparisons].filter(c => c.deltaPct < 0).sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5);
  const worst = [...comparisons].filter(c => c.deltaPct > 0).sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5);

  // Sale reliability: of sale-flagged logs at this store, how many were below historical avg?
  const saleLogs = myLogs.filter(l => l.is_sale);
  let realSales = 0;
  let fakeSales = 0;
  for (const sl of saleLogs) {
    const itemLogs = logs.filter(l => l.item_id === sl.item_id && l.id !== sl.id);
    if (itemLogs.length === 0) continue;
    const avg = itemLogs.reduce((s, l) => s + l.unit_price, 0) / itemLogs.length;
    if (sl.unit_price < avg * 0.99) realSales++;
    else fakeSales++;
  }
  const saleTotal = realSales + fakeSales;
  const reliabilityPct = saleTotal > 0 ? (realSales / saleTotal) * 100 : null;

  // Date range
  const dates = myLogs.map(l => l.date).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  const renderRow = (c, sign) => {
    const displayUnit = displayUnitForUnit(c.unit);
    const cls = sign === 'good' ? 'data-delta-good' : 'data-delta-bad';
    const pct = c.deltaPct;
    return `
      <li class="data-row">
        <div class="data-row-main">
          <span class="data-name">${escapeHTML(c.item.name)}</span>
          <span class="data-delta ${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span>
        </div>
        <div class="data-row-meta">
          <span>here: <strong>${formatUnitPrice(c.avgHere, displayUnit)}</strong> · elsewhere: ${formatUnitPrice(c.avgOthers, displayUnit)}</span>
          <span class="data-cat">${formatCount(c.count)} log${c.count === 1 ? '' : 's'}</span>
        </div>
      </li>
    `;
  };

  return `
    <div class="store-stats-grid">
      <div class="store-stat">
        <span class="store-stat-num">${formatCount(byItemHere.size)}</span>
        <span class="store-stat-label">items tracked</span>
      </div>
      <div class="store-stat">
        <span class="store-stat-num">${formatCount(myLogs.length)}</span>
        <span class="store-stat-label">logs</span>
      </div>
      <div class="store-stat">
        <span class="store-stat-num">${reliabilityPct == null ? '—' : `${reliabilityPct.toFixed(0)}%`}</span>
        <span class="store-stat-label">sale reliability${saleTotal > 0 ? ` · ${formatCount(saleTotal)} checked` : ''}</span>
      </div>
    </div>

    ${best.length > 0 ? `
      <div class="list-head"><span>cheapest here</span><span>vs other stores</span></div>
      <ul class="data-list">${best.map(c => renderRow(c, 'good')).join('')}</ul>
    ` : ''}

    ${worst.length > 0 ? `
      <div class="list-head"><span>priciest here</span><span>vs other stores</span></div>
      <ul class="data-list">${worst.map(c => renderRow(c, 'bad')).join('')}</ul>
    ` : ''}

    <p class="compare-footnote">Logging at this store since ${escapeHTML(earliest.split('T')[0])} · last log ${escapeHTML(latest.split('T')[0])}.</p>
  `;
}

function computeStoreStats(stores, items, logs) {
  const stats = new Map();
  for (const s of stores) stats.set(s.id, { items: new Set(), logs: 0, wins: 0 });
  for (const log of logs) {
    if (!log.store_id) continue;
    const entry = stats.get(log.store_id);
    if (!entry) continue;
    entry.logs++;
    entry.items.add(log.item_id);
  }
  // Win count: for each item with 2+ stores tracked, the cheapest store wins
  for (const item of items) {
    const itemLogs = logs.filter(l => l.item_id === item.id && l.store_id);
    if (itemLogs.length === 0) continue;
    const byStore = new Map();
    for (const log of itemLogs) {
      if (!byStore.has(log.store_id)) byStore.set(log.store_id, []);
      byStore.get(log.store_id).push(log.unit_price);
    }
    if (byStore.size < 2) continue;
    let cheapestId = null, cheapestAvg = Infinity;
    for (const [sid, prices] of byStore) {
      const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
      if (avg < cheapestAvg) { cheapestAvg = avg; cheapestId = sid; }
    }
    if (cheapestId && stats.has(cheapestId)) stats.get(cheapestId).wins++;
  }
  // Convert items Set to count
  for (const entry of stats.values()) entry.items = entry.items.size;
  return stats;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
