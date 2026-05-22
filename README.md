# PricePrint

Your personal, private grocery price memory. Runs entirely in the browser via IndexedDB. No account, no server, no cloud.

## What's in this scaffold

This first pass implements the **foundation**: schema, unit-price engine, and the item entry screen. Other features are stubbed as placeholder tabs and will be built next.

### Built

- **IndexedDB schema** ([js/db.js](js/db.js)) — four object stores (`items`, `price_history`, `stores`, `baskets`) with indexes on name, category, date, unit_price, and a composite `(item_id, date)` index for fast per-item history queries.
- **Unit conversion + unit-price engine** ([js/normalize.js](js/normalize.js)) — weight (g/kg/oz/lb), volume (ml/L/fl oz/qt/gal), count (ct/dozen). Converts any (size, unit, price) into a canonical $/oz, $/fl oz, or $/count.
- **Item entry screen** ([js/entry.js](js/entry.js)) — fuzzy autosuggest against existing catalog, pre-fill of size+store from last log so repeat entries take seconds, live unit-price preview, "last time you logged this" hint.
- **App shell** ([js/app.js](js/app.js), [app.html](app.html)) — tab nav, six screen stubs, footer stats.
- **Landing page** ([index.html](index.html)).

### Stubbed (next passes)

- Price history view with Canvas trend chart
- Sale validator
- Shopping list with last-price intelligence
- Store comparison
- Personal inflation tracker
- Export (CSV / JSON) and import

## Run locally

It's static — open a server in the folder:

```
cd /Users/gradikayamba/PricePrint
python3 -m http.server 8000
```

Then visit http://localhost:8000/app.html

(Cannot use `file://` because the JS uses ES modules.)

## Smoke test

1. Open `/app.html` — the Log price screen mounts.
2. Type "Olive oil", store "Costco", size 2, unit L, price 14.99 — Save.
3. Type "Olive oil" again — should autosuggest. Click it. Size/store/unit pre-fill from last log.
4. Footer shows "1 items · 1 price observations · all on this device".
5. Refresh — data persists.

## Architecture notes

- ES modules (`<script type="module">`). No bundler, no framework, no dependencies.
- Single-writer IndexedDB pattern: `addPriceLog` writes the price + bumps the item's `last_logged_at` in one transaction.
- Display unit per family is fixed for now (oz / fl oz / ct). When the schema grows we'll let users override per item via `items.preferred_unit`.
- Service worker (`sw.js`) is network-first: online visitors always get the freshly deployed file; cache is an offline fallback only. Bump `CACHE_VERSION` to evict the old cache.

## Import / export format

Export produces a single JSON object; import expects the same shape. The fastest way to see a valid file is to click **Export JSON** and open it. Full schema:

```jsonc
{
  "version": 1,
  "exported_at": "2026-05-21T18:00:00.000Z",   // ISO string (ignored on import)
  "items": [
    {
      "id": 1,                 // number, primary key (referenced by price_history.item_id)
      "name": "milk",          // string
      "category": "dairy",     // string
      "preferred_unit": "gal", // string unit code
      "barcode": null,         // string | null
      "notes": "",             // string
      "last_logged_at": 0      // number, ms epoch (optional)
    }
  ],
  "stores": [
    {
      "id": 1,                 // number, primary key (referenced by price_history.store_id)
      "name": "Costco",        // string
      "chain": "Costco",       // string (optional)
      "location": "warehouse"  // string (optional)
    }
  ],
  "price_history": [
    {
      "id": 1,                 // number, primary key
      "item_id": 1,            // number → items.id
      "store_id": 1,           // number → stores.id (may be null)
      "date": "2026-05-20T09:00", // string "YYYY-MM-DDTHH:mm"
      "size": 1,               // number, package size in `unit`
      "unit": "gal",           // string: g|kg|oz|lb | ml|l|floz|qt|gal | ct|dozen
      "price": 3.99,           // number, total price paid
      "unit_price": 0.0312,    // number, price per display unit ($/oz, $/floz, $/ct)
      "is_sale": false,        // boolean
      "notes": ""              // string
    }
  ],
  "baskets": []                // optional; the active shopping list
}
```

Minimum required for a successful import: `items`, `stores`, and `price_history` arrays (at least one non-empty). **Import replaces all existing data on the device.**

## Analytics

Google Analytics 4 web stream:

- **Production URL:** https://priceprint.artivicolab.com
- **Measurement ID:** `G-2M720E2M37` (the `gtag` config in every page's `<head>`)
- **Stream ID:** `14916969677` (only needed for server-side events via the GA Measurement Protocol)

If you ever need to swap the property, grep `G-2M720E2M37` to find every page that needs updating.
