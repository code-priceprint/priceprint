// Unit conversion + unit-price engine.
// Goal: convert any (size, unit, price) into a canonical per-unit price so
// 32oz @ $8.99 and 2L @ $14.99 can be compared apples-to-apples.

// Three measurement families. We never convert between families.
//   weight  -> canonical gram (g)
//   volume  -> canonical milliliter (ml)
//   count   -> canonical 1 unit
export const FAMILIES = {
  // weight
  g:  { family: 'weight', toCanonical: 1 },
  kg: { family: 'weight', toCanonical: 1000 },
  oz: { family: 'weight', toCanonical: 28.3495 },
  lb: { family: 'weight', toCanonical: 453.592 },

  // volume
  ml: { family: 'volume', toCanonical: 1 },
  l:  { family: 'volume', toCanonical: 1000 },
  floz: { family: 'volume', toCanonical: 29.5735 },
  qt: { family: 'volume', toCanonical: 946.353 },
  gal: { family: 'volume', toCanonical: 3785.41 },

  // count
  ct: { family: 'count', toCanonical: 1 },
  dozen: { family: 'count', toCanonical: 12 },
};

// Pretty labels for UI.
export const UNIT_LABELS = {
  g: 'g', kg: 'kg', oz: 'oz', lb: 'lb',
  ml: 'ml', l: 'L', floz: 'fl oz', qt: 'qt', gal: 'gal',
  ct: 'count', dozen: 'dozen',
};

// User-friendly display unit for each family — what unit price gets shown in.
// We pick the smaller canonical so prices read naturally ($/oz, $/fl oz, $/ct).
export const DISPLAY_UNIT = {
  weight: 'oz',
  volume: 'floz',
  count: 'ct',
};

export function familyOf(unit) {
  const u = FAMILIES[unit];
  return u ? u.family : null;
}

// Convert (size, unit) -> canonical amount in g, ml, or count.
export function toCanonical(size, unit) {
  const u = FAMILIES[unit];
  if (!u) throw new Error(`Unknown unit: ${unit}`);
  return size * u.toCanonical;
}

// Convert canonical amount -> some display unit in the same family.
export function fromCanonical(canonical, displayUnit) {
  const u = FAMILIES[displayUnit];
  if (!u) throw new Error(`Unknown unit: ${displayUnit}`);
  return canonical / u.toCanonical;
}

// Compute unit price in the FAMILY'S display unit.
// Returns { unit_price, display_unit, family }.
// e.g. computeUnitPrice(2, 'l', 14.99) -> { unit_price: 0.221..., display_unit: 'floz', family: 'volume' }
export function computeUnitPrice(size, unit, price) {
  if (!size || size <= 0) return null;
  const family = familyOf(unit);
  if (!family) return null;
  const canonical = toCanonical(size, unit);
  const displayUnit = DISPLAY_UNIT[family];
  const displayAmount = fromCanonical(canonical, displayUnit);
  return {
    unit_price: price / displayAmount,
    display_unit: displayUnit,
    family,
  };
}

// Locale-aware number formatter for prices ≥ 1 (uses commas for thousands).
const PRICE_FMT_2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRICE_FMT_3 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const INT_FMT     = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

// Format $/unit for display. unitPrice is a number, displayUnit is one of UNIT_LABELS keys.
export function formatUnitPrice(unitPrice, displayUnit) {
  if (unitPrice == null || !isFinite(unitPrice)) return '—';
  const label = UNIT_LABELS[displayUnit] || displayUnit;
  // Most grocery unit prices land between $0.01 and $5; small unit prices need 3 decimals.
  const fmt = unitPrice >= 1 ? PRICE_FMT_2 : PRICE_FMT_3;
  return `$${fmt.format(unitPrice)}/${label}`;
}

// Format a dollar price with thousands separators (e.g., $1,234.56).
export function formatPrice(price) {
  if (price == null || !isFinite(price)) return '—';
  return `$${PRICE_FMT_2.format(Number(price))}`;
}

