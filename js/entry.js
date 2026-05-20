// Item entry screen. Designed for <10 seconds per log once the catalog is warm.
import {
  getAllItems, findItemByName, upsertItem,
  getAllStores, findStoreByName, upsertStore,
  addPriceLog, getLastPriceForItem, getPriceHistoryForItem,
} from './db.js';
import { computeUnitPrice, formatUnitPrice, formatPrice, formatFriendlyDate, dayOfWeek, DAY_NAMES, UNIT_LABELS, FAMILIES } from './normalize.js';

const CATEGORIES = ['produce', 'dairy', 'pantry', 'meat', 'frozen', 'household', 'personal care', 'beverage', 'other'];
const UNIT_OPTIONS = Object.keys(UNIT_LABELS);

let cachedItems = [];
let cachedStores = [];
let pickedItem = null; // existing item if user selected one
let pickedStore = null;

export async function mountEntry(root) {
  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Log a price</h2>

      <label class="field">
        <span class="lbl">Item</span>
        <div class="combo">
          <input id="itemInput" type="text" autocomplete="off" placeholder="e.g. olive oil" />
          <ul id="itemSuggest" class="suggest" hidden></ul>
        </div>
      </label>

      <label class="field">
        <span class="lbl">Store</span>
        <div class="combo">
          <input id="storeInput" type="text" autocomplete="off" placeholder="e.g. Costco" />
          <ul id="storeSuggest" class="suggest" hidden></ul>
        </div>
      </label>

      <div class="row two">
        <label class="field">
          <span class="lbl">Size</span>
          <input id="sizeInput" type="number" inputmode="decimal" step="any" min="0" placeholder="32" />
        </label>
        <label class="field">
          <span class="lbl">Unit</span>
          <select id="unitInput">
            ${UNIT_OPTIONS.map(u => `<option value="${u}">${UNIT_LABELS[u]}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="row two">
        <label class="field">
          <span class="lbl">Price paid</span>
          <input id="priceInput" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" />
        </label>
        <label class="field">
          <span class="lbl">When</span>
          <input id="dateInput" type="datetime-local" step="60" />
        </label>
      </div>

      <label class="field inline">
        <input id="saleInput" type="checkbox" />
        <span>Store marked this as a sale</span>
      </label>

      <div id="livePreview" class="preview" hidden></div>
      <div id="lastSeen" class="hint" hidden></div>
      <div id="priceAlerts" class="price-alerts" hidden></div>

      <div class="actions">
        <button id="submitBtn" class="primary" type="button">Save price</button>
      </div>

      <p id="status" class="status" role="status" aria-live="polite"></p>

      <div class="entry-secondary">
        <button id="clearBtn" class="link-btn" type="button">Clear form</button>
      </div>
    </section>

    <p id="firstActionNudge" class="nudge" hidden>
      Your catalog grows every time you log a price. Start with the item you buy most often.
    </p>
  `;

  // Default to current local date + time. ISO is UTC, so build the value
  // from local-clock components to match the input's "datetime-local" semantics.
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const localNow = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  root.querySelector('#dateInput').value = localNow;
  root.querySelector('#unitInput').value = 'oz';

  await refreshCaches();
  updateNudge(root);

  // If we arrived here from an item-detail "Log new price" shortcut, pre-pick
  // that item and pre-fill from its last log so the only thing left is price.
  const prefillId = sessionStorage.getItem('priceprint.entry.prefillItemId');
  let didPrefill = false;
  if (prefillId) {
    sessionStorage.removeItem('priceprint.entry.prefillItemId');
    const item = cachedItems.find(i => i.id === Number(prefillId));
    if (item) {
      pickedItem = item;
      root.querySelector('#itemInput').value = item.name;
      await prefillFromLastLog(root, item.id);
      didPrefill = true;
    }
  }

  // Restore any in-progress draft from a prior page load so a refresh doesn't
  // wipe what the user was typing. Skipped when a prefill happened — the user
  // explicitly asked to log a specific item, don't restore an unrelated draft.
  if (!didPrefill) restoreDraft(root);

  wireItemAutocomplete(root);
  wireStoreAutocomplete(root);
  wireLivePreview(root);
  wireSubmit(root);
  wireClearForm(root);
  wireDraftPersistence(root);

  if (didPrefill) {
    setTimeout(() => focusNextEmpty(root), 50);
  }
}

function wireClearForm(root) {
  const btn = root.querySelector('#clearBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    pickedItem = null;
    pickedStore = null;
    root.querySelector('#itemInput').value = '';
    root.querySelector('#storeInput').value = '';
    root.querySelector('#sizeInput').value = '';
    root.querySelector('#priceInput').value = '';
    root.querySelector('#saleInput').checked = false;
    root.querySelector('#livePreview').hidden = true;
    root.querySelector('#lastSeen').hidden = true;
    root.querySelector('#unitInput').value = 'oz';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    root.querySelector('#dateInput').value =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    clearDraft();
    root.querySelector('#status').textContent = '';
    root.querySelector('#status').className = 'status';
    root.querySelector('#itemInput').focus();
  });
}

const DRAFT_KEY = 'priceprint.entry.draft';

function saveDraft(root) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      item:  root.querySelector('#itemInput').value,
      store: root.querySelector('#storeInput').value,
      size:  root.querySelector('#sizeInput').value,
      unit:  root.querySelector('#unitInput').value,
      price: root.querySelector('#priceInput').value,
      date:  root.querySelector('#dateInput').value,
      sale:  root.querySelector('#saleInput').checked,
    }));
  } catch {}
}

