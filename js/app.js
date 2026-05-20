// App shell. Tab routing — only Entry is built in this pass; others are placeholders.
import { mountEntry } from './entry.js';
import { mountHistory } from './history.js';
import { mountValidator } from './validator.js';
import { mountList } from './list.js';
import { mountStores } from './stores.js';
import { mountCompare } from './compare.js';
import { mountInflation } from './inflation.js';
import { mountShopping } from './shopping.js';
import { getAllItems, getAllPriceLogs, wipeAll, exportAll, importAll } from './db.js';
import { formatCount } from './normalize.js';
import { seedTestData } from './seed.js';
import { customConfirm, customAlert } from './dialog.js';

// Dev helpers — call from the browser console.
window.seedPriceprint = seedTestData;
window.wipePriceprint = wipeAll;

// Per-screen config. `path` is the dedicated SEO landing URL for that screen;
// tab clicks pushState that path so the browser address bar tracks the active
// screen, and so visitors can bookmark/share a specific tab. Each path also
// corresponds to a real static HTML file with unique <title>, <meta>, H1, and
// explainer copy — Google indexes that, not app.html.
const SCREENS = {
  entry:     { label: 'Log price',  mount: mountEntry,     path: 'log-price.html'  },
  shopping:  { label: 'Shopping',   mount: mountShopping,  path: 'shopping.html'   },
  compare:   { label: 'Compare',    mount: mountCompare,   path: 'compare.html'    },
  validator: { label: 'Sale check', mount: mountValidator, path: 'sale-check.html' },
  history:   { label: 'History',    mount: mountHistory,   path: 'history.html'    },
  list:      { label: 'List',       mount: mountList,      path: 'list.html'       },
  stores:    { label: 'Stores',     mount: mountStores,    path: 'stores.html'     },
  inflation: { label: 'Inflation',  mount: mountInflation, path: 'inflation.html'  },
};

const TAB_KEY = 'priceprint.activeTab';

async function init() {
  const tabs = document.getElementById('tabs');
  const main = document.getElementById('screen');

  // Initial tab priority: body data-screen (set per SEO landing page) > URL
  // hash (legacy deep-link form) > session storage (resume) > default. The
  // data-screen marker wins because each /<screen>.html page declares the
  // tab it represents, and that should always match the URL the user opened.
  const bodyScreen = document.body.dataset.screen;
  const hashTab = (location.hash || '').replace(/^#/, '');
  const savedTab = sessionStorage.getItem(TAB_KEY);
  const initialTab =
    (bodyScreen && SCREENS[bodyScreen]) ? bodyScreen :
    (hashTab && SCREENS[hashTab]) ? hashTab :
    (savedTab && SCREENS[savedTab]) ? savedTab :
    'entry';

  // Tabs are real links to the per-screen SEO pages. Full navigation (not
  // pushState) so every tab click delivers the same H1 + intro + explainer +
  // FAQ that a Google visitor would see landing on that URL directly. The
  // alternative (pushState + JS swap) silently dropped that content and made
  // top-nav clicks feel different from chip-link clicks on the home page.
  tabs.innerHTML = Object.entries(SCREENS).map(([k, v]) =>
    `<a class="tab${k === initialTab ? ' active' : ''}" data-screen="${k}" href="${v.path}">${v.label}</a>`
  ).join('') + '<span class="tabs-scroll-hint" aria-hidden="true">→</span>';

  // Show/hide the scroll-hint arrow based on overflow + scroll position.
  function updateScrollHint() {
    const overflowing = tabs.scrollWidth > tabs.clientWidth + 2;
    const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 4;
    tabs.classList.toggle('has-overflow', overflowing && !atEnd);
  }
  tabs.addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
  // Run once on mount + once after fonts/layout settle
  updateScrollHint();
  requestAnimationFrame(updateScrollHint);

  // Persist the active tab as the user moves between pages so that bare
  // app.html still resumes where they left off. The browser handles the
  // navigation itself via the anchor hrefs above.
  tabs.addEventListener('click', (e) => {
    const a = e.target.closest('.tab');
    if (!a) return;
    const name = a.dataset.screen;
    if (name && SCREENS[name]) sessionStorage.setItem(TAB_KEY, name);
  });

  try {
    await show(initialTab);
  } catch (err) {
    console.error('[priceprint] failed to mount screen', initialTab, err);
    const mainEl = document.getElementById('screen');
    if (mainEl) mainEl.innerHTML = `
      <section class="entry placeholder-card">
        <h2 class="screen-title">Something went wrong</h2>
        <p>${String(err.message || err)}</p>
      </section>
    `;
  }
  await renderFooterStats();
  wireDataActions();

  // Live-update footer + active-screen state whenever a price gets saved.
  window.addEventListener('priceprint:saved', async (e) => {
    await renderFooterStats();
    const active = document.querySelector('.tab.active');
    const name = active ? active.dataset.screen : null;
    if (name && name !== 'entry') {
      // Relay the just-edited id so the re-mounted screen can flash that row.
      if (e.detail) sessionStorage.setItem('priceprint.flashEdit', JSON.stringify(e.detail));
      // Preserve scroll so the user doesn't get yanked back to the top after editing.
      const scrollY = window.scrollY;
      await show(name);
      window.scrollTo(0, scrollY);
    }
  });
}

function wireDataActions() {
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const wipeBtn   = document.getElementById('wipeBtn');
  const fileInput = document.getElementById('importFile');
  if (!exportBtn || !importBtn || !fileInput) return;

  wipeBtn?.addEventListener('click', async () => {
    const yes = await customConfirm(
      'Wipe ALL data on this device? Items, stores, price history — gone, not recoverable.',
      { title: 'Wipe everything', confirmLabel: 'Yes, wipe all', cancelLabel: 'Keep it', danger: true }
    );
    if (!yes) return;
    await wipeAll();
    sessionStorage.removeItem('priceprint.entry.draft');
    await customAlert('All data cleared.', { title: 'Done' });
    location.reload();
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  exportBtn.addEventListener('click', async () => {
    try {
      const data = await exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `priceprint-${stamp}.json`,
      );
    } catch (err) {
      console.error(err);
      await customAlert((err.message || String(err)), { title: 'Could not export' });
    }
  });

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  exportCsvBtn?.addEventListener('click', async () => {
    try {
      const data = await exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      const csv = priceLogsToCsv(data);
      downloadBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `priceprint-${stamp}.csv`,
      );
    } catch (err) {
      console.error(err);
      await customAlert((err.message || String(err)), { title: 'Could not export CSV' });
    }
  });

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const proceed = await customConfirm(
      'Importing will REPLACE everything currently on this device with the contents of the file. Continue?',
      { title: 'Import data', confirmLabel: 'Yes, replace', cancelLabel: 'Cancel', danger: true }
    );
    if (!proceed) { fileInput.value = ''; return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importAll(data);
      await customAlert(
        `Imported ${result.items} items, ${result.stores} stores, ${result.logs} price logs. Reloading.`,
        { title: 'Import complete' }
      );
      location.reload();
    } catch (err) {
      console.error(err);
      await customAlert((err.message || String(err)), { title: 'Import failed' });
    } finally {
      fileInput.value = '';
    }
  });
}

