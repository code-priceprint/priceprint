// PricePrint IndexedDB — four object stores. All data stays in this browser.
// DB_NAME is mutable via setDBName() so the landing-page demo can run against
// a SEPARATE database (`priceprint-demo`) without touching real user data.
let DB_NAME = 'priceprint';
const DB_VERSION = 1;

let _dbPromise = null;

export function setDBName(name) {
  DB_NAME = name;
  _dbPromise = null; // force re-open on next call
}

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        items.createIndex('name', 'name', { unique: false });
        items.createIndex('category', 'category', { unique: false });
        items.createIndex('barcode', 'barcode', { unique: false });
        items.createIndex('last_logged_at', 'last_logged_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('price_history')) {
        const ph = db.createObjectStore('price_history', { keyPath: 'id', autoIncrement: true });
        ph.createIndex('item_id', 'item_id', { unique: false });
        ph.createIndex('store_id', 'store_id', { unique: false });
        ph.createIndex('date', 'date', { unique: false });
        ph.createIndex('unit_price', 'unit_price', { unique: false });
        ph.createIndex('item_date', ['item_id', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains('stores')) {
        const stores = db.createObjectStore('stores', { keyPath: 'id', autoIncrement: true });
        stores.createIndex('name', 'name', { unique: false });
        stores.createIndex('chain', 'chain', { unique: false });
      }

      if (!db.objectStoreNames.contains('baskets')) {
        db.createObjectStore('baskets', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, storeNames, mode = 'readonly') {
  return db.transaction(storeNames, mode);
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- items ----------

export async function getAllItems() {
  const db = await openDB();
  return reqAsPromise(tx(db, 'items').objectStore('items').getAll());
}

export async function getItem(id) {
  const db = await openDB();
  return reqAsPromise(tx(db, 'items').objectStore('items').get(id));
}

export async function findItemByName(name) {
  const db = await openDB();
  const idx = tx(db, 'items').objectStore('items').index('name');
  return reqAsPromise(idx.get(name));
}

export async function upsertItem(item) {
  const db = await openDB();
  const store = tx(db, 'items', 'readwrite').objectStore('items');
  if (!item.id) {
    item.created_at = Date.now();
  }
  item.last_logged_at = Date.now();
  return reqAsPromise(store.put(item));
}

// ---------- stores ----------

export async function getAllStores() {
  const db = await openDB();
  return reqAsPromise(tx(db, 'stores').objectStore('stores').getAll());
}

export async function findStoreByName(name) {
  const db = await openDB();
  const idx = tx(db, 'stores').objectStore('stores').index('name');
  return reqAsPromise(idx.get(name));
}

export async function upsertStore(store) {
  const db = await openDB();
  const os = tx(db, 'stores', 'readwrite').objectStore('stores');
  return reqAsPromise(os.put(store));
}

// ---------- price_history ----------

export async function addPriceLog(log) {
  const db = await openDB();
  const t = tx(db, ['price_history', 'items'], 'readwrite');
  const ph = t.objectStore('price_history');
  const id = await reqAsPromise(ph.add(log));

  // bump item.last_logged_at so recency sort works
  const items = t.objectStore('items');
  const item = await reqAsPromise(items.get(log.item_id));
  if (item) {
    item.last_logged_at = Date.now();
    await reqAsPromise(items.put(item));
  }
  return id;
}

export async function getPriceHistoryForItem(itemId) {
  const db = await openDB();
  const idx = tx(db, 'price_history').objectStore('price_history').index('item_id');
  const rows = await reqAsPromise(idx.getAll(IDBKeyRange.only(itemId)));
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export async function getLastPriceForItem(itemId) {
  const rows = await getPriceHistoryForItem(itemId);
  return rows.length ? rows[rows.length - 1] : null;
}

export async function updatePriceLog(log) {
  const db = await openDB();
  const store = tx(db, 'price_history', 'readwrite').objectStore('price_history');
  return reqAsPromise(store.put(log));
}

export async function deletePriceLog(id) {
  const db = await openDB();
  const store = tx(db, 'price_history', 'readwrite').objectStore('price_history');
  return reqAsPromise(store.delete(id));
}

// Remove an item AND all of its price logs (no orphan logs).
export async function deleteItem(id) {
  const db = await openDB();
  const t = tx(db, ['items', 'price_history'], 'readwrite');
  const idx = t.objectStore('price_history').index('item_id');
  const logs = await reqAsPromise(idx.getAll(IDBKeyRange.only(id)));
  const reqs = [];
  for (const log of logs) {
    reqs.push(reqAsPromise(t.objectStore('price_history').delete(log.id)));
  }
  reqs.push(reqAsPromise(t.objectStore('items').delete(id)));
  await Promise.all(reqs);
}

// Remove a store. Existing logs keep their data but lose the store association
// (store_id becomes null) — better than cascading-deleting their history.
export async function deleteStore(id) {
  const db = await openDB();
  const t = tx(db, ['stores', 'price_history'], 'readwrite');
  const idx = t.objectStore('price_history').index('store_id');
  const logs = await reqAsPromise(idx.getAll(IDBKeyRange.only(id)));
  const reqs = [];
  for (const log of logs) {
    log.store_id = null;
    reqs.push(reqAsPromise(t.objectStore('price_history').put(log)));
  }
  reqs.push(reqAsPromise(t.objectStore('stores').delete(id)));
  await Promise.all(reqs);
}

export async function getAllPriceLogs() {
  const db = await openDB();
  return reqAsPromise(tx(db, 'price_history').objectStore('price_history').getAll());
}

// ---------- baskets (shopping list) ----------

// We use a single active basket with id=1. Future: support named baskets.
export async function getActiveBasket() {
  const db = await openDB();
  const result = await reqAsPromise(tx(db, 'baskets').objectStore('baskets').get(1));
  return result || { id: 1, items: [], updated_at: null };
}

export async function saveActiveBasket(basket) {
  basket.id = 1;
  basket.updated_at = Date.now();
  const db = await openDB();
  return reqAsPromise(tx(db, 'baskets', 'readwrite').objectStore('baskets').put(basket));
}

// ---------- maintenance ----------

export async function wipeAll() {
  const db = await openDB();
  const t = tx(db, ['items', 'price_history', 'stores', 'baskets'], 'readwrite');
  await Promise.all([
    reqAsPromise(t.objectStore('items').clear()),
    reqAsPromise(t.objectStore('price_history').clear()),
    reqAsPromise(t.objectStore('stores').clear()),
    reqAsPromise(t.objectStore('baskets').clear()),
  ]);
}

export async function importAll(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Import file is not valid JSON.');
  }
  const items         = Array.isArray(data.items)         ? data.items         : [];
  const stores        = Array.isArray(data.stores)        ? data.stores        : [];
  const price_history = Array.isArray(data.price_history) ? data.price_history : [];
  const baskets       = Array.isArray(data.baskets)       ? data.baskets       : [];

  if (items.length + stores.length + price_history.length === 0) {
    throw new Error('Import file has no items, stores, or price history.');
  }

  await wipeAll();

  const db = await openDB();
  const t = tx(db, ['items', 'stores', 'price_history', 'baskets'], 'readwrite');
  const reqs = [];
  for (const r of items)         reqs.push(reqAsPromise(t.objectStore('items').put(r)));
  for (const r of stores)        reqs.push(reqAsPromise(t.objectStore('stores').put(r)));
  for (const r of price_history) reqs.push(reqAsPromise(t.objectStore('price_history').put(r)));
  for (const r of baskets)       reqs.push(reqAsPromise(t.objectStore('baskets').put(r)));
  await Promise.all(reqs);

  return {
    items: items.length,
    stores: stores.length,
    logs: price_history.length,
    baskets: baskets.length,
  };
}

export async function exportAll() {
  const [items, price_history, stores, db] = await Promise.all([
    getAllItems(),
    getAllPriceLogs(),
    getAllStores(),
    openDB(),
  ]);
  const baskets = await reqAsPromise(tx(db, 'baskets').objectStore('baskets').getAll());
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    items,
    price_history,
    stores,
    baskets,
  };
}