function restoreDraft(root) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.item)  root.querySelector('#itemInput').value  = d.item;
    if (d.store) root.querySelector('#storeInput').value = d.store;
    if (d.size)  root.querySelector('#sizeInput').value  = d.size;
    if (d.unit)  root.querySelector('#unitInput').value  = d.unit;
    if (d.price) root.querySelector('#priceInput').value = d.price;
    // datetime-local requires "YYYY-MM-DDTHH:MM" — skip stale drafts with just a date.
    if (d.date && d.date.includes('T')) root.querySelector('#dateInput').value = d.date;
    if (d.sale)  root.querySelector('#saleInput').checked = true;
  } catch {}
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

function wireDraftPersistence(root) {
  const ids = ['itemInput','storeInput','sizeInput','unitInput','priceInput','dateInput','saleInput'];
  for (const id of ids) {
    const el = root.querySelector('#' + id);
    if (!el) continue;
    const evt = (el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(evt, () => saveDraft(root));
  }
}

async function refreshCaches() {
  [cachedItems, cachedStores] = await Promise.all([getAllItems(), getAllStores()]);
}

function updateNudge(root) {
  const nudge = root.querySelector('#firstActionNudge');
  if (!nudge) return;
  nudge.hidden = cachedItems.length > 0;
}

// ---------- autosuggest ----------

const MAX_SUGGESTIONS = 5;

function fuzzyMatch(query, candidates, getName) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const c of candidates) {
    const name = (getName(c) || '').toLowerCase();
    if (!name) continue;
    let idx = 0;
    for (const ch of q) {
      idx = name.indexOf(ch, idx);
      if (idx === -1) break;
      idx++;
    }
    if (idx !== -1) {
      const startsWith = name.startsWith(q) ? 0 : 1;
      const score = startsWith * 100 + (name.length - q.length);
      results.push({ c, score });
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, MAX_SUGGESTIONS).map(r => r.c);
}

function wireItemAutocomplete(root) {
  const input = root.querySelector('#itemInput');
  const list = root.querySelector('#itemSuggest');

  function render(query) {
    pickedItem = null;
    const matches = query.trim()
      ? fuzzyMatch(query, cachedItems, i => i.name)
      : [...cachedItems].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SUGGESTIONS);
    if (matches.length === 0) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.innerHTML = matches.map(m => `<li data-id="${m.id}">${escapeHTML(m.name)} <span class="cat">${escapeHTML(m.category || '')}</span></li>`).join('');
    list.hidden = false;
  }

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));

  // Prevent the input from losing focus when the user taps a suggestion —
  // otherwise blur fires before click and the dropdown hides too early.
  list.addEventListener('pointerdown', (e) => e.preventDefault());

  list.addEventListener('click', async (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const id = Number(li.dataset.id);
    const item = cachedItems.find(i => i.id === id);
    if (!item) return;
    pickedItem = item;
    input.value = item.name;
    list.hidden = true;
    await prefillFromLastLog(root, item.id);
    updateLivePreview(root);
    focusNextEmpty(root);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.hidden = true; }, 200);
  });
}

