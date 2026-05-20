// Test data seeder. Call window.seedPriceprint() from the browser console.
// Wipes existing data, then populates a realistic catalog (~100 items) with
// varied scenarios so every screen can be exercised end-to-end:
//   - log counts vary 1..25+ per item (sparse → frequent buys)
//   - 12 months of history
//   - real sales, fake sales, shrinkflation cases
//   - mix of weight / volume / count units
//   - edge cases: very long names, very small/large prices, sparse history

import {
  openDB, wipeAll, upsertItem, upsertStore, addPriceLog, saveActiveBasket,
} from './db.js';
import { computeUnitPrice } from './normalize.js';

const STORES = [
  { name: 'Costco',        chain: 'Costco',         location: 'warehouse' },
  { name: "Trader Joe's",  chain: "Trader Joe's",   location: 'neighborhood' },
  { name: 'Kroger',        chain: 'Kroger',         location: 'supermarket' },
  { name: 'Whole Foods',   chain: 'Amazon',         location: 'premium' },
  { name: 'Aldi',          chain: 'Aldi',           location: 'discount' },
  { name: 'Safeway',       chain: 'Albertsons',     location: 'supermarket' },
  { name: 'Walmart',       chain: 'Walmart',        location: 'big-box' },
  { name: 'Target',        chain: 'Target',         location: 'big-box' },
  { name: 'Sprouts',       chain: 'Sprouts',        location: 'specialty' },
  { name: 'H Mart',        chain: 'H Mart',         location: 'specialty' },
];

