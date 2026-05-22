// Standalone personal-inflation calculator for the landing-page lead magnet.
// No IndexedDB, no fetch — pure arithmetic on what the visitor types. Mirrors
// the app's Inflation tab logic in miniature: sum a small basket "then" vs
// "now", annualize the change over the chosen period, and compare it to the
// official U.S. CPI figure (kept in sync with js/inflation.js).

// U.S. CPI year-over-year reference. Keep this matching US_CPI_ANNUAL in
// inflation.js so the calculator and the in-app screen tell the same story.
const US_CPI_ANNUAL = 3.0;
const US_CPI_AS_OF = '2024';

const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const fmtMoney = (n) => '$' + n.toFixed(2);

function rowTemplate(placeholder) {
  return `
    <div class="calc-row">
      <input type="text" class="calc-item" placeholder="${placeholder}" aria-label="item name" />
      <div class="calc-field calc-field-was">
        <span class="calc-prefix">$</span>
        <input type="number" inputmode="decimal" class="calc-was" placeholder="0.00" min="0" step="0.01" aria-label="price before" />
      </div>
      <span class="calc-arrow">→</span>
      <div class="calc-field calc-field-now">
        <span class="calc-prefix">$</span>
        <input type="number" inputmode="decimal" class="calc-now" placeholder="0.00" min="0" step="0.01" aria-label="price now" />
      </div>
      <button type="button" class="calc-remove" aria-label="remove row" title="remove">×</button>
    </div>
  `;
}

export function mountInflationCalculator(root) {
  root.innerHTML = `
    <div class="calc-rows" id="calcRows">
      ${rowTemplate('e.g. milk')}
      ${rowTemplate('e.g. eggs')}
      ${rowTemplate('e.g. coffee')}
    </div>
    <div class="calc-controls">
      <button type="button" class="calc-add" id="calcAddRow">+ add an item</button>
      <label class="calc-period">
        over the past
        <select id="calcPeriod" aria-label="time period">
          <option value="0.5">6 months</option>
          <option value="1" selected>1 year</option>
          <option value="2">2 years</option>
          <option value="3">3 years</option>
          <option value="5">5 years</option>
        </select>
      </label>
    </div>

    <div class="calc-result" id="calcResult" hidden></div>
  `;

  const rowsEl = root.querySelector('#calcRows');
  const addBtn = root.querySelector('#calcAddRow');
  const periodEl = root.querySelector('#calcPeriod');
  const resultEl = root.querySelector('#calcResult');

  function compute() {
    let was = 0, now = 0, pairs = 0;
    rowsEl.querySelectorAll('.calc-row').forEach(row => {
      const w = parseFloat(row.querySelector('.calc-was').value);
      const n = parseFloat(row.querySelector('.calc-now').value);
      if (isFinite(w) && isFinite(n) && w > 0 && n > 0) {
        was += w;
        now += n;
        pairs++;
      }
    });

    if (pairs === 0 || was === 0) {
      resultEl.hidden = true;
      return;
    }

    const years = parseFloat(periodEl.value) || 1;
    const totalChange = (now - was) / was * 100;            // raw % over the whole period
    const annualized = (Math.pow(now / was, 1 / years) - 1) * 100; // compounded per year
    const gap = annualized - US_CPI_ANNUAL;

    const dirWord = annualized >= 0 ? 'up' : 'down';
    const gapClass = gap >= 0 ? 'is-up' : 'is-down';
    const gapWord = gap >= 0 ? 'higher' : 'lower';

    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="calc-result-label">YOUR PERSONAL INFLATION</div>
      <div class="calc-result-big ${gap >= 0 ? 'is-up' : 'is-down'}">${fmtPct(annualized)}<span class="calc-result-unit"> / year</span></div>
      <div class="calc-result-sub">
        your basket went ${dirWord} ${fmtMoney(was)} → ${fmtMoney(now)}
        (${fmtPct(totalChange)} over ${years === 0.5 ? '6 months' : years + (years === 1 ? ' year' : ' years')})
        across ${pairs} item${pairs === 1 ? '' : 's'}
      </div>
      <div class="calc-result-compare">
        vs the official U.S. rate of <strong>${US_CPI_ANNUAL.toFixed(1)}%</strong> —
        you're <strong class="${gapClass}">${Math.abs(gap).toFixed(1)} pts ${gapWord}</strong>
        <div class="calc-result-cite">U.S. CPI year-over-year, ~${US_CPI_ANNUAL.toFixed(1)}% (year ending ${US_CPI_AS_OF})</div>
      </div>
      <div class="calc-result-cta">
        <p>This is a one-time snapshot. PricePrint tracks it automatically every time you log a price — across every item, every store, over years.</p>
        <a href="/log-price.html" class="calc-cta-btn">Track it automatically →</a>
      </div>
    `;
  }

  addBtn.addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', rowTemplate('another item'));
  });

  rowsEl.addEventListener('input', compute);
  periodEl.addEventListener('change', compute);
  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.calc-remove');
    if (!btn) return;
    // Keep at least one row on the board.
    if (rowsEl.querySelectorAll('.calc-row').length > 1) {
      btn.closest('.calc-row').remove();
      compute();
    }
  });
}