async function show(name) {
  const main = document.getElementById('screen');
  main.innerHTML = '';
  await SCREENS[name].mount(main);
}

async function renderFooterStats() {
  const [items, logs] = await Promise.all([getAllItems(), getAllPriceLogs()]);
  const el = document.getElementById('footerStats');
  if (!el) return;

  // Honest measurement: serialize the user's actual records. The browser's
  // navigator.storage.estimate() conflates IndexedDB records with cached page
  // assets and pre-allocated DB blocks, which inflates numbers dramatically.
  let storage = '';
  try {
    const dataBlob = JSON.stringify({ items, logs });
    const dataBytes = new Blob([dataBlob]).size;
    let quotaStr = '';
    if (navigator.storage && navigator.storage.estimate) {
      const { quota } = await navigator.storage.estimate();
      if (typeof quota === 'number' && quota > 0) {
        quotaStr = ` · ${formatBytes(quota)} available`;
      }
    }
    storage = ` · your data: ${formatBytes(dataBytes)}${quotaStr}`;
  } catch {}

  el.textContent =
    `${formatCount(items.length)} item${items.length === 1 ? '' : 's'} · ` +
    `${formatCount(logs.length)} log${logs.length === 1 ? '' : 's'} · ` +
    `all on this device${storage}`;
}

function formatBytes(bytes) {
  if (!isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// CSV export — denormalized one-row-per-log shape so a spreadsheet can open
// it without joining tables. Includes item name + category + store name
// (resolved from the foreign keys), the raw price + size + unit you logged,
// and the computed unit_price. RFC 4180 quoting: wrap any cell that contains
// a comma, quote, or newline in double quotes; double up any inner quote.
function priceLogsToCsv({ items, stores, price_history }) {
  const itemById  = new Map(items.map(i => [i.id, i]));
  const storeById = new Map(stores.map(s => [s.id, s]));
  const headers = ['date', 'item', 'category', 'store', 'size', 'unit', 'price', 'unit_price', 'unit_price_per', 'is_sale'];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = price_history
    .slice()
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .map(log => {
      const item  = itemById.get(log.item_id);
      const store = log.store_id ? storeById.get(log.store_id) : null;
      return [
        log.date,
        item ? item.name : '',
        item ? (item.category || '') : '',
        store ? store.name : '',
        log.size,
        log.unit,
        log.price,
        log.unit_price,
        log.unit, // the unit the unit_price is per — same as `unit` since we store display unit
        log.is_sale ? 'true' : 'false',
      ].map(cell).join(',');
    });
  return headers.join(',') + '\n' + rows.join('\n') + '\n';
}

init().catch(err => {
  console.error('PricePrint failed to boot:', err);
  document.getElementById('screen').innerHTML = `<section class="placeholder"><h2 class="screen-title">Something went wrong</h2><p>${String(err.message || err)}</p></section>`;
});