// After picking an item or store, drop the user into the first unfilled field
// so the only remaining keystroke is usually the new price.
function focusNextEmpty(root) {
  const order = ['storeInput', 'sizeInput', 'priceInput'];
  for (const id of order) {
    const el = root.querySelector('#' + id);
    if (el && !el.value) { el.focus(); return; }
  }
  root.querySelector('#priceInput').focus();
}

function wireStoreAutocomplete(root) {
  const input = root.querySelector('#storeInput');
  const list = root.querySelector('#storeSuggest');

  function render(query) {
    pickedStore = null;
    const matches = query.trim()
      ? fuzzyMatch(query, cachedStores, s => s.name)
      : [...cachedStores].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SUGGESTIONS);
    if (matches.length === 0) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.innerHTML = matches.map(m => `<li data-id="${m.id}">${escapeHTML(m.name)}</li>`).join('');
    list.hidden = false;
  }

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));

  list.addEventListener('pointerdown', (e) => e.preventDefault());

  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const id = Number(li.dataset.id);
    const store = cachedStores.find(s => s.id === id);
    if (!store) return;
    pickedStore = store;
    input.value = store.name;
    list.hidden = true;
    focusNextEmpty(root);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.hidden = true; }, 200);
  });
}

async function prefillFromLastLog(root, itemId) {
  const last = await getLastPriceForItem(itemId);
  const hint = root.querySelector('#lastSeen');
  if (!last) {
    hint.hidden = true;
    return;
  }
  // Pre-fill size + unit + store from last log so user only changes the price.
  root.querySelector('#sizeInput').value = last.size;
  root.querySelector('#unitInput').value = last.unit;
  if (last.store_id) {
    const store = cachedStores.find(s => s.id === last.store_id);
    if (store) {
      root.querySelector('#storeInput').value = store.name;
      pickedStore = store;
    }
  }
  const unitPrice = formatUnitPrice(last.unit_price, displayUnitForUnit(last.unit));
  let mainHint = `Last time: ${formatPrice(last.price)} for ${last.size}${UNIT_LABELS[last.unit] || last.unit} · ${formatFriendlyDate(last.date)} · ${unitPrice}`;

  // Day-of-week insight: if this item has logs on 3+ distinct days and one
  // day's average is meaningfully below overall, tell the user.
  const history = await getPriceHistoryForItem(itemId);
  const dayBuckets = new Map();
  for (const log of history) {
    const dow = dayOfWeek(log.date);
    if (dow === null) continue;
    if (!dayBuckets.has(dow)) dayBuckets.set(dow, []);
    dayBuckets.get(dow).push(log.unit_price);
  }
  if (dayBuckets.size >= 3) {
    const overallAvg = history.reduce((s, l) => s + l.unit_price, 0) / history.length;
    let bestDow = null, bestAvg = Infinity, bestCount = 0;
    for (const [dow, prices] of dayBuckets) {
      if (prices.length < 2) continue;
      const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
      if (avg < bestAvg) { bestAvg = avg; bestDow = dow; bestCount = prices.length; }
    }
    if (bestDow !== null) {
      const pct = ((overallAvg - bestAvg) / overallAvg) * 100;
      if (pct >= 3) {
        mainHint += `\nTip: cheapest on ${DAY_NAMES[bestDow]}s — about ${pct.toFixed(0)}% below average.`;
      }
    }
  }
  hint.textContent = mainHint;
  hint.hidden = false;
}

function displayUnitForUnit(unit) {
  const fam = FAMILIES[unit];
  if (!fam) return unit;
  return ({ weight: 'oz', volume: 'floz', count: 'ct' })[fam.family];
}

// ---------- live preview ----------

