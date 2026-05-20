// Compare screen. Cross-store price comparison — answers "where should I shop?"
//   - Overall: which store wins on the most items you've tracked
//   - Per-item: for items logged at 2+ stores, show cheapest vs priciest and savings %
//   - Estimate basket savings if you switched to the cheapest store for everything
import { getAllItems, getAllPriceLogs, getAllStores } from './db.js';
import { formatUnitPrice, formatPrice, formatFriendlyDate, formatCount, FAMILIES, toCanonical, fromCanonical, DISPLAY_UNIT } from './normalize.js';
import { mountDropdown } from './dropdown.js';

export async function mountCompare(root) {
  const [items, logs, stores] = await Promise.all([getAllItems(), getAllPriceLogs(), getAllStores()]);

  if (logs.length === 0) {
    root.innerHTML = emptyState('Add a few prices on <strong>LOG PRICE</strong> first — once you\'ve logged the same item at 2+ stores, this screen tells you where to shop.');
    return;
  }

  const storeNameById = new Map(stores.map(s => [s.id, s.name]));

  // Track each item's most-recent log (for staleness display + per-purchase
  // size) AND log count (for purchase-frequency sort).
  const lastLogByItem = new Map();
  const countByItem = new Map();
  for (const log of logs) {
    countByItem.set(log.item_id, (countByItem.get(log.item_id) || 0) + 1);
    const prev = lastLogByItem.get(log.item_id);
    if (!prev || log.date > prev.date) lastLogByItem.set(log.item_id, log);
  }

  // For each item, group logs by store and compute avg unit price per store.
  const winners = [];
  for (const item of items) {
    const itemLogs = logs.filter(l => l.item_id === item.id && l.store_id);
    if (itemLogs.length === 0) continue;

    const byStore = new Map();
    for (const log of itemLogs) {
      if (!byStore.has(log.store_id)) byStore.set(log.store_id, []);
      byStore.get(log.store_id).push(log);
    }
    if (byStore.size < 2) continue; // need at least 2 stores to compare

    const storeStats = [];
    for (const [storeId, sLogs] of byStore) {
      const avg = sLogs.reduce((s, l) => s + l.unit_price, 0) / sLogs.length;
      storeStats.push({ storeId, avg, count: sLogs.length, unit: sLogs[0].unit });
    }
    storeStats.sort((a, b) => a.avg - b.avg);
    const cheapest = storeStats[0];
    const priciest = storeStats[storeStats.length - 1];
    const savingsPct = priciest.avg > 0 ? ((priciest.avg - cheapest.avg) / priciest.avg) * 100 : 0;

    // Realistic dollar savings — frequency-weighted, with a hard per-item cap.
    //   per-purchase savings = (overall avg − cheapest) × typical canonical size
    //   purchases-per-year   = item log count / (years of history, floored at 6 months)
    //   annual item savings  = per-purchase savings × purchases per year
    //   *capped* at PER_ITEM_ANNUAL_CAP so a single outlier item (or unrealistic
    //   frequency from sparse data) can't blow the headline number into fantasy
    //   territory. Sum across items = the headline annual savings number.
    const PER_ITEM_ANNUAL_CAP = 40; // believable upper bound per item per year
    const lastLog = lastLogByItem.get(item.id);
    const overallAvgPrice = itemLogs.reduce((s, l) => s + l.unit_price, 0) / itemLogs.length;
    const perPurchaseDiff = (priciest.avg - cheapest.avg);              // worst-case spread (for the row display)
    const realisticPerPurchase = Math.max(0, overallAvgPrice - cheapest.avg);
    let dollarDiff = 0;
    let realisticAnnual = 0;
    if (lastLog) {
      // unit_price is stored in the family's DISPLAY unit ($/oz, $/floz, $/ct)
      // — NOT the canonical unit. Multiply by the typical size *in that same
      // display unit* to get a real dollar amount per purchase.
      const family = FAMILIES[lastLog.unit]?.family;
      const displayUnit = family ? DISPLAY_UNIT[family] : null;
      const canonical = toCanonical(lastLog.size, lastLog.unit);
      const displayAmount = (canonical && displayUnit) ? fromCanonical(canonical, displayUnit) : 0;
      if (displayAmount > 0) {
        dollarDiff = perPurchaseDiff * displayAmount;
        const dates = itemLogs.map(l => l.date).sort();
        const earliest = new Date(dates[0]);
        const latest   = new Date(dates[dates.length - 1]);
        const daysSpan = Math.max(1, (latest - earliest) / 86400000);
        // Floor at 6 months so a tight cluster of logs doesn't extrapolate to wild annual rates.
        const yearsSpan = Math.max(daysSpan / 365, 0.5);
        const purchasesPerYear = itemLogs.length / yearsSpan;
        const uncapped = realisticPerPurchase * displayAmount * purchasesPerYear;
        realisticAnnual = Math.min(uncapped, PER_ITEM_ANNUAL_CAP);
      }
    }

    winners.push({
      item, cheapest, priciest, savingsPct,
      storeCount: byStore.size, storeStats,
      dollarDiff,
      realisticAnnual,
      lastDate: lastLog ? lastLog.date : null,
    });
  }

  if (winners.length === 0) {
    root.innerHTML = emptyState('Log the same item at 2+ different stores so PricePrint can compare. Right now everything you\'ve tracked is only at one store.');
    return;
  }

  // Rank stores by how many items they win on
  const winCount = new Map();
  for (const w of winners) {
    winCount.set(w.cheapest.storeId, (winCount.get(w.cheapest.storeId) || 0) + 1);
  }
  const ranking = stores
    .map(s => ({ store: s, wins: winCount.get(s.id) || 0 }))
    .filter(r => r.wins > 0)
    .sort((a, b) => b.wins - a.wins);

  const avgSavings = winners.reduce((s, w) => s + w.savingsPct, 0) / winners.length;
  const totalAnnualSavings = winners.reduce((s, w) => s + w.realisticAnnual, 0);
  const bestStore = ranking[0];
  const totalComparable = winners.length;

  // Sort winners by selected mode. Default = biggest spread.
  const SORT_KEY = 'priceprint.compare.sort';
  const SORT_OPTIONS = [
    { value: 'spread',         label: 'Biggest spread' },
    { value: 'annual',         label: 'Biggest annual savings' },
    { value: 'dollar',         label: 'Biggest per-purchase difference' },
    { value: 'purchased-desc', label: 'Most purchased' },
    { value: 'purchased-asc',  label: 'Least purchased' },
    { value: 'alpha',          label: 'A → Z' },
  ];
  const sortMode = sessionStorage.getItem(SORT_KEY) || 'spread';
  function sortWinners(mode) {
    if (mode === 'annual')         return [...winners].sort((a, b) => b.realisticAnnual - a.realisticAnnual);
    if (mode === 'dollar')         return [...winners].sort((a, b) => b.dollarDiff - a.dollarDiff);
    if (mode === 'purchased-desc') return [...winners].sort((a, b) => (countByItem.get(b.item.id) || 0) - (countByItem.get(a.item.id) || 0));
    if (mode === 'purchased-asc')  return [...winners].sort((a, b) => (countByItem.get(a.item.id) || 0) - (countByItem.get(b.item.id) || 0));
    if (mode === 'alpha')          return [...winners].sort((a, b) => a.item.name.localeCompare(b.item.name));
    return [...winners].sort((a, b) => b.savingsPct - a.savingsPct);
  }
  let winnersSorted = sortWinners(sortMode);

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Compare</h2>

      <div class="compare-hero-box">
        <div class="compare-hero-upper">
          <div class="compare-hero-text">
            <div class="compare-hero-label">overall winner</div>
            <div class="compare-hero-name">${escapeHTML(bestStore.store.name)}</div>
          </div>
          <img class="compare-hero-badge" src="cheapest.png" alt="Cheapest" />
        </div>
        <div class="compare-hero-scoreboard">
          <div class="compare-hero-stat">
            <span class="compare-hero-stat-num">${formatCount(bestStore.wins)}</span>
            <span class="compare-hero-stat-label">wins</span>
          </div>
          <div class="compare-hero-stat savings-carousel">
            <div class="savings-slide savings-annual">
              <span class="compare-hero-stat-num">${formatPrice(totalAnnualSavings)}</span>
              <span class="compare-hero-stat-label">est. annual savings</span>
            </div>
            <div class="savings-slide savings-monthly">
              <span class="compare-hero-stat-num">${formatPrice(totalAnnualSavings / 12)}</span>
              <span class="compare-hero-stat-label">est. monthly savings</span>
            </div>
          </div>
          <div class="compare-hero-stat">
            <span class="compare-hero-stat-num">${avgSavings.toFixed(0)}%</span>
            <span class="compare-hero-stat-label">avg cheaper</span>
          </div>
        </div>
        <div class="compare-hero-sub">based on how often you've logged each item · ${formatCount(totalComparable)} items compared</div>
        <div class="compare-hero-actions">
          <button id="tripListBtn" class="primary" type="button">Build my trip list →</button>
        </div>
        <div class="compare-hero-mark">via priceprint.artivicolab.com</div>
      </div>

      <div class="list-head"><span>store rankings</span><span>items won</span></div>
      <ul class="data-list ranking-list">
        ${ranking.map((r, i) => {
          const tier = i === 0 ? 'tier-1' : i < 3 ? 'tier-podium' : 'tier-rest';
          return `
            <li class="data-row ${i === 0 ? 'is-best-store' : ''} ${tier}">
              <div class="data-row-main">
                <span class="data-name">
                  ${i === 0 ? '<span class="rank-medal">★</span> ' : `<span class="rank-num">${i + 1}.</span> `}
                  ${escapeHTML(r.store.name)}
                </span>
                <span class="data-delta data-delta-good">${formatCount(r.wins)} win${r.wins === 1 ? '' : 's'}</span>
              </div>
            </li>
          `;
        }).join('')}
      </ul>

      <div class="list-head">
        <span>biggest spreads</span>
        <span class="list-head-hint">← tap arrows to see each store →</span>
      </div>
      <div class="list-sort">
        <span class="list-sort-label">sort by</span>
        <div class="list-sort-dropdown" id="spreadsSort"></div>
      </div>
      <ul class="data-list" id="spreadsList"></ul>
      <div class="show-more-wrap" id="spreadsMoreWrap" hidden>
        <div class="show-more-actions">
          <button id="spreadsMoreBtn" class="link-btn" type="button">Show more</button>
          <span class="sep" id="spreadsSep" hidden>·</span>
          <button id="spreadsLessBtn" class="link-btn" type="button" hidden>Show less</button>
        </div>
        <span id="spreadsMoreNote" class="show-more-note"></span>
      </div>
    </section>
  `;

  const PAGE_SIZE = 15;
  let shown = Math.min(PAGE_SIZE, winnersSorted.length);
  const listEl   = root.querySelector('#spreadsList');
  const moreWrap = root.querySelector('#spreadsMoreWrap');
  const moreBtn  = root.querySelector('#spreadsMoreBtn');
  const lessBtn  = root.querySelector('#spreadsLessBtn');
  const sepEl    = root.querySelector('#spreadsSep');
  const moreNote = root.querySelector('#spreadsMoreNote');

  function rowHTML(w) {
    const displayUnit = displayUnitForUnit(w.cheapest.unit);
    const first = renderRowSlide(w, 0, displayUnit, storeNameById);
    const dollarLine = w.dollarDiff > 0
      ? `<span class="row-spread-dollars">${formatPrice(w.dollarDiff)} difference</span>`
      : '';
    const freshness = w.lastDate
      ? `<span class="row-freshness">last seen ${escapeHTML(formatFriendlyDate(w.lastDate))}</span>`
      : '';
    return `
      <li class="data-row" data-item-id="${w.item.id}" data-store-count="${w.storeStats.length}" data-current-idx="0">
        <div class="data-row-main">
          <span class="data-name">${escapeHTML(w.item.name)}</span>
          <span class="row-spread-stack">
            <span class="data-delta data-delta-good">${w.savingsPct.toFixed(0)}% spread</span>
            ${dollarLine}
          </span>
        </div>
        <div class="row-slider">
          <button class="row-arrow row-prev" type="button" aria-label="previous store">←</button>
          <div class="row-slide-content">${first}</div>
          <button class="row-arrow row-next" type="button" aria-label="next store">→</button>
        </div>
        <div class="row-progress">
          <span class="row-progress-step">1 / ${formatCount(w.storeStats.length)} stores</span>
          ${freshness}
        </div>
      </li>
    `;
  }

  function renderRows() {
    listEl.innerHTML = winnersSorted.slice(0, shown).map(rowHTML).join('');
    const hasMore = shown < winnersSorted.length;
    const hasLess = shown > PAGE_SIZE;
    moreBtn.hidden = !hasMore;
    lessBtn.hidden = !hasLess;
    sepEl.hidden = !(hasMore && hasLess);
    moreWrap.hidden = !(hasMore || hasLess);
    moreNote.textContent = hasMore
      ? `showing ${formatCount(shown)} of ${formatCount(winnersSorted.length)}`
      : `showing all ${formatCount(winnersSorted.length)}`;
  }
  renderRows();

  moreBtn.addEventListener('click', () => {
    shown = Math.min(shown + PAGE_SIZE, winnersSorted.length);
    renderRows();
  });
  lessBtn.addEventListener('click', () => {
    shown = PAGE_SIZE;
    renderRows();
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  mountDropdown(root.querySelector('#spreadsSort'), {
    options: SORT_OPTIONS,
    value: sortMode,
    onChange: (newMode) => {
      sessionStorage.setItem(SORT_KEY, newMode);
      winnersSorted = sortWinners(newMode);
      shown = Math.min(PAGE_SIZE, winnersSorted.length);
      renderRows();
    },
  });

  // Trip list — group items by their cheapest store, print/share-ready.
  root.querySelector('#tripListBtn').addEventListener('click', () => {
    openTripList(winners, storeNameById);
  });

  // Per-row slider state — cycle through every store for that item.
  const winnersById = new Map(winners.map(w => [w.item.id, w]));
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.row-arrow');
    if (!btn) return;
    const row = btn.closest('.data-row');
    const itemId = Number(row.dataset.itemId);
    const w = winnersById.get(itemId);
    if (!w) return;
    const total = w.storeStats.length;
    let idx = Number(row.dataset.currentIdx);
    idx = btn.classList.contains('row-prev')
      ? (idx - 1 + total) % total
      : (idx + 1) % total;
    row.dataset.currentIdx = idx;
    const displayUnit = displayUnitForUnit(w.cheapest.unit);
    row.querySelector('.row-slide-content').innerHTML = renderRowSlide(w, idx, displayUnit, storeNameById);
    row.querySelector('.row-progress-step').textContent = `${formatCount(idx + 1)} / ${formatCount(total)}`;
  });
}

// Render one "slide" of a row — shows store name, price, rank, and delta from
// the cheapest (or "cheapest" / "priciest" tag when applicable).
function renderRowSlide(w, idx, displayUnit, storeNameById) {
  const s = w.storeStats[idx];
  const cheapest = w.storeStats[0];
  const name = storeNameById.get(s.storeId) || '(unknown)';
  const isCheapest = idx === 0;
  const isPriciest = idx === w.storeStats.length - 1 && w.storeStats.length > 1;
  const rank = isCheapest ? '★' : `${idx + 1}.`;
  let deltaHTML = '';
  if (isCheapest) {
    deltaHTML = '<span class="row-tag row-tag-best">CHEAPEST</span>';
  } else {
    const pct = cheapest.avg > 0 ? ((s.avg - cheapest.avg) / cheapest.avg) * 100 : 0;
    const tagHTML = isPriciest ? '<span class="row-tag row-tag-worst">PRICIEST</span>' : '';
    deltaHTML = `<span class="row-delta">+${pct.toFixed(0)}%</span> ${tagHTML}`;
  }
  return `
    <span class="row-rank">${rank}</span>
    <strong class="row-store">${escapeHTML(name)}</strong>
    <span class="row-price">${formatUnitPrice(s.avg, displayUnit)}</span>
    ${deltaHTML}
  `;
}

// Build a store-grouped shopping plan from the per-item winners.
// "Buy these at Costco, these at Safeway, etc." with per-store + total savings.
function openTripList(winners, storeNameById) {
  const groups = new Map();
  for (const w of winners) {
    const id = w.cheapest.storeId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(w);
  }
  const sortedGroups = [...groups.entries()]
    .map(([storeId, ws]) => ({
      storeId,
      name: storeNameById.get(storeId) || '(unknown)',
      items: ws.sort((a, b) => b.realisticAnnual - a.realisticAnnual),
      total: ws.reduce((s, w) => s + w.realisticAnnual, 0),
    }))
    .sort((a, b) => b.items.length - a.items.length);

  const totalSavings = sortedGroups.reduce((s, g) => s + g.total, 0);
  const totalItems = winners.length;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card entry trip-card" role="dialog" aria-modal="true">
      <h2 class="screen-title">Your trip list</h2>
      <div class="modal-scroll">
        <p class="trip-intro">
          Buy each item at the store where it's cheapest.<br>
          Estimated annual savings: <strong>${formatPrice(totalSavings)}</strong> across ${formatCount(totalItems)} items.
        </p>
        ${sortedGroups.map(g => `
          <section class="trip-group">
            <div class="trip-group-head">
              <span class="trip-group-name">${escapeHTML(g.name)}</span>
              <span class="trip-group-stats">${formatCount(g.items.length)} item${g.items.length === 1 ? '' : 's'} · ${formatPrice(g.total)}/yr</span>
            </div>
            <ul class="trip-items">
              ${g.items.map(w => {
                const du = displayUnitForUnit(w.cheapest.unit);
                return `
                  <li class="trip-item">
                    <span class="trip-item-name">${escapeHTML(w.item.name)}</span>
                    <span class="trip-item-price">${formatUnitPrice(w.cheapest.avg, du)}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          </section>
        `).join('')}
        <div class="actions"><button class="primary" data-action="close" type="button">Done</button></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
  function esc(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'close') close();
  });
  document.addEventListener('keydown', esc);
}

function emptyState(html) {
  return `
    <section class="entry placeholder-card">
      <h2 class="screen-title">Compare</h2>
      <p class="empty-state">${html}</p>
    </section>
  `;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
