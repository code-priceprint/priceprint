// Personal inflation. For each item with 2+ logs spanning a meaningful slice
// of the selected time range, compute % change between the oldest and newest
// unit price IN range. Roll up into:
//   - basket-cost-then vs now (the macro number)
//   - personal CPI vs U.S. CPI annual reference (the comparison)
//   - items getting more expensive / cheaper, as two distinct sections
import { getAllPriceLogs, getAllItems } from './db.js';
import { formatUnitPrice, formatPrice, formatCount, FAMILIES, toCanonical } from './normalize.js';

// ─── MAINTENANCE: update quarterly ──────────────────────────────────────────
// U.S. CPI year-over-year, hardcoded so the Inflation screen can show a real
// reference number without making a network request (privacy promise: no
// requests leave this device). The .github/workflows/cpi-reminder.yml
// workflow opens a tracking issue every 3 months to nudge a refresh.
//
// To update:
//   1. Pull the latest "All items · 12-month change" figure from
//      https://www.bls.gov/cpi/
//   2. Bump both constants below
//   3. Ship
// ────────────────────────────────────────────────────────────────────────────
const US_CPI_ANNUAL = 3.0;
const US_CPI_AS_OF  = '2024';

const RANGES = [
  { value: '3m',  label: '3M', days: 90  },
  { value: '6m',  label: '6M', days: 180 },
  { value: '1y',  label: '1Y', days: 365 },
];