function wireLivePreview(root) {
  ['sizeInput', 'unitInput', 'priceInput'].forEach(id => {
    root.querySelector('#' + id).addEventListener('input', () => {
      updateLivePreview(root);
      updatePriceAlerts(root);
    });
  });
  // Also recompute alerts whenever item or store changes
  root.querySelector('#itemInput').addEventListener('input', () => updatePriceAlerts(root));
  root.querySelector('#storeInput').addEventListener('input', () => updatePriceAlerts(root));
}

// Compares the price the user is currently typing against history:
//   1. Same-store trend: is this higher/lower than the last time they bought
//      it here? (with a 5% threshold to avoid noise)
//   2. Cross-store: is another store cheaper on average? (5% threshold)
async function updatePriceAlerts(root) {
  const box = root.querySelector('#priceAlerts');
  if (!box) return;

  const itemName = root.querySelector('#itemInput').value.trim();
  const storeName = root.querySelector('#storeInput').value.trim();
  const size = parseFloat(root.querySelector('#sizeInput').value);
  const unit = root.querySelector('#unitInput').value;
  const price = parseFloat(root.querySelector('#priceInput').value);

  // Need item, store, size, and price to compute anything meaningful
  const item = pickedItem || cachedItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
  const store = pickedStore || cachedStores.find(s => s.name.toLowerCase() === storeName.toLowerCase());
  if (!item || !store || !isFinite(size) || size <= 0 || !isFinite(price) || price <= 0) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const calc = computeUnitPrice(size, unit, price);
  if (!calc) { box.hidden = true; return; }
  const currentUP = calc.unit_price;
  const displayUnit = calc.display_unit;

  const history = await getPriceHistoryForItem(item.id);
  const alerts = [];

  // ---- 1. Same store, vs most recent log ----
  const sameStore = history.filter(l => l.store_id === store.id);
  if (sameStore.length > 0) {
    const last = sameStore.reduce((a, b) => (a.date > b.date ? a : b));
    if (last.unit_price > 0) {
      const pct = ((currentUP - last.unit_price) / last.unit_price) * 100;
      if (pct >= 5) {
        alerts.push({
          kind: 'up',
          text: `Price went up <strong>${pct.toFixed(0)}%</strong> at ${escapeHTML(store.name)} since your last log.`,
        });
      } else if (pct <= -5) {
        alerts.push({
          kind: 'down',
          text: `Price dropped <strong>${Math.abs(pct).toFixed(0)}%</strong> at ${escapeHTML(store.name)} since your last log.`,
        });
      }
    }
  }

  // ---- 2. Cross-store: cheaper elsewhere? ----
  const otherStore = history.filter(l => l.store_id && l.store_id !== store.id);
  if (otherStore.length > 0) {
    const byStore = new Map();
    for (const log of otherStore) {
      if (!byStore.has(log.store_id)) byStore.set(log.store_id, []);
      byStore.get(log.store_id).push(log.unit_price);
    }
    let cheapestId = null, cheapestAvg = Infinity;
    for (const [sid, prices] of byStore) {
      const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
      if (avg < cheapestAvg) { cheapestAvg = avg; cheapestId = sid; }
    }
    if (cheapestAvg < currentUP * 0.95) {
      const cheaperStore = cachedStores.find(s => s.id === cheapestId);
      const pct = ((currentUP - cheapestAvg) / cheapestAvg) * 100;
      alerts.push({
        kind: 'cross',
        text: `<strong>${escapeHTML(cheaperStore ? cheaperStore.name : 'Another store')}</strong> is about <strong>${pct.toFixed(0)}%</strong> cheaper on this — ${formatUnitPrice(cheapestAvg, displayUnit)} vs ${formatUnitPrice(currentUP, displayUnit)}.`,
      });
    } else if (currentUP < cheapestAvg * 0.95 && sameStore.length > 0) {
      // Bonus: this is even cheaper than the previously cheapest store
      alerts.push({
        kind: 'win',
        text: `Best price you've seen for this item across every store you track 🎉`,
      });
    }
  }

  if (alerts.length === 0) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = alerts.map(a => `
    <div class="price-alert price-alert-${a.kind}">
      <span class="price-alert-icon">${iconFor(a.kind)}</span>
      <span class="price-alert-text">${a.text}</span>
    </div>
  `).join('');
  box.hidden = false;
}

