// Landing-page demo. Mounts the real app screens into the proof frames using
// a SEPARATE IndexedDB (`priceprint-demo`) so visitors see live, interactive
// demos without ever touching real user data.
//
// Module-load order matters: db.js exposes a `let DB_NAME` that's read on the
// first openDB() call. seed.js calls openDB() at module init, so we must
// setDBName() BEFORE any module that touches the DB loads. Static imports run
// before top-level code in ES modules, so everything except db.js is loaded
// dynamically below.
import { setDBName } from './db.js';

setDBName('priceprint-demo');

(async () => {
  const [
    { openDB, getAllItems },
    { seedTestData },
    { mountValidator },
    { mountCompare },
    { mountList },
    { mountInflation },
    { mountHistory },
    { mountShopping },
    { mountEntry },
  ] = await Promise.all([
    import('./db.js'),
    import('./seed.js'),
    import('./validator.js'),
    import('./compare.js'),
    import('./list.js'),
    import('./inflation.js'),
    import('./history.js'),
    import('./shopping.js'),
    import('./entry.js'),
  ]);

  await openDB();
  const existing = await getAllItems();
  if (existing.length === 0) {
    await seedTestData();
  }

  const slots = [
    { id: 'demo-validator', mount: mountValidator },
    { id: 'demo-compare',   mount: mountCompare   },
    { id: 'demo-list',      mount: mountList      },
    { id: 'demo-inflation', mount: mountInflation },
    { id: 'demo-history',   mount: mountHistory   },
    { id: 'demo-shopping',  mount: mountShopping  },
    { id: 'demo-entry',     mount: mountEntry     },
  ];

  for (const { id, mount } of slots) {
    const el = document.getElementById(id);
    if (!el) continue;
    try {
      await mount(el);
    } catch (err) {
      console.warn('[priceprint-demo] failed to mount', id, err);
      el.innerHTML = `<div class="proof-demo-fallback">demo unavailable</div>`;
    }
  }
})().catch(err => {
  console.warn('[priceprint-demo] bootstrap failed', err);
});