// Each entry: { name, category, unit, size, base, frequency, sales }
//   frequency: 'low' (~3 logs) | 'mid' (~8) | 'high' (~15) | 'edge' (special case)
//   sales: number of sale entries to inject (0, 1, or 2 — mix of real/fake)
const ITEMS = [
  // PRODUCE
  { name: 'bananas',          category: 'produce',   unit: 'lb',   size: 1,    base: 0.62, frequency: 'high', sales: 1 },
  { name: 'apples',           category: 'produce',   unit: 'lb',   size: 1,    base: 1.79, frequency: 'high', sales: 2 },
  { name: 'oranges',          category: 'produce',   unit: 'lb',   size: 1,    base: 1.49, frequency: 'mid',  sales: 1 },
  { name: 'lemons',           category: 'produce',   unit: 'ct',   size: 1,    base: 0.79, frequency: 'mid',  sales: 0 },
  { name: 'limes',            category: 'produce',   unit: 'ct',   size: 1,    base: 0.50, frequency: 'low',  sales: 0 },
  { name: 'strawberries',     category: 'produce',   unit: 'oz',   size: 16,   base: 4.99, frequency: 'mid',  sales: 2 },
  { name: 'blueberries',      category: 'produce',   unit: 'oz',   size: 6,    base: 3.99, frequency: 'mid',  sales: 1 },
  { name: 'grapes',           category: 'produce',   unit: 'lb',   size: 2,    base: 5.99, frequency: 'low',  sales: 1 },
  { name: 'avocado',          category: 'produce',   unit: 'ct',   size: 1,    base: 1.25, frequency: 'high', sales: 1 },
  { name: 'tomatoes',         category: 'produce',   unit: 'lb',   size: 1,    base: 2.29, frequency: 'mid',  sales: 0 },
  { name: 'lettuce',          category: 'produce',   unit: 'ct',   size: 1,    base: 2.49, frequency: 'mid',  sales: 0 },
  { name: 'spinach',          category: 'produce',   unit: 'oz',   size: 5,    base: 3.49, frequency: 'mid',  sales: 1 },
  { name: 'onions',           category: 'produce',   unit: 'lb',   size: 3,    base: 2.99, frequency: 'high', sales: 0 },
  { name: 'potatoes',         category: 'produce',   unit: 'lb',   size: 5,    base: 4.49, frequency: 'high', sales: 1 },
  { name: 'carrots',          category: 'produce',   unit: 'lb',   size: 2,    base: 2.29, frequency: 'mid',  sales: 0 },
  { name: 'broccoli',         category: 'produce',   unit: 'lb',   size: 1,    base: 2.99, frequency: 'mid',  sales: 1 },
  { name: 'bell peppers',     category: 'produce',   unit: 'ct',   size: 1,    base: 1.49, frequency: 'mid',  sales: 0 },
  { name: 'cucumber',         category: 'produce',   unit: 'ct',   size: 1,    base: 1.29, frequency: 'mid',  sales: 0 },
  { name: 'mushrooms',        category: 'produce',   unit: 'oz',   size: 8,    base: 2.99, frequency: 'low',  sales: 0 },
  { name: 'garlic',           category: 'produce',   unit: 'ct',   size: 1,    base: 0.99, frequency: 'mid',  sales: 0 },

  // DAIRY
  { name: 'milk',             category: 'dairy',     unit: 'gal',  size: 1,    base: 3.99, frequency: 'high', sales: 1 },
  { name: 'eggs',             category: 'dairy',     unit: 'dozen',size: 1,    base: 4.49, frequency: 'high', sales: 2 },
  { name: 'butter',           category: 'dairy',     unit: 'oz',   size: 16,   base: 5.99, frequency: 'mid',  sales: 1 },
  { name: 'cheddar cheese',   category: 'dairy',     unit: 'oz',   size: 8,    base: 4.29, frequency: 'mid',  sales: 1 },
  { name: 'mozzarella',       category: 'dairy',     unit: 'oz',   size: 16,   base: 5.49, frequency: 'mid',  sales: 1 },
  { name: 'greek yogurt',     category: 'dairy',     unit: 'oz',   size: 32,   base: 5.99, frequency: 'high', sales: 1 },
  { name: 'cream cheese',     category: 'dairy',     unit: 'oz',   size: 8,    base: 2.99, frequency: 'low',  sales: 0 },
  { name: 'sour cream',       category: 'dairy',     unit: 'oz',   size: 16,   base: 2.79, frequency: 'low',  sales: 0 },
  { name: 'half and half',    category: 'dairy',     unit: 'floz', size: 32,   base: 4.49, frequency: 'mid',  sales: 0 },
  { name: 'heavy cream',      category: 'dairy',     unit: 'floz', size: 16,   base: 4.99, frequency: 'low',  sales: 0 },

  // MEAT
  { name: 'chicken breast',   category: 'meat',      unit: 'lb',   size: 1,    base: 4.99, frequency: 'high', sales: 2 },
  { name: 'ground beef',      category: 'meat',      unit: 'lb',   size: 1,    base: 6.49, frequency: 'high', sales: 2 },
  { name: 'salmon',           category: 'meat',      unit: 'lb',   size: 1,    base: 12.99,frequency: 'mid',  sales: 1 },
  { name: 'pork chops',       category: 'meat',      unit: 'lb',   size: 1,    base: 5.49, frequency: 'mid',  sales: 1 },
  { name: 'bacon',            category: 'meat',      unit: 'oz',   size: 12,   base: 6.99, frequency: 'mid',  sales: 1 },
  { name: 'turkey',           category: 'meat',      unit: 'lb',   size: 1,    base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'sausage',          category: 'meat',      unit: 'oz',   size: 16,   base: 5.99, frequency: 'mid',  sales: 1 },
  { name: 'deli ham',         category: 'meat',      unit: 'oz',   size: 8,    base: 4.99, frequency: 'mid',  sales: 0 },
  { name: 'deli turkey',      category: 'meat',      unit: 'oz',   size: 8,    base: 5.49, frequency: 'mid',  sales: 0 },
  { name: 'shrimp',           category: 'meat',      unit: 'lb',   size: 1,    base: 10.99,frequency: 'low',  sales: 1 },

  // PANTRY
  { name: 'olive oil',        category: 'pantry',    unit: 'floz', size: 25.4, base: 11.99,frequency: 'mid',  sales: 2 },
  { name: 'vegetable oil',    category: 'pantry',    unit: 'floz', size: 48,   base: 5.99, frequency: 'low',  sales: 0 },
  { name: 'peanut butter',    category: 'pantry',    unit: 'oz',   size: 16,   base: 4.79, frequency: 'mid',  sales: 1 },
  { name: 'pasta',            category: 'pantry',    unit: 'oz',   size: 16,   base: 1.49, frequency: 'high', sales: 1 },
  { name: 'rice',             category: 'pantry',    unit: 'lb',   size: 5,    base: 8.49, frequency: 'mid',  sales: 1 },
  { name: 'bread',            category: 'pantry',    unit: 'oz',   size: 20,   base: 3.49, frequency: 'high', sales: 1 },
  { name: 'flour',            category: 'pantry',    unit: 'lb',   size: 5,    base: 3.49, frequency: 'low',  sales: 0 },
  { name: 'sugar',            category: 'pantry',    unit: 'lb',   size: 4,    base: 2.99, frequency: 'low',  sales: 0 },
  { name: 'salt',             category: 'pantry',    unit: 'oz',   size: 26,   base: 1.49, frequency: 'low',  sales: 0 },
  { name: 'black pepper',     category: 'pantry',    unit: 'oz',   size: 4,    base: 4.99, frequency: 'low',  sales: 0 },
  { name: 'cereal',           category: 'pantry',    unit: 'oz',   size: 18,   base: 4.99, frequency: 'mid',  sales: 1 },
  { name: 'oats',             category: 'pantry',    unit: 'oz',   size: 42,   base: 5.49, frequency: 'mid',  sales: 0 },
  { name: 'granola',          category: 'pantry',    unit: 'oz',   size: 12,   base: 5.99, frequency: 'low',  sales: 1 },
  { name: 'canned tomatoes',  category: 'pantry',    unit: 'oz',   size: 28,   base: 2.49, frequency: 'mid',  sales: 0 },
  { name: 'canned beans',     category: 'pantry',    unit: 'oz',   size: 15,   base: 1.29, frequency: 'mid',  sales: 0 },
  { name: 'chicken broth',    category: 'pantry',    unit: 'floz', size: 32,   base: 3.49, frequency: 'mid',  sales: 0 },
  { name: 'soy sauce',        category: 'pantry',    unit: 'floz', size: 10,   base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'ketchup',          category: 'pantry',    unit: 'floz', size: 20,   base: 3.49, frequency: 'low',  sales: 0 },
  { name: 'mustard',          category: 'pantry',    unit: 'floz', size: 12,   base: 2.99, frequency: 'low',  sales: 0 },
  { name: 'mayonnaise',       category: 'pantry',    unit: 'floz', size: 30,   base: 5.49, frequency: 'low',  sales: 0 },

  // BEVERAGE
  { name: 'orange juice',     category: 'beverage',  unit: 'floz', size: 52,   base: 4.99, frequency: 'mid',  sales: 1 },
  { name: 'apple juice',      category: 'beverage',  unit: 'floz', size: 64,   base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'coffee',           category: 'beverage',  unit: 'oz',   size: 12,   base: 9.99, frequency: 'mid',  sales: 2 },
  { name: 'tea',              category: 'beverage',  unit: 'ct',   size: 100,  base: 5.99, frequency: 'low',  sales: 0 },
  { name: 'soda',             category: 'beverage',  unit: 'floz', size: 144,  base: 6.99, frequency: 'mid',  sales: 1 },
  { name: 'sparkling water',  category: 'beverage',  unit: 'floz', size: 96,   base: 4.49, frequency: 'mid',  sales: 0 },
  { name: 'almond milk',      category: 'beverage',  unit: 'floz', size: 64,   base: 3.99, frequency: 'mid',  sales: 0 },
  { name: 'oat milk',         category: 'beverage',  unit: 'floz', size: 32,   base: 4.49, frequency: 'mid',  sales: 1 },
  { name: 'beer',             category: 'beverage',  unit: 'floz', size: 72,   base: 9.99, frequency: 'low',  sales: 1 },
  { name: 'wine',             category: 'beverage',  unit: 'ml',   size: 750,  base: 14.99,frequency: 'low',  sales: 1 },

  // FROZEN
  { name: 'frozen pizza',     category: 'frozen',    unit: 'oz',   size: 22,   base: 6.99, frequency: 'mid',  sales: 1 },
  { name: 'frozen vegetables',category: 'frozen',    unit: 'oz',   size: 16,   base: 2.49, frequency: 'mid',  sales: 0 },
  { name: 'ice cream',        category: 'frozen',    unit: 'floz', size: 48,   base: 5.99, frequency: 'mid',  sales: 1 },
  { name: 'frozen berries',   category: 'frozen',    unit: 'oz',   size: 32,   base: 7.99, frequency: 'low',  sales: 0 },
  { name: 'frozen chicken',   category: 'frozen',    unit: 'lb',   size: 3,    base: 8.99, frequency: 'low',  sales: 0 },
  { name: 'frozen fish',      category: 'frozen',    unit: 'lb',   size: 1,    base: 9.99, frequency: 'low',  sales: 0 },
  { name: 'frozen waffles',   category: 'frozen',    unit: 'ct',   size: 10,   base: 3.49, frequency: 'low',  sales: 0 },
  { name: 'frozen burritos',  category: 'frozen',    unit: 'ct',   size: 8,    base: 4.99, frequency: 'low',  sales: 1 },

  // HOUSEHOLD
  { name: 'paper towels',     category: 'household', unit: 'ct',   size: 6,    base: 12.99,frequency: 'mid',  sales: 1 },
  { name: 'toilet paper',     category: 'household', unit: 'ct',   size: 12,   base: 14.99,frequency: 'mid',  sales: 1 },
  { name: 'dish soap',        category: 'household', unit: 'floz', size: 18,   base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'laundry detergent',category: 'household', unit: 'floz', size: 100,  base: 15.99,frequency: 'low',  sales: 1 },
  { name: 'hand soap',        category: 'household', unit: 'floz', size: 12,   base: 3.49, frequency: 'low',  sales: 0 },
  { name: 'trash bags',       category: 'household', unit: 'ct',   size: 40,   base: 9.99, frequency: 'low',  sales: 1 },
  { name: 'sponges',          category: 'household', unit: 'ct',   size: 6,    base: 4.99, frequency: 'low',  sales: 0 },
  { name: 'aluminum foil',    category: 'household', unit: 'ct',   size: 1,    base: 5.99, frequency: 'low',  sales: 0 },
  { name: 'plastic wrap',     category: 'household', unit: 'ct',   size: 1,    base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'ziploc bags',      category: 'household', unit: 'ct',   size: 50,   base: 6.99, frequency: 'low',  sales: 0 },

  // PERSONAL CARE
  { name: 'shampoo',          category: 'personal care', unit: 'floz', size: 25, base: 7.99, frequency: 'low', sales: 1 },
  { name: 'conditioner',      category: 'personal care', unit: 'floz', size: 25, base: 7.99, frequency: 'low', sales: 1 },
  { name: 'toothpaste',       category: 'personal care', unit: 'oz',   size: 6,  base: 4.99, frequency: 'low', sales: 0 },
  { name: 'toothbrush',       category: 'personal care', unit: 'ct',   size: 1,  base: 4.99, frequency: 'low', sales: 0 },
  { name: 'deodorant',        category: 'personal care', unit: 'oz',   size: 3,  base: 5.99, frequency: 'low', sales: 0 },
  { name: 'body wash',        category: 'personal care', unit: 'floz', size: 18, base: 6.99, frequency: 'low', sales: 1 },
  { name: 'razors',           category: 'personal care', unit: 'ct',   size: 4,  base: 12.99,frequency: 'low', sales: 1 },
  { name: 'lotion',           category: 'personal care', unit: 'floz', size: 16, base: 7.99, frequency: 'low', sales: 0 },

  // SNACKS
  { name: 'chips',            category: 'other',     unit: 'oz',   size: 10,   base: 4.49, frequency: 'mid',  sales: 1 },
  { name: 'crackers',         category: 'other',     unit: 'oz',   size: 14,   base: 3.99, frequency: 'mid',  sales: 0 },
  { name: 'cookies',          category: 'other',     unit: 'oz',   size: 14,   base: 4.49, frequency: 'mid',  sales: 1 },
  { name: 'nuts',             category: 'other',     unit: 'oz',   size: 16,   base: 9.99, frequency: 'low',  sales: 1 },
  { name: 'popcorn',          category: 'other',     unit: 'oz',   size: 10,   base: 3.99, frequency: 'low',  sales: 0 },
  { name: 'candy bar',        category: 'other',     unit: 'ct',   size: 1,    base: 1.49, frequency: 'low',  sales: 0 },
  { name: 'granola bars',     category: 'other',     unit: 'ct',   size: 12,   base: 5.99, frequency: 'mid',  sales: 1 },

  // EDGE CASES — explicitly mark frequency='edge' so generator knows
  { name: 'caviar',           category: 'other',     unit: 'oz',   size: 2,    base: 89.99,frequency: 'edge', sales: 0 }, // expensive, sparse
  { name: 'matcha tea powder',category: 'beverage',  unit: 'oz',   size: 1,    base: 24.99,frequency: 'low',  sales: 0 }, // specialty
  { name: 'a',                category: 'other',     unit: 'ct',   size: 1,    base: 1.00, frequency: 'edge', sales: 0 }, // 1-char name
  { name: 'organic free-range pasture-raised heritage breed chicken thighs',
                              category: 'meat',      unit: 'lb',   size: 1.5,  base: 18.99,frequency: 'edge', sales: 1 }, // very long name
  { name: 'bubble gum',       category: 'other',     unit: 'ct',   size: 1,    base: 0.10, frequency: 'low',  sales: 0 }, // tiny price
];

