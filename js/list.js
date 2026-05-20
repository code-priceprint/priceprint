// Items list screen. Shows every item the user has logged, with last-price info.
import { getAllItems, getAllPriceLogs, getAllStores, upsertItem, deleteItem } from './db.js';
import { formatPrice, formatUnitPrice, formatFriendlyDate, formatCount, dayOfWeek, DAY_NAMES, UNIT_LABELS, FAMILIES, colorForStoreId } from './normalize.js';
import { openEditModal } from './edit.js';
import { mountDropdown } from './dropdown.js';

export async function mountList(root) {
  const [items, logs, stores] = await Promise.all([getAllItems(), getAllPriceLogs(), getAllStores()]);

  if (items.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Items</h2>
        <p class="empty-state">You haven't logged anything yet. Head over to <strong>LOG PRICE</strong> to add your first item.</p>
      </section>
    `;
    return;
  }

  // Build per-item last log lookup + purchase frequency count
  const lastByItem = new Map();
  const countByItem = new Map();
  for (const log of logs) {
    countByItem.set(log.item_id, (countByItem.get(log.item_id) || 0) + 1);
    const prev = lastByItem.get(log.item_id);
    if (!prev || log.date > prev.date) lastByItem.set(log.item_id, log);
  }
  const storeNameById = new Map(stores.map(s => [s.id, s.name]));

  // Sort mode persisted in sessionStorage. Default = most bought, since that's
  // what users actually care about ("which items am I always buying?").
  const SORT_KEY = 'priceprint.list.sort';
  const sortMode = sessionStorage.getItem(SORT_KEY) || 'frequent';

  const SORT_OPTIONS = [
    { value: 'frequent',  label: 'Most purchased' },
    { value: 'leastfreq', label: 'Least purchased' },
    { value: 'recent',    label: 'Most recent' },
    { value: 'alpha',     label: 'A → Z' },
  ];
  function sortItems(mode) {
    if (mode === 'frequent') {
      return [...items].sort((a, b) => (countByItem.get(b.id) || 0) - (countByItem.get(a.id) || 0)
        || (b.last_logged_at || 0) - (a.last_logged_at || 0));
    }
    if (mode === 'leastfreq') {
      return [...items].sort((a, b) => (countByItem.get(a.id) || 0) - (countByItem.get(b.id) || 0));
    }
    if (mode === 'alpha') {
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...items].sort((a, b) => (b.last_logged_at || 0) - (a.last_logged_at || 0));
  }
  let sorted = sortItems(sortMode);

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Items</h2>
      <div class="list-head">
        <span>${formatCount(items.length)} item${items.length === 1 ? '' : 's'}</span>
        <span>${formatCount(logs.length)} log${logs.length === 1 ? '' : 's'}</span>
      </div>

      <div class="list-sort">
        <span class="list-sort-label">sort by</span>
        <div class="list-sort-dropdown" id="listSort"></div>
      </div>

      <ul class="data-list" id="itemsList"></ul>
      <div class="show-more-wrap" id="itemsMoreWrap" hidden>
        <div class="show-more-actions">
          <button id="itemsMoreBtn" class="link-btn" type="button">Show more</button>
          <span class="sep" id="itemsSep" hidden>·</span>
          <button id="itemsLessBtn" class="link-btn" type="button" hidden>Show less</button>
        </div>
        <span id="itemsMoreNote" class="show-more-note"></span>
      </div>
    </section>
  `;

  const PAGE_SIZE = 25;
  let shown = Math.min(PAGE_SIZE, sorted.length);
  const listEl   = root.querySelector('#itemsList');
  const moreWrap = root.querySelector('#itemsMoreWrap');
  const moreBtn  = root.querySelector('#itemsMoreBtn');
  const lessBtn  = root.querySelector('#itemsLessBtn');
  const sepEl    = root.querySelector('#itemsSep');
  const moreNote = root.querySelector('#itemsMoreNote');

  // Rank items by frequency once so we can mark the top 3 most-bought.
  const freqRanked = [...items].sort((a, b) => (countByItem.get(b.id) || 0) - (countByItem.get(a.id) || 0));
  const topItemIds = new Set(freqRanked.slice(0, 3).map(i => i.id));

  function rowHTML(item) {
    const last = lastByItem.get(item.id);
    const count = countByItem.get(item.id) || 0;
    const lastStore = last && last.store_id ? storeNameById.get(last.store_id) : null;
    const displayUnit = last ? displayUnitForUnit(last.unit) : null;
    const unitPrice = last ? formatUnitPrice(last.unit_price, displayUnit) : '';
    const isTop = count >= 3 && topItemIds.has(item.id);
    return `
      <li class="data-row clickable" data-id="${item.id}">
        <div class="data-row-main">
          <span class="data-name">
            ${isTop ? '<span class="data-tag data-tag-top">★ TOP</span> ' : ''}
            ${escapeHTML(item.name)}
          </span>
          <span class="data-cat">${count > 0 ? `${formatCount(count)}× · ` : ''}${escapeHTML(item.category || 'other')}</span>
        </div>
        ${last ? `
          <div class="data-row-meta">
            <span>${formatPrice(last.price)} · ${last.size}${UNIT_LABELS[last.unit] || last.unit}${lastStore ? ` · ${escapeHTML(lastStore)}` : ''}</span>
            <span class="data-unit-price">${unitPrice}</span>
          </div>
          <div class="data-row-date">${escapeHTML(formatFriendlyDate(last.date))}</div>
        ` : `<div class="data-row-meta data-row-meta-empty">no price logged yet</div>`}
      </li>
    `;
  }

  function renderRows() {
    listEl.innerHTML = sorted.slice(0, shown).map(rowHTML).join('');
    const hasMore = shown < sorted.length;
    const hasLess = shown > PAGE_SIZE;
    moreBtn.hidden = !hasMore;
    lessBtn.hidden = !hasLess;
    sepEl.hidden = !(hasMore && hasLess);
    moreWrap.hidden = !(hasMore || hasLess);
    moreNote.textContent = hasMore
      ? `showing ${formatCount(shown)} of ${formatCount(sorted.length)}`
      : `showing all ${formatCount(sorted.length)}`;

    applyFlash(listEl, 'itemId', 'data-id');
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

  mountDropdown(root.querySelector('#listSort'), {
    options: SORT_OPTIONS,
    value: sortMode,
    onChange: (mode) => {
      sessionStorage.setItem(SORT_KEY, mode);
      sorted = sortItems(mode);
      shown = Math.min(PAGE_SIZE, sorted.length);
      renderRows();
    },
  });

  root.querySelector('#itemsList').addEventListener('click', (e) => {
    const li = e.target.closest('li.clickable');
    if (!li) return;
    const id = Number(li.dataset.id);
    const item = items.find(i => i.id === id);
    if (!item) return;
    openEditModal({
      title: item.name,
      body: buildComparisonBody(item, logs, stores),
      topAction: {
        label: '+ Log a new price for this item →',
        onClick: () => {
          sessionStorage.setItem('priceprint.entry.prefillItemId', String(item.id));
          sessionStorage.setItem('priceprint.activeTab', 'entry');
          document.querySelector('.tab[data-screen="entry"]')?.click();
        },
      },
      fields: [
        { name: 'name', label: 'Rename', value: item.name },
        { name: 'category', label: 'Category', value: item.category || 'other' },
      ],
      onSave: async (vals) => {
        const name = vals.name.trim();
        if (!name) throw new Error('Name is required.');
        await upsertItem({ ...item, name, category: vals.category.trim() || 'other' });
        window.dispatchEvent(new CustomEvent('priceprint:saved', { detail: { itemId: item.id } }));
      },
      onDelete: async () => {
        await deleteItem(item.id);
        window.dispatchEvent(new CustomEvent('priceprint:saved'));
      },
    });
  });
}

// Build per-store comparison HTML for an item — avg unit price at each store,
// cheapest first, with the best (and worst when there are 3+) clearly marked.
function buildComparisonBody(item, logs, stores) {
  const itemLogs = logs.filter(l => l.item_id === item.id);
  if (itemLogs.length === 0) return '<p class="empty-state">No price history yet.</p>';

  const storeNameById = new Map(stores.map(s => [s.id, s.name]));
  const grouped = new Map();
  for (const log of itemLogs) {
    const key = log.store_id || 0;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(log);
  }

  const displayUnit = displayUnitForUnit(itemLogs[0].unit);
  const rows = [];
  for (const [storeId, storeLogs] of grouped) {
    const ups = storeLogs.map(l => l.unit_price);
    const avg = ups.reduce((s, n) => s + n, 0) / ups.length;
    const min = Math.min(...ups);
    const max = Math.max(...ups);
    rows.push({
      name: storeNameById.get(storeId) || '(unknown store)',
      avg, min, max,
      count: storeLogs.length,
    });
  }
  rows.sort((a, b) => a.avg - b.avg);

  // Overall stats for the header line
  const allUps = itemLogs.map(l => l.unit_price);
  const overallAvg = allUps.reduce((s, n) => s + n, 0) / allUps.length;
  const cheapest = rows[0];
  const priciest = rows[rows.length - 1];
  const savingsPct = priciest && cheapest && priciest.avg > 0
    ? ((priciest.avg - cheapest.avg) / priciest.avg) * 100
    : 0;

  // Day-of-week insight — only surface when we have logs on 3+ distinct days
  // and at least one day has 2+ logs (so a single outlier doesn't decide it).
  const dayBuckets = new Map();
  for (const log of itemLogs) {
    const dow = dayOfWeek(log.date);
    if (dow === null) continue;
    if (!dayBuckets.has(dow)) dayBuckets.set(dow, []);
    dayBuckets.get(dow).push(log.unit_price);
  }
  let cheapestDayInsight = '';
  if (dayBuckets.size >= 3) {
    let bestDow = null, bestAvg = Infinity, bestCount = 0;
    for (const [dow, prices] of dayBuckets) {
      const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
      if (avg < bestAvg && prices.length >= 2) {
        bestAvg = avg; bestDow = dow; bestCount = prices.length;
      }
    }
    if (bestDow !== null) {
      const savingsVsAvg = overallAvg > 0 ? ((overallAvg - bestAvg) / overallAvg) * 100 : 0;
      if (savingsVsAvg >= 3) {
        cheapestDayInsight = `<p class="pattern-inline">📅 Historically cheapest on <strong>${DAY_NAMES[bestDow]}s</strong> — about <strong>${savingsVsAvg.toFixed(0)}%</strong> below your overall average (${formatCount(bestCount)} logs).</p>`;
      }
    }
  }

  const summary = rows.length > 1
    ? `<p class="compare-summary">
         <strong>${escapeHTML(cheapest.name)}</strong> is ${savingsPct.toFixed(0)}% cheaper than
         <strong>${escapeHTML(priciest.name)}</strong> on ${escapeHTML(item.name)}.
       </p>`
    : `<p class="compare-summary">Only logged at <strong>${escapeHTML(cheapest.name)}</strong> so far.</p>`;

  const list = rows.map((r, i) => {
    const isBest = i === 0 && rows.length > 1;
    const isWorst = i === rows.length - 1 && rows.length > 2;
    const lowConfidence = r.count === 1;
    const badge = isBest ? '<span class="compare-badge compare-badge-best">CHEAPEST</span>'
                 : isWorst ? '<span class="compare-badge compare-badge-worst">PRICIEST</span>'
                 : '';
    const lowBadge = lowConfidence ? '<span class="compare-badge compare-badge-low">LOW CONFIDENCE</span>' : '';
    return `
      <li class="compare-row ${isBest ? 'is-best' : ''} ${isWorst ? 'is-worst' : ''} ${lowConfidence ? 'is-low-confidence' : ''}">
        <div class="compare-row-main">
          <span class="compare-store">${escapeHTML(r.name)}</span>
          ${badge}
          ${lowBadge}
        </div>
        <div class="compare-row-meta">
          <span class="compare-price">${formatUnitPrice(r.avg, displayUnit)}</span>
          <span class="compare-count">${r.count} log${r.count === 1 ? ' — based on a single observation' : 's'}${
            r.count > 1 ? ` · ${formatUnitPrice(r.min, displayUnit)}–${formatUnitPrice(r.max, displayUnit)}` : ''
          }</span>
        </div>
      </li>
    `;
  }).join('');

  return `
    ${summary}
    ${buildPriceChart(itemLogs, displayUnit, storeNameById)}
    ${cheapestDayInsight}
    <ul class="compare-list">${list}</ul>
    <p class="compare-footnote">Overall avg: ${formatUnitPrice(overallAvg, displayUnit)} across ${formatCount(itemLogs.length)} log${itemLogs.length === 1 ? '' : 's'}.</p>
  `;
}

// SVG sparkline of unit price over time. Pure vanilla, no libs, mobile-friendly.
// Dots are colored by store so the user can map low/high points back to where.
function buildPriceChart(itemLogs, displayUnit, storeNameById) {
  if (itemLogs.length < 2) return '';
  const sorted = [...itemLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const ups = sorted.map(l => l.unit_price);
  const minUP = Math.min(...ups);
  const maxUP = Math.max(...ups);
  const range = maxUP - minUP || maxUP || 1;

  const W = 320, H = 90, padX = 8, padY = 12;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;

  const points = sorted.map((log, i) => {
    const x = padX + (i / (sorted.length - 1)) * innerW;
    const y = padY + (1 - (log.unit_price - minUP) / range) * innerH;
    return { x, y, log };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const areaPath = `${linePath} L ${lastPt.x.toFixed(1)} ${padY + innerH} L ${firstPt.x.toFixed(1)} ${padY + innerH} Z`;

  // Adaptive dot density — overlapping dots become a blob at high counts.
  // Tier the dot radius down + at very high density, only draw the min/max
  // markers (the line itself carries the trend).
  const n = sorted.length;
  const tier =
    n <= 12  ? { r: 2.8, max: 4,   stride: 1 } :
    n <= 30  ? { r: 2.0, max: 3.6, stride: 1 } :
    n <= 60  ? { r: 1.4, max: 3.4, stride: 1 } :
    n <= 120 ? { r: 0.9, max: 3.4, stride: 2 } :
               { r: 0,   max: 3.6, stride: 0 }; // very dense → line only + extremes

  const dots = points.map((p, i) => {
    const isMin = p.log.unit_price === minUP;
    const isMax = p.log.unit_price === maxUP;
    const isExtreme = isMin || isMax;
    // Skip middle dots when stride > 1, but always render extremes
    if (!isExtreme && tier.stride === 0) return '';
    if (!isExtreme && tier.stride > 1 && (i % tier.stride !== 0)) return '';
    const r = isExtreme ? tier.max : tier.r;
    const fill = p.log.store_id ? colorForStoreId(p.log.store_id) : '#6b6657';
    const stroke = isMin ? 'var(--ok)' : isMax ? 'var(--err)' : 'none';
    const strokeWidth = isExtreme ? 1.5 : 0;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }).join('');

  const firstDate = sorted[0].date.split('T')[0];
  const lastDate = sorted[sorted.length - 1].date.split('T')[0];
  const trend = points[points.length - 1].log.unit_price - points[0].log.unit_price;
  const trendPct = points[0].log.unit_price > 0 ? (trend / points[0].log.unit_price) * 100 : 0;
  const trendLabel = Math.abs(trendPct) < 1 ? 'flat'
    : (trendPct > 0 ? `up ${trendPct.toFixed(0)}%` : `down ${Math.abs(trendPct).toFixed(0)}%`);
  const trendClass = trendPct > 1 ? 'trend-up' : trendPct < -1 ? 'trend-down' : 'trend-flat';

  // Store legend — one chip per store that has logs in this chart
  const usedStoreIds = new Set(sorted.map(l => l.store_id).filter(Boolean));
  const legend = [...usedStoreIds].map(sid => {
    const name = storeNameById ? storeNameById.get(sid) : null;
    if (!name) return '';
    return `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${colorForStoreId(sid)}"></span>${escapeHTML(name)}</span>`;
  }).join('');

  return `
    <div class="price-chart">
      <div class="price-chart-head">
        <span class="price-chart-title">price trend · ${formatCount(n)} log${n === 1 ? '' : 's'}</span>
        <span class="price-chart-trend ${trendClass}">${escapeHTML(trendLabel)} over period</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="price-chart-svg" preserveAspectRatio="none" role="img" aria-label="price trend chart">
        <path d="${areaPath}" fill="rgba(10, 94, 68, 0.10)" />
        <path d="${linePath}" stroke="var(--brand)" stroke-width="1.4" fill="none" stroke-linejoin="round" />
        ${dots}
      </svg>
      <div class="chart-legend">${legend}</div>
      <div class="price-chart-meta">
        <span><span class="dot dot-min"></span>low ${formatUnitPrice(minUP, displayUnit)}</span>
        <span><span class="dot dot-max"></span>high ${formatUnitPrice(maxUP, displayUnit)}</span>
      </div>
      <div class="price-chart-dates">
        <span>${escapeHTML(firstDate)}</span>
        <span>${escapeHTML(lastDate)}</span>
      </div>
    </div>
  `;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyFlash(listEl, key, dataAttr) {
  const raw = sessionStorage.getItem('priceprint.flashEdit');
  if (!raw) return;
  try {
    const detail = JSON.parse(raw);
    const id = detail[key];
    if (id == null) return;
    const row = listEl.querySelector(`li[${dataAttr}="${id}"]`);
    if (!row) return;
    requestAnimationFrame(() => {
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1800);
    });
  } catch {}
  sessionStorage.removeItem('priceprint.flashEdit');
}
