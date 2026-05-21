# PricePrint — Claude Code instructions

## What this project is

Private, offline-first grocery price tracker. The user logs prices as they shop; the app builds a personal price history per item, validates whether sales are real, and tracks personal grocery inflation. Everything lives in IndexedDB on the user's device. No backend, no account, no analytics.

## Stack & conventions

- Vanilla JS, ES modules, no framework, no bundler, no dependencies.
- Static files only — served by any web server. No build step.
- Mobile-first CSS. The primary use case is one-thumb operation in a grocery store aisle.
- Match the layout of sibling Artivicolab projects (adcalc, invoicemaster): `index.html` (landing), `app.html` (the app), `css/`, `js/`, `manifest.json`.

## Code style

- Prefer small modules, each doing one thing. Don't introduce a router or framework — tab switching is a 30-line function in `app.js`.
- Don't add comments that restate the code. Add a one-liner when the *why* is non-obvious (e.g. "single-writer transaction so item.last_logged_at stays consistent with the price log").
- Don't add error handling for impossible states. Trust the IndexedDB schema.
- Don't add backward-compat shims for features that don't exist yet.

## Data ownership rule (load-bearing)

Nothing the user types ever leaves the device. No fetch() to any external host except for static assets served from the same origin. If a future feature requires it (sync, OCR receipts, etc.), it must be optional, off by default, and prominently disclosed.

## Bottlenecks to watch

- Unit normalization across families — never convert grams to milliliters. The unit-price engine in `normalize.js` enforces this; keep it that way.
- Habit formation — the app is useless under 20 logged items. Onboarding (demo mode + first-insight notification at 30 items) is the highest-leverage thing to get right.
- Canvas chart performance with 500+ items × 3 years of data — render the most recent 12 months first, then extend backward async.

## What "done" means for any feature

A feature is shippable when a user can complete the core action on mobile Chrome and mobile Safari in under 10 seconds, with no network connection, with no account.

## Active ad campaign — TEMPORARY tracking tags (remove when it ends)

A Google Ads campaign is currently running. The following tags exist ONLY to support it and MUST be removed when the campaign ends:

- **Google Ads tag** `AW-17221241617` — the extra `gtag('config', 'AW-17221241617')` line in the `<head>` gtag block on every page.
- **Conversion event** `AW-17221241617/yyIzCIPOruQaEJGW3ZNA` — the page-view `gtag('event', 'conversion', …)` in `index.html`'s `<head>`.

The GA4 tag `G-2M720E2M37` and the consent banner are NOT part of the campaign — leave those in place.

**At the START of every session that touches this project, ASK the user: "Is the Google Ads campaign still running?"** If they say it has ended, remove the two items above (and update the privacy page's ads disclosure). If still running, leave them. Do not assume — always ask.
