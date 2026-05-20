// Sale check screen. For every log marked "is_sale", compare the unit price
// to that item's historical average. Below avg = real sale. At or above = fake.
import { getAllPriceLogs, getAllItems, getAllStores } from './db.js';
import { formatPrice, formatUnitPrice, formatFriendlyDate, formatCount, dayOfWeek, DAY_NAMES, FAMILIES, UNIT_LABELS } from './normalize.js';

export async function mountValidator(root) {
  const [logs, items, stores] = await Promise.all([getAllPriceLogs(), getAllItems(), getAllStores()]);

  if (logs.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Sale check</h2>
        <p class="empty-state">Log a few prices first. Once you've checked the <em>"Store marked this as a sale"</em> box on any entry, this screen will tell you whether that sale was real.</p>
      </section>
    `;
    return;
  }

  // Group by item to compute historical avg unit price
  const byItem = new Map();
  for (const log of logs) {
    if (!byItem.has(log.item_id)) byItem.set(log.item_id, []);
    byItem.get(log.item_id).push(log);
  }

  const itemById = new Map(items.map(i => [i.id, i]));
  const storeById = new Map(stores.map(s => [s.id, s]));

  // Pull every is_sale=true log and grade it
  const sales = [];
  for (const log of logs) {
    if (!log.is_sale) continue;
    const allForItem = byItem.get(log.item_id) || [];
    const others = allForItem.filter(l => l.id !== log.id);
    if (others.length === 0) continue; // can't compare a single data point
    const avg = others.reduce((s, l) => s + l.unit_price, 0) / others.length;
    const delta = log.unit_price - avg;
    const pct = (delta / avg) * 100;
    sales.push({ log, avg, delta, pct });
  }

  if (sales.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Sale check</h2>
        <p class="empty-state">No prices marked as sales yet. Check the <em>"Store marked this as a sale"</em> box when logging — once an item has 2+ logs, this screen grades whether each sale was real.</p>
      </section>
    `;
    return;
  }

  // Newest first
  sales.sort((a, b) => (a.log.date < b.log.date ? 1 : -1));
  const realCount = sales.filter(s => s.pct < -1).length;
  const fakeCount = sales.filter(s => s.pct >= -1).length;

  // ---- Day-of-week patterns ----
  // Overall: which day of the week has the user spotted the most sales?
  const dayCounts = new Array(7).fill(0);
  for (const s of sales) {
    const dow = dayOfWeek(s.log.date);
    if (dow !== null) dayCounts[dow]++;
  }
  const bestSaleDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
  const bestSaleDayCount = dayCounts[bestSaleDayIdx];
  const bestSaleDay = bestSaleDayCount > 0 ? DAY_NAMES[bestSaleDayIdx] : null;

  // Per-store: which day of the week wins for each store with 3+ sale logs?
  const storeDayMap = new Map();
  for (const s of sales) {
    if (!s.log.store_id) continue;
    const dow = dayOfWeek(s.log.date);
    if (dow === null) continue;
    if (!storeDayMap.has(s.log.store_id)) storeDayMap.set(s.log.store_id, new Array(7).fill(0));
    storeDayMap.get(s.log.store_id)[dow]++;
  }
  const storePatterns = [];
  for (const [storeId, counts] of storeDayMap) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total < 3) continue;
    const best = counts.indexOf(Math.max(...counts));
    const store = storeById.get(storeId);
    if (!store) continue;
    storePatterns.push({ name: store.name, day: DAY_NAMES[best], count: counts[best], total });
  }
  storePatterns.sort((a, b) => b.total - a.total);

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Sale check</h2>
      <div class="list-head">
        <span>${formatCount(realCount)} real sale${realCount === 1 ? '' : 's'}</span>
        <span>${formatCount(fakeCount)} fake sale${fakeCount === 1 ? '' : 's'}</span>
      </div>

      ${fakeCount > 0 ? `
        <p class="sale-summary">
          <strong>${formatCount(fakeCount)} ${fakeCount === 1 ? 'item was' : 'items were'} marked as a sale</strong>
          but priced <em>above</em> your historical average at that store.
        </p>
      ` : ''}

      <div class="filter-chips" id="saleFilter" role="group" aria-label="filter sales">
        <button class="chip" type="button" data-filter="all">All <span class="chip-count">${formatCount(sales.length)}</span></button>
        <button class="chip" type="button" data-filter="real">Real <span class="chip-count">${formatCount(realCount)}</span></button>
        <button class="chip" type="button" data-filter="fake">Fake <span class="chip-count">${formatCount(fakeCount)}</span></button>
      </div>

      ${bestSaleDay ? `
        <div class="pattern-box">
          <div class="pattern-label">BEST DAY TO SPOT SALES</div>
          <div class="pattern-headline">${bestSaleDay}s</div>
          <div class="pattern-sub">${formatCount(bestSaleDayCount)} of your ${formatCount(sales.length)} sale${sales.length === 1 ? '' : 's'} have shown up on a ${bestSaleDay}</div>
          ${storePatterns.length > 0 ? `
            <div class="pattern-stores">
              <div class="pattern-stores-label">by store</div>
              ${storePatterns.slice(0, 4).map(p => `
                <div class="pattern-store-row">
                  <span class="pattern-store-name">${escapeHTML(p.name)}</span>
                  <span class="pattern-store-day">${p.day}s</span>
                  <span class="pattern-store-count">${formatCount(p.count)} of ${formatCount(p.total)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      ` : ''}
      <ul class="data-list" id="salesList"></ul>
      <div class="show-more-wrap" id="salesMoreWrap" hidden>
        <div class="show-more-actions">
          <button id="salesMoreBtn" class="link-btn" type="button">Show more</button>
          <span class="sep" id="salesSep" hidden>·</span>
          <button id="salesLessBtn" class="link-btn" type="button" hidden>Show less</button>
        </div>
        <span id="salesMoreNote" class="show-more-note"></span>
      </div>
    </section>
  `;

  const PAGE_SIZE = 20;
  const FILTER_KEY = 'priceprint.validator.filter';
  let filter = sessionStorage.getItem(FILTER_KEY) || 'all';
  let filteredSales = filterSales(sales, filter);
  let shown = Math.min(PAGE_SIZE, filteredSales.length);
  const listEl   = root.querySelector('#salesList');
  const moreWrap = root.querySelector('#salesMoreWrap');
  const moreBtn  = root.querySelector('#salesMoreBtn');
  const lessBtn  = root.querySelector('#salesLessBtn');
  const sepEl    = root.querySelector('#salesSep');
  const moreNote = root.querySelector('#salesMoreNote');
  const filterEl = root.querySelector('#saleFilter');

  function setActiveChip() {
    filterEl.querySelectorAll('.chip').forEach(el => {
      el.classList.toggle('is-active', el.dataset.filter === filter);
    });
  }
  setActiveChip();

  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    filter = btn.dataset.filter;
    sessionStorage.setItem(FILTER_KEY, filter);
    filteredSales = filterSales(sales, filter);
    shown = Math.min(PAGE_SIZE, filteredSales.length);
    setActiveChip();
    renderRows();
  });

  function rowHTML(s) {
    const item = itemById.get(s.log.item_id);
    const store = storeById.get(s.log.store_id);
    const displayUnit = displayUnitForUnit(s.log.unit);
    const isReal = s.pct < -1;
    return `
      <li class="data-row">
        <div class="data-row-main">
          <span class="data-name">${escapeHTML(item ? item.name : 'unknown')}</span>
          <span class="data-tag ${isReal ? 'data-tag-real' : 'data-tag-fake'}">
            ${isReal ? '✓ REAL SALE' : '⚠ FAKE SALE'}
          </span>
        </div>
        <div class="data-row-meta">
          <span>${formatPrice(s.log.price)} · ${s.log.size}${UNIT_LABELS[s.log.unit] || s.log.unit}${store ? ` · ${escapeHTML(store.name)}` : ''}</span>
          <span class="data-unit-price">${formatUnitPrice(s.log.unit_price, displayUnit)}</span>
        </div>
        <div class="data-row-meta sale-evidence">
          <span class="sale-evidence-label">vs <strong>${formatUnitPrice(s.avg, displayUnit)}</strong> historical avg</span>
          <span class="data-delta ${isReal ? 'data-delta-good' : 'data-delta-bad'}">
            ${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)}%
          </span>
        </div>
        <div class="data-row-date">${escapeHTML(formatFriendlyDate(s.log.date))}</div>
      </li>
    `;
  }

  function renderRows() {
    if (filteredSales.length === 0) {
      listEl.innerHTML = `<li class="empty-state">No ${filter === 'all' ? '' : filter + ' '}sales match this filter.</li>`;
      moreWrap.hidden = true;
      return;
    }
    listEl.innerHTML = filteredSales.slice(0, shown).map(rowHTML).join('');
    const hasMore = shown < filteredSales.length;
    const hasLess = shown > PAGE_SIZE;
    moreBtn.hidden = !hasMore;
    lessBtn.hidden = !hasLess;
    sepEl.hidden = !(hasMore && hasLess);
    moreWrap.hidden = !(hasMore || hasLess);
    moreNote.textContent = hasMore
      ? `showing ${formatCount(shown)} of ${formatCount(filteredSales.length)}`
      : `showing all ${formatCount(filteredSales.length)}`;
  }
  renderRows();

  moreBtn.addEventListener('click', () => {
    shown = Math.min(shown + PAGE_SIZE, filteredSales.length);
    renderRows();
  });
  lessBtn.addEventListener('click', () => {
    shown = PAGE_SIZE;
    renderRows();
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function filterSales(all, filter) {
  if (filter === 'real') return all.filter(s => s.pct < -1);
  if (filter === 'fake') return all.filter(s => s.pct >= -1);
  return all;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