const SHOPPING_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = x => String(x).padStart(2, '0');
  // Randomize hour + minute so each log gets a realistic shopping timestamp
  // instead of every "today" log landing on the same hour.
  const hour = SHOPPING_HOURS[Math.floor(Math.random() * SHOPPING_HOURS.length)];
  const minute = Math.floor(Math.random() * 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

function rand(min, max) { return min + Math.random() * (max - min); }
function round(n, places = 2) { const p = 10 ** places; return Math.round(n * p) / p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function logCountFor(frequency) {
  // Number of price logs per item based on frequency tier
  switch (frequency) {
    case 'high':  return 15 + Math.floor(Math.random() * 10);   // 15–24
    case 'mid':   return 6 + Math.floor(Math.random() * 5);     // 6–10
    case 'low':   return 2 + Math.floor(Math.random() * 3);     // 2–4
    case 'edge':  return 1 + Math.floor(Math.random() * 2);     // 1–2 (sparse)
    default:      return 4;
  }
}

function generateLogs(itemDef, storeIds) {
  const logs = [];
  const numLogs = logCountFor(itemDef.frequency);
  if (numLogs === 0) return logs;

  // Sale slots — make sure we don't double-mark on the same index
  const saleSlots = new Set();
  for (let s = 0; s < itemDef.sales && s < numLogs; s++) {
    // Distribute sales across the span
    saleSlots.add(Math.floor(((s + 1) / (itemDef.sales + 1)) * numLogs));
  }
  // Roughly half of sales are "fake" (above avg), half "real"
  const realSaleSlot = [...saleSlots][0];
  const fakeSaleSlot = [...saleSlots][1];

  // Shrinkflation flag — apply on the very last log for a few items
  const shrinkItems = new Set(['peanut butter', 'cereal', 'paper towels', 'ice cream']);
  const shrinkOnLast = shrinkItems.has(itemDef.name);

  for (let i = 0; i < numLogs; i++) {
    // Spread logs across 12 months
    const daysBack = Math.round((numLogs - 1 - i) * (365 / Math.max(1, numLogs - 1)));
    const date = daysAgo(daysBack);

    const inflation = 1 + (i / Math.max(1, numLogs)) * 0.08; // ~8% drift across the year
    const noise = rand(0.93, 1.07);
    let price = itemDef.base * inflation * noise;
    let size = itemDef.size;
    let isSale = false;

    if (i === realSaleSlot) {
      price = itemDef.base * 0.76;
      isSale = true;
    } else if (i === fakeSaleSlot) {
      price = itemDef.base * 1.08 * inflation;
      isSale = true;
    }

    if (shrinkOnLast && i === numLogs - 1) {
      size = itemDef.size * 0.82; // ~18% smaller, same-ish price
    }

    price = round(price);
    const calc = computeUnitPrice(size, itemDef.unit, price);
    logs.push({
      store_id: pick(storeIds),
      date,
      size,
      unit: itemDef.unit,
      price,
      unit_price: calc ? calc.unit_price : 0,
      is_sale: isSale,
      notes: '',
    });
  }
  return logs;
}

export async function seedTestData() {
  console.log('[seed] wiping existing data...');
  await wipeAll();

  console.log(`[seed] adding ${STORES.length} stores...`);
  const storeIds = [];
  for (const s of STORES) {
    storeIds.push(await upsertStore(s));
  }

  console.log(`[seed] adding ${ITEMS.length} items + price history...`);
  let totalLogs = 0;
  const itemIdByName = new Map();
  for (const def of ITEMS) {
    const itemId = await upsertItem({
      name: def.name,
      category: def.category,
      preferred_unit: def.unit,
      barcode: null,
      notes: '',
    });
    itemIdByName.set(def.name, itemId);
    const logs = generateLogs(def, storeIds);
    for (const log of logs) {
      await addPriceLog({ ...log, item_id: itemId });
      totalLogs++;
    }
  }

  // Seed a representative shopping list so the landing-page demo isn't empty.
  // Mix: one text-only item with no price yet, three catalog items already
  // crossed off — exercises both the "log it first" and the "log it →" paths.
  const basketSeed = [
    { name: 'water',   qty: 4, purchased: false, textOnly: true },
    { name: 'milk',    qty: 2, purchased: true  },
    { name: 'bananas', qty: 2, purchased: true  },
    { name: 'bread',   qty: 6, purchased: true  },
  ];
  const basketItems = basketSeed.map(b => {
    if (b.textOnly) return { name: b.name, qty: b.qty, purchased: b.purchased };
    const itemId = itemIdByName.get(b.name);
    return itemId ? { itemId, qty: b.qty, purchased: b.purchased } : null;
  }).filter(Boolean);
  if (basketItems.length) {
    await saveActiveBasket({ id: 1, items: basketItems });
  }

  console.log(`[seed] done. ${ITEMS.length} items, ${STORES.length} stores, ${totalLogs} price logs.`);
  console.log('[seed] reload the page to see them.');
  return { items: ITEMS.length, stores: STORES.length, logs: totalLogs };
}

openDB();