export async function mountInflation(root) {
  const [logs, items] = await Promise.all([getAllPriceLogs(), getAllItems()]);

  if (logs.length === 0) {
    root.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Inflation</h2>
        <p class="empty-state">Need a few months of logs to see your personal inflation. Log the same items over time and this screen calculates how much more (or less) you're paying.</p>
      </section>
    `;
    return;
  }

  const RANGE_KEY = 'priceprint.inflation.range';
  let currentRange = sessionStorage.getItem(RANGE_KEY) || '1y';
  if (!RANGES.find(r => r.value === currentRange)) currentRange = '1y';

  const PAGE_SIZE = 15;
  let upShown = PAGE_SIZE;
  let downShown = PAGE_SIZE;

  function rangeDef() { return RANGES.find(r => r.value === currentRange); }

  function compute() {
    const days = rangeDef().days;
    const cutoff = Date.now() - days * 86400000;
    const itemById = new Map(items.map(i => [i.id, i]));

    // Bucket logs by item, within range
    const byItem = new Map();
    for (const log of logs) {
      if (new Date(log.date).getTime() < cutoff) continue;
      if (!byItem.has(log.item_id)) byItem.set(log.item_id, []);
      byItem.get(log.item_id).push(log);
    }

    const rows = [];
    let basketOld = 0, basketNew = 0;
    const minSpanDays = Math.max(14, Math.round(days / 4));
    for (const [itemId, itemLogs] of byItem) {
      if (itemLogs.length < 2) continue;
      const sorted = [...itemLogs].sort((a, b) => (a.date < b.date ? -1 : 1));
      const oldest = sorted[0];
      const newest = sorted[sorted.length - 1];
      const spanDays = (new Date(newest.date) - new Date(oldest.date)) / 86400000;
      if (spanDays < minSpanDays) continue;
      const pct = ((newest.unit_price - oldest.unit_price) / oldest.unit_price) * 100;
      rows.push({ item: itemById.get(itemId), oldest, newest, days: spanDays, pct });

      // Basket cost — use the newest log's size as the "typical purchase" anchor
      const canonical = toCanonical(newest.size, newest.unit);
      if (canonical) {
        basketOld += oldest.unit_price * canonical;
        basketNew += newest.unit_price * canonical;
      }
    }

    return { rows, basketOld, basketNew };
  }

  function render() {
    const { rows, basketOld, basketNew } = compute();

    if (rows.length === 0) {
      root.innerHTML = `
        <section class="entry placeholder-card">
          <h2 class="screen-title">Inflation</h2>
          ${rangeChipsHTML(currentRange)}
          <p class="empty-state">Need at least 2 logs per item with enough time between them to calculate inflation within the selected range. Try a wider window or keep logging the same items over time.</p>
        </section>
      `;
      wireRangeChips();
      return;
    }

    // Personal CPI = simple mean of per-item percentages (matches the previous behavior)
    const overallPct = rows.reduce((s, r) => s + r.pct, 0) / rows.length;

    // Annualize for cross-period comparison against the CPI YoY
    const days = rangeDef().days;
    const annualizedPct = overallPct * (365 / days);
    const cpiOverPeriod = US_CPI_ANNUAL * (days / 365);
    const gap = overallPct - cpiOverPeriod;

    const basketDelta = basketNew - basketOld;
    const basketDeltaPct = basketOld > 0 ? (basketDelta / basketOld) * 100 : 0;

    const goingUp   = rows.filter(r => r.pct >  0).sort((a, b) => b.pct - a.pct);
    const goingDown = rows.filter(r => r.pct <  0).sort((a, b) => a.pct - b.pct);

    // Clamp shown counts to the new section lengths (range change shrinks list)
    upShown   = Math.min(upShown,   Math.max(PAGE_SIZE, goingUp.length));
    downShown = Math.min(downShown, Math.max(PAGE_SIZE, goingDown.length));

    const upHasMore   = upShown < goingUp.length;
    const upHasLess   = upShown > PAGE_SIZE;
    const downHasMore = downShown < goingDown.length;
    const downHasLess = downShown > PAGE_SIZE;

    root.innerHTML = `
      <section class="entry">
        <h2 class="screen-title">Inflation</h2>

        ${rangeChipsHTML(currentRange)}

        <div class="inflation-hero">
          <div class="inflation-label">YOUR PERSONAL INFLATION</div>
          <div class="inflation-number ${overallPct >= 0 ? 'is-up' : 'is-down'}">
            ${overallPct >= 0 ? '+' : ''}${overallPct.toFixed(1)}%
          </div>
          <div class="inflation-sub">across ${formatCount(rows.length)} item${rows.length === 1 ? '' : 's'} over the last ${rangeDef().label}</div>
          <div class="inflation-cpi">
            vs U.S. CPI <strong>${cpiOverPeriod >= 0 ? '+' : ''}${cpiOverPeriod.toFixed(1)}%</strong> over the same period
            ${Math.abs(gap) >= 0.5 ? `· you're <strong class="${gap > 0 ? 'is-up' : 'is-down'}">${Math.abs(gap).toFixed(1)} pts ${gap > 0 ? 'higher' : 'lower'}</strong>` : ''}
            <div class="inflation-cpi-foot">U.S. CPI YoY ~${US_CPI_ANNUAL.toFixed(1)}% (year ending ${US_CPI_AS_OF})</div>
          </div>
        </div>

        ${basketOld > 0 ? `
          <div class="basket-summary">
            <div class="basket-label">YOUR TYPICAL BASKET</div>
            <div class="basket-row">
              <span class="basket-col">
                <span class="basket-num">${formatPrice(basketOld)}</span>
                <span class="basket-when">at the start of period</span>
              </span>
              <span class="basket-arrow">→</span>
              <span class="basket-col">
                <span class="basket-num">${formatPrice(basketNew)}</span>
                <span class="basket-when">today</span>
              </span>
            </div>
            <div class="basket-delta ${basketDelta >= 0 ? 'is-up' : 'is-down'}">
              ${basketDelta >= 0 ? '+' : '−'}${formatPrice(Math.abs(basketDelta))}
              · ${basketDelta >= 0 ? '+' : ''}${basketDeltaPct.toFixed(1)}%
            </div>
          </div>
        ` : ''}

        ${goingUp.length > 0 ? `
          <div class="list-head"><span>items getting more expensive</span><span>change</span></div>
          <ul class="data-list">
            ${goingUp.slice(0, upShown).map(r => rowHTML(r, 'up')).join('')}
          </ul>
          ${(upHasMore || upHasLess) ? `
            <div class="show-more-wrap">
              <div class="show-more-actions">
                ${upHasMore ? `<button class="link-btn" data-act="up-more" type="button">Show more</button>` : ''}
                ${(upHasMore && upHasLess) ? '<span class="sep">·</span>' : ''}
                ${upHasLess ? `<button class="link-btn" data-act="up-less" type="button">Show less</button>` : ''}
              </div>
              <span class="show-more-note">${
                upHasMore
                  ? `showing ${formatCount(upShown)} of ${formatCount(goingUp.length)}`
                  : `showing all ${formatCount(goingUp.length)}`
              }</span>
            </div>
          ` : ''}
        ` : ''}

        ${goingDown.length > 0 ? `
          <div class="list-head"><span>items that got cheaper</span><span>change</span></div>
          <ul class="data-list">
            ${goingDown.slice(0, downShown).map(r => rowHTML(r, 'down')).join('')}
          </ul>
          ${(downHasMore || downHasLess) ? `
            <div class="show-more-wrap">
              <div class="show-more-actions">
                ${downHasMore ? `<button class="link-btn" data-act="down-more" type="button">Show more</button>` : ''}
                ${(downHasMore && downHasLess) ? '<span class="sep">·</span>' : ''}
                ${downHasLess ? `<button class="link-btn" data-act="down-less" type="button">Show less</button>` : ''}
              </div>
              <span class="show-more-note">${
                downHasMore
                  ? `showing ${formatCount(downShown)} of ${formatCount(goingDown.length)}`
                  : `showing all ${formatCount(goingDown.length)}`
              }</span>
            </div>
          ` : ''}
        ` : `
          ${goingUp.length === 0 ? '' : '<p class="compare-footnote">No items have gotten cheaper in this window.</p>'}
        `}
      </section>
    `;

    wireRangeChips();
    wirePagination();
  }

  function wireRangeChips() {
    const chips = root.querySelector('.range-chips');
    if (!chips) return;
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      currentRange = btn.dataset.range;
      sessionStorage.setItem(RANGE_KEY, currentRange);
      // Reset pagination when the range changes — fresh dataset, fresh paging
      upShown = PAGE_SIZE;
      downShown = PAGE_SIZE;
      render();
    });
  }

  function wirePagination() {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const scrollY = window.scrollY;
      switch (btn.dataset.act) {
        case 'up-more':   upShown   = upShown   + PAGE_SIZE; break;
        case 'up-less':   upShown   = PAGE_SIZE; break;
        case 'down-more': downShown = downShown + PAGE_SIZE; break;
        case 'down-less': downShown = PAGE_SIZE; break;
        default: return;
      }
      render();
      // Preserve scroll so the user stays oriented after the list re-renders
      window.scrollTo(0, scrollY);
    });
  }

  render();
}

function rangeChipsHTML(active) {
  return `
    <div class="filter-chips range-chips" role="group" aria-label="time range">
      ${RANGES.map(r => `
        <button class="chip ${r.value === active ? 'is-active' : ''}" type="button" data-range="${r.value}">${r.label}</button>
      `).join('')}
    </div>
  `;
}

function rowHTML(r, dir) {
  const displayUnit = displayUnitForUnit(r.newest.unit);
  const cls = dir === 'up' ? 'data-delta-bad' : 'data-delta-good';
  return `
    <li class="data-row">
      <div class="data-row-main">
        <span class="data-name">${escapeHTML(r.item ? r.item.name : 'unknown')}</span>
        <span class="data-delta ${cls}">
          ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)}%
        </span>
      </div>
      <div class="data-row-meta">
        <span>${formatUnitPrice(r.oldest.unit_price, displayUnit)} → ${formatUnitPrice(r.newest.unit_price, displayUnit)}</span>
        <span class="data-cat">${Math.round(r.days)} days</span>
      </div>
    </li>
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
