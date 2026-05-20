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
- No service worker yet — adding one when we ship.

## Analytics

Google Analytics 4 web stream:

- **Production URL:** https://priceprint.artivicolab.com
- **Measurement ID:** `G-2M720E2M37` (the `gtag` config in every page's `<head>`)
- **Stream ID:** `14916969677` (only needed for server-side events via the GA Measurement Protocol)

If you ever need to swap the property, grep `G-2M720E2M37` to find every page that needs updating.