// Format a count / integer with thousands separators (e.g., 1,234 logs).
export function formatCount(n) {
  if (n == null || !isFinite(n)) return '—';
  return INT_FMT.format(Math.round(Number(n)));
}

// Deterministic color per store id — used for chart dots and legends so the
// user can map data points back to stores at a glance.
export const STORE_PALETTE = [
  '#0a5e44', '#d97706', '#0369a1', '#b91c1c',
  '#7c3aed', '#15803d', '#be185d', '#92400e',
  '#0891b2', '#4338ca', '#a16207', '#475569',
];
export function colorForStoreId(id) {
  const n = Math.abs(Number(id) || 0);
  return STORE_PALETTE[n % STORE_PALETTE.length];
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Day-of-week index 0-6 (Sunday=0). Accepts ISO datetime-local "YYYY-MM-DDTHH:MM"
// or date-only "YYYY-MM-DD". Returns null on invalid input.
export function dayOfWeek(dateStr) {
  if (!dateStr) return null;
  let d;
  if (dateStr.includes('T')) {
    d = new Date(dateStr);
  } else {
    const [y, m, day] = dateStr.split('-').map(Number);
    d = new Date(y, (m || 1) - 1, day || 1);
  }
  return isNaN(d.getTime()) ? null : d.getDay();
}

// "morning" (5-11), "afternoon" (12-16), "evening" (17-21), "night" (else).
export function timeOfDayBucket(dateStr) {
  if (!dateStr || !dateStr.includes('T')) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const h = d.getHours();
  if (h >= 5  && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

// Parse a free-text size string like "32 oz", "2 lb", "907g", "1 quart", "12ct".
// Returns { size, unit } or null. Used when the user paste-types instead of using the picker.
const SIZE_REGEX = /^\s*([\d.]+)\s*([a-zA-Z ]+?)\s*$/;
const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  floz: 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  ct: 'ct', count: 'ct', pack: 'ct', pcs: 'ct', pieces: 'ct',
  dozen: 'dozen',
};

// User-friendly date formatting. Accepts ISO datetime-local "YYYY-MM-DDTHH:MM"
// or date-only "YYYY-MM-DD" strings. Returns "Today at 2:30 PM", "Yesterday at
// 9:00 AM", "Monday at 6:15 PM", "May 15 at 10:30 AM", or "May 15, 2024" for
// older entries. Locale-aware via toLocaleDateString / toLocaleTimeString.
export function formatFriendlyDate(input) {
  if (!input) return '';
  const hasTime = typeof input === 'string' && input.includes('T');
  let d;
  if (typeof input === 'string') {
    if (hasTime) {
      d = new Date(input);
    } else {
      const [y, m, day] = input.split('-').map(Number);
      d = new Date(y, (m || 1) - 1, day || 1);
    }
  } else {
    d = new Date(input);
  }
  if (isNaN(d.getTime())) return String(input);

  const now = new Date();
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  let dayLabel;
  if (dayDiff === 0)         dayLabel = 'Today';
  else if (dayDiff === 1)    dayLabel = 'Yesterday';
  else if (dayDiff > 1 && dayDiff < 7) dayLabel = d.toLocaleDateString(undefined, { weekday: 'long' });
  else if (d.getFullYear() === now.getFullYear())
    dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  else
    dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  if (!hasTime) return dayLabel;
  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} at ${timeStr}`;
}

export function parseSize(input) {
  if (!input) return null;
  const m = SIZE_REGEX.exec(String(input));
  if (!m) return null;
  const size = parseFloat(m[1]);
  const rawUnit = m[2].toLowerCase().trim();
  const unit = UNIT_ALIASES[rawUnit] || UNIT_ALIASES[rawUnit.replace(/\s+/g, ' ')];
  if (!unit || !isFinite(size)) return null;
  return { size, unit };
}
