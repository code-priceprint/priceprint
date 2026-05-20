// Shopping list screen. The user plans what they'll buy this week. Each item
// is matched against their price history to surface (a) the cheapest store
// for it, and (b) the expected total for the planned quantity. Items not yet
// in the catalog can be added as text-only entries; they show "no data" until
// the user logs a price for them.
import {
  getAllItems, getAllPriceLogs, getAllStores,
  getActiveBasket, saveActiveBasket, addPriceLog,
} from './db.js';
import {
  formatPrice, formatCount, computeUnitPrice, FAMILIES, toCanonical, fromCanonical, DISPLAY_UNIT, UNIT_LABELS,
} from './normalize.js';
import { customConfirm } from './dialog.js';

export async function mountShopping(root) {
  const [items, logs, stores, basket] = await Promise.all([
    getAllItems(), getAllPriceLogs(), getAllStores(), getActiveBasket(),
  ]);

  const itemById  = new Map(items.map(i => [i.id, i]));
  const storeById = new Map(stores.map(s => [s.id, s]));

  // Per-item: find the single LOWEST observed price + the store that gave it.
  // Using the absolute lowest (not store averages) so the shopping list always
  // recommends the best deal we have evidence for. We surface that store as
  // the recommendation and use that log's actual price as the line estimate.
  const itemStats = new Map();
  for (const item of items) {
    const itemLogs = logs.filter(l => l.item_id === item.id && l.store_id);
    if (itemLogs.length === 0) continue;

    // The log with the lowest unit_price IS the best deal we've seen
    const cheapestLog = itemLogs.reduce((a, b) => (a.unit_price <= b.unit_price ? a : b));

    itemStats.set(item.id, {
      cheapestStoreId: cheapestLog.store_id,
      // Use the actual price paid for that single log as the per-purchase
      // estimate — avoids unit-conversion gymnastics and reflects a real
      // transaction the user logged at that store.
      bestPrice: cheapestLog.price,
      bestSize: cheapestLog.size,
      bestUnit: cheapestLog.unit,
      bestDate: cheapestLog.date,
    });
  }

  root.innerHTML = `
    <section class="entry">
      <h2 class="screen-title">Shopping list</h2>

      <div class="shop-add">
        <div class="combo">
          <input id="shopInput" type="text" autocomplete="off"
                 placeholder="type an item to add — banana, milk, eggs..." />
          <ul id="shopSuggest" class="suggest" hidden></ul>
        </div>
      </div>

      <ul class="data-list shop-list" id="shopList"></ul>

      <div id="shopBreakdown"></div>
      <div id="shopTotal"></div>

      <div class="entry-secondary">
        <button id="shopClearBtn" class="link-btn link-danger" type="button">Clear list</button>
      </div>
    </section>
  `;

  const inputEl = root.querySelector('#shopInput');
  const suggestEl = root.querySelector('#shopSuggest');
  const listEl = root.querySelector('#shopList');
  const breakdownEl = root.querySelector('#shopBreakdown');
  const totalEl = root.querySelector('#shopTotal');

  function renderList() {
    if (!basket.items || basket.items.length === 0) {
      listEl.innerHTML = `<li class="empty-state shop-empty">Your list is empty. Type above to add items you plan to buy.</li>`;
      breakdownEl.innerHTML = '';
      totalEl.innerHTML = '';
      return;
    }

    let grand = 0;
    let purchasedTotal = 0;
    let purchasedCount = 0;
    const perStore = new Map();
    // Display order: unchecked first, checked at the bottom. Keep the original
    // index so click handlers (qty, remove, check, log) still target correctly.
    const indexed = basket.items.map((bi, idx) => ({ bi, idx }));
    const unchecked = indexed.filter(x => !x.bi.purchased);
    const checked = indexed.filter(x => x.bi.purchased);
    const orderedItems = [...unchecked, ...checked];
    const rowsHTML = orderedItems.map(({ bi, idx }) => {
      const qty = Math.max(1, bi.qty || 1);
      const purchased = !!bi.purchased;

      // Free-text entry (item not in catalog yet)
      if (!bi.itemId) {
        return `
          <li class="data-row shop-row ${purchased ? 'is-purchased' : ''}" data-idx="${idx}">
            <div class="data-row-main">
              <label class="shop-check-wrap">
                <input type="checkbox" class="shop-check" data-check="${idx}" ${purchased ? 'checked' : ''} aria-label="mark as purchased" />
                <span class="data-name">${escapeHTML(bi.name || 'unknown')}</span>
              </label>
              <button class="shop-remove" data-remove="${idx}" type="button" aria-label="remove">×</button>
            </div>
            <div class="data-row-meta">
              <span class="shop-qty-wrap">
                <button class="shop-qty-btn" data-qty="${idx}:-" type="button">−</button>
                <span class="shop-qty">${formatCount(qty)}</span>
                <button class="shop-qty-btn" data-qty="${idx}:+" type="button">+</button>
              </span>
              <span class="shop-meta-empty">no price yet — log it first</span>
            </div>
          </li>
        `;
      }

      // Catalog-linked entry
      const item = itemById.get(bi.itemId);
      if (!item) {
        return `
          <li class="data-row shop-row" data-idx="${idx}">
            <div class="data-row-main">
              <span class="data-name">[deleted item]</span>
              <button class="shop-remove" data-remove="${idx}" type="button">×</button>
            </div>
          </li>
        `;
      }
      const stats = itemStats.get(bi.itemId);
      let storeName = '—';
      let linePrice = null;
      if (stats && stats.cheapestStoreId && stats.bestPrice > 0) {
        const store = storeById.get(stats.cheapestStoreId);
        storeName = store ? store.name : '—';
        linePrice = stats.bestPrice * qty;
        if (purchased) {
          purchasedTotal += linePrice;
          purchasedCount += 1;
        } else {
          grand += linePrice;
          const sid = stats.cheapestStoreId;
          const entry = perStore.get(sid) || { count: 0, total: 0, items: [] };
          entry.count += 1;
          entry.total += linePrice;
          entry.items.push({ name: item.name, qty, price: linePrice });
          perStore.set(sid, entry);
        }
      } else if (purchased) {
        purchasedCount += 1;
      }

      // Total-size display ("2 lb" instead of confusing "2 · 1lb each")
      const totalSize = stats ? (stats.bestSize * qty) : null;
      const unitLabel = stats ? (UNIT_LABELS[stats.bestUnit] || stats.bestUnit) : '';
      const sizeStr = stats ? `${formatNiceNum(totalSize)}${unitLabel}` : '';

      const canLog = !!stats && !!stats.cheapestStoreId && !bi.priceLogged;
      const loggedNote = bi.priceLogged
        ? `<span class="shop-logged-note">✓ ${formatPrice(bi.loggedPrice || 0)} logged at ${escapeHTML(storeName)}</span>`
        : '';

      return `
        <li class="data-row shop-row ${purchased ? 'is-purchased' : ''}" data-idx="${idx}">
          <div class="data-row-main">
            <label class="shop-check-wrap">
              <input type="checkbox" class="shop-check" data-check="${idx}" ${purchased ? 'checked' : ''} aria-label="mark as purchased" />
              <span class="data-name">${escapeHTML(item.name)}</span>
            </label>
            <button class="shop-remove" data-remove="${idx}" type="button" aria-label="remove">×</button>
          </div>
          <div class="data-row-meta">
            <span class="shop-qty-wrap">
              <button class="shop-qty-btn" data-qty="${idx}:-" type="button">−</button>
              <span class="shop-qty">${formatCount(qty)}</span>
              <button class="shop-qty-btn" data-qty="${idx}:+" type="button">+</button>
              ${sizeStr ? `<span class="shop-qty-size">· ${sizeStr}</span>` : ''}
            </span>
            <span class="shop-store">
              ${bi.priceLogged
                ? loggedNote
                : linePrice !== null
                  ? `<strong>${escapeHTML(storeName)}</strong> · ${formatPrice(linePrice)} est`
                  : '<span class="shop-meta-empty">need price + store</span>'}
            </span>
          </div>
          ${purchased && canLog ? `
            <div class="shop-log-form" data-log-form="${idx}">
              <label class="shop-log-label">
                <span>paid</span>
                <span class="shop-log-input-wrap">
                  <span class="shop-log-prefix">$</span>
                  <input type="number" step="0.01" min="0" data-log-input="${idx}"
                         value="${stats.bestPrice.toFixed(2)}" inputmode="decimal" />
                </span>
                <span>at <strong>${escapeHTML(storeName)}</strong></span>
              </label>
              <button class="shop-log-save" data-log-save="${idx}" type="button">Log it →</button>
            </div>
          ` : ''}
        </li>
      `;
    }).join('');
    listEl.innerHTML = rowsHTML;

    // Per-store breakdown — each store expanded with the specific items to buy there
    if (perStore.size > 0) {
      const groups = [...perStore.entries()]
        .map(([sid, s]) => ({ name: storeById.get(sid)?.name || '—', count: s.count, total: s.total, items: s.items }))
        .sort((a, b) => b.total - a.total);
      breakdownEl.innerHTML = `
        <div class="list-head"><span>buy at each store</span><span>subtotal</span></div>
        <div class="shop-stores">
          ${groups.map(g => `
            <section class="shop-store-group">
              <div class="shop-store-head">
                <span class="shop-store-name">${escapeHTML(g.name)}</span>
                <span class="shop-store-stats">${formatCount(g.count)} item${g.count === 1 ? '' : 's'} · <strong>${formatPrice(g.total)}</strong></span>
              </div>
              <ul class="shop-store-items">
                ${g.items.map(i => `
                  <li>
                    <span class="shop-store-item-name">${escapeHTML(i.name)}${i.qty > 1 ? ` ×${formatCount(i.qty)}` : ''}</span>
                    <span class="shop-store-item-price">${formatPrice(i.price)}</span>
                  </li>
                `).join('')}
              </ul>
            </section>
          `).join('')}
        </div>
      `;
    } else {
      breakdownEl.innerHTML = '';
    }

    // Grand total — show remaining (still to buy) + a smaller "already bought" line.
    // When `grand === 0` but there ARE remaining items, those items just don't
    // have price data yet. Show `—` instead of `$0.00` so it doesn't read as a bug.
    const remainingCount = basket.items.length - purchasedCount;
    let stillToBuyAmount;
    if (remainingCount === 0)      stillToBuyAmount = formatPrice(0);
    else if (grand > 0)            stillToBuyAmount = formatPrice(grand);
    else                           stillToBuyAmount = '—';

    totalEl.innerHTML = (grand > 0 || purchasedTotal > 0)
      ? `
        <div class="shop-total-row">
          <span class="shop-total-label">
            STILL TO BUY${remainingCount > 0 ? ` · ${formatCount(remainingCount)}` : ''}
          </span>
          <span class="shop-total-amount">${stillToBuyAmount}</span>
        </div>
        ${purchasedTotal > 0 ? `
          <div class="shop-purchased-row">
            <span>${formatCount(purchasedCount)} already in your cart</span>
            <span>${formatPrice(purchasedTotal)}</span>
          </div>
        ` : ''}
      `
      : '';
  }

  // ----- Autocomplete: existing catalog items + "+ add new" if no match -----
  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) { suggestEl.hidden = true; suggestEl.innerHTML = ''; return; }
    const matches = items
      .filter(i => i.name.toLowerCase().includes(q))
      .slice(0, 5);
    const exact = matches.some(m => m.name.toLowerCase() === q);
    let html = matches.map(m => `
      <li data-id="${m.id}">
        ${escapeHTML(m.name)}
        <span class="cat">${escapeHTML(m.category || '')}</span>
      </li>
    `).join('');
    if (!exact) {
      html += `<li class="shop-add-new" data-add-new>+ add “${escapeHTML(query.trim())}” as a new item</li>`;
    }
    suggestEl.innerHTML = html;
    suggestEl.hidden = false;
  }

  inputEl.addEventListener('input',  () => renderSuggestions(inputEl.value));
  inputEl.addEventListener('focus',  () => renderSuggestions(inputEl.value));
  suggestEl.addEventListener('pointerdown', (e) => e.preventDefault());

  suggestEl.addEventListener('click', async (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (li.dataset.addNew !== undefined) {
      const name = inputEl.value.trim();
      if (!name) return;
      basket.items.push({ name, qty: 1 });
    } else {
      const itemId = Number(li.dataset.id);
      const existing = basket.items.find(b => b.itemId === itemId);
      if (existing) existing.qty = (existing.qty || 1) + 1;
      else basket.items.push({ itemId, qty: 1 });
    }
    await saveActiveBasket(basket);
    inputEl.value = '';
    suggestEl.hidden = true;
    renderList();
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => { suggestEl.hidden = true; }, 200);
  });

  // ----- Row interactions: qty +/-, remove -----
  listEl.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const idx = Number(removeBtn.dataset.remove);
      basket.items.splice(idx, 1);
      await saveActiveBasket(basket);
      renderList();
      return;
    }
    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn) {
      const [idxStr, op] = qtyBtn.dataset.qty.split(':');
      const idx = Number(idxStr);
      const bi = basket.items[idx];
      if (!bi) return;
      bi.qty = Math.max(1, (bi.qty || 1) + (op === '+' ? 1 : -1));
      await saveActiveBasket(basket);
      renderList();
    }
  });

  // Checkbox toggle uses 'change' so it fires reliably on touch + keyboard
  listEl.addEventListener('change', async (e) => {
    const check = e.target.closest('input.shop-check');
    if (!check) return;
    const idx = Number(check.dataset.check);
    const bi = basket.items[idx];
    if (!bi) return;
    bi.purchased = check.checked;
    await saveActiveBasket(basket);
    renderList();
  });

  // Inline "log this price" save — turns the shopping list into a data-entry
  // surface. Submitting creates a real price log for this item at the
  // cheapest store, so the basket itself feeds the catalog over time.
  listEl.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-log-save]');
    if (!saveBtn) return;
    const idx = Number(saveBtn.dataset.logSave);
    const bi = basket.items[idx];
    if (!bi || !bi.itemId) return;
    const stats = itemStats.get(bi.itemId);
    if (!stats || !stats.cheapestStoreId) return;
    const input = listEl.querySelector(`input[data-log-input="${idx}"]`);
    if (!input) return;
    const price = parseFloat(input.value);
    if (!isFinite(price) || price <= 0) { input.focus(); return; }

    const calc = computeUnitPrice(stats.bestSize, stats.bestUnit, price);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    await addPriceLog({
      item_id:    bi.itemId,
      store_id:   stats.cheapestStoreId,
      date,
      size:       stats.bestSize,
      unit:       stats.bestUnit,
      price,
      unit_price: calc ? calc.unit_price : 0,
      is_sale:    false,
      notes:      '',
    });

    bi.priceLogged = true;
    bi.loggedPrice = price;
    await saveActiveBasket(basket);
    window.dispatchEvent(new CustomEvent('priceprint:saved'));
    renderList();
  });

  // Enter key in the log input submits
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('input[data-log-input]');
    if (!input) return;
    e.preventDefault();
    const idx = input.dataset.logInput;
    listEl.querySelector(`[data-log-save="${idx}"]`)?.click();
  });

  root.querySelector('#shopClearBtn').addEventListener('click', async () => {
    if (!basket.items || basket.items.length === 0) return;
    const ok = await customConfirm('Clear every item from your shopping list?', {
      title: 'Clear shopping list',
      confirmLabel: 'Yes, clear',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    basket.items = [];
    await saveActiveBasket(basket);
    renderList();
  });

  renderList();
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Tidy number formatting — strips trailing zeros, keeps it readable.
function formatNiceNum(n) {
  if (n == null || !isFinite(n)) return '';
  const fixed = n.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}