function iconFor(kind) {
  if (kind === 'up')    return '↑';
  if (kind === 'down')  return '↓';
  if (kind === 'cross') return '⇄';
  if (kind === 'win')   return '★';
  return '·';
}

function updateLivePreview(root) {
  const size = parseFloat(root.querySelector('#sizeInput').value);
  const unit = root.querySelector('#unitInput').value;
  const price = parseFloat(root.querySelector('#priceInput').value);
  const box = root.querySelector('#livePreview');
  if (!size || !price || !unit) {
    box.hidden = true;
    return;
  }
  const calc = computeUnitPrice(size, unit, price);
  if (!calc) {
    box.hidden = true;
    return;
  }
  box.innerHTML = `<strong>${formatUnitPrice(calc.unit_price, calc.display_unit)}</strong> <span class="muted">unit price</span>`;
  box.hidden = false;
}

// ---------- submit ----------

function wireSubmit(root) {
  const btn = root.querySelector('#submitBtn');
  const status = root.querySelector('#status');

  btn.addEventListener('click', async () => {
    status.textContent = '';
    status.className = 'status';

    const itemName = root.querySelector('#itemInput').value.trim();
    const storeName = root.querySelector('#storeInput').value.trim();
    const size = parseFloat(root.querySelector('#sizeInput').value);
    const unit = root.querySelector('#unitInput').value;
    const price = parseFloat(root.querySelector('#priceInput').value);
    const date = root.querySelector('#dateInput').value;
    const isSale = root.querySelector('#saleInput').checked;

    if (!itemName) return fail(status, 'Item name is required.');
    if (!storeName) return fail(status, 'Store is required.');
    if (!isFinite(size) || size <= 0) return fail(status, 'Size must be positive.');
    if (!isFinite(price) || price <= 0) return fail(status, 'Price must be positive.');
    if (!date) return fail(status, 'Date is required.');

    const calc = computeUnitPrice(size, unit, price);
    if (!calc) return fail(status, 'Could not compute a unit price.');

    btn.disabled = true;
    try {
      // Upsert item
      let item = pickedItem;
      if (!item) {
        const existing = await findItemByName(itemName);
        if (existing) item = existing;
      }
      if (!item) {
        const id = await upsertItem({
          name: itemName,
          category: 'other',
          preferred_unit: unit,
          barcode: null,
          notes: '',
        });
        item = { id, name: itemName };
      }

      // Upsert store
      let store = pickedStore;
      if (!store) {
        const existing = await findStoreByName(storeName);
        if (existing) store = existing;
      }
      if (!store) {
        const id = await upsertStore({ name: storeName, chain: '', location: '', notes: '' });
        store = { id, name: storeName };
      }

      await addPriceLog({
        item_id: item.id,
        store_id: store.id,
        date,
        size,
        unit,
        price,
        unit_price: calc.unit_price,
        is_sale: isSale,
        notes: '',
      });

      status.textContent = `Saved · ${formatUnitPrice(calc.unit_price, calc.display_unit)} for ${itemName} at ${storeName}.`;
      status.className = 'status ok';

      clearDraft();

      // Refresh caches FIRST so the next autocomplete render sees the new item.
      // Then clear the form + refocus — the focus event triggers a fresh render.
      await refreshCaches();
      updateNudge(root);
      window.dispatchEvent(new CustomEvent('priceprint:saved'));

      // Reset for next entry — keep store + date for fast repeat logging.
      pickedItem = null;
      root.querySelector('#itemInput').value = '';
      root.querySelector('#sizeInput').value = '';
      root.querySelector('#priceInput').value = '';
      root.querySelector('#saleInput').checked = false;
      root.querySelector('#livePreview').hidden = true;
      root.querySelector('#lastSeen').hidden = true;
      root.querySelector('#priceAlerts').hidden = true;
      root.querySelector('#priceAlerts').innerHTML = '';
      root.querySelector('#itemInput').focus();
    } catch (err) {
      console.error(err);
      fail(status, 'Could not save. Check console for details.');
    } finally {
      btn.disabled = false;
    }
  });
}

function fail(statusEl, msg) {
  statusEl.textContent = msg;
  statusEl.className = 'status err';
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
