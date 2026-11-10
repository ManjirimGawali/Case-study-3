// Header recognition by synonym. Matching is on a normalised form, longest synonym wins
// (so "FC Rent" maps to rent, not to the FC column).
export const COST_KEYS = ['manpower', 'packaging', 'powerFuel', 'rent', 'equipment', 'overheads'];
export const CM1_KEYS = ['manpower', 'packaging'];

export const SYNONYMS = {
  fc: ['fc', 'fc name', 'fc code', 'fc id', 'centre', 'center', 'fulfilment centre', 'fulfillment center', 'fulfilment center', 'fulfillment centre', 'warehouse', 'site', 'location', 'branch', 'hub'],
  date: ['date', 'day date', 'txn date', 'business date', 'report date', 'dt'],
  day: ['day', 'day no', 'day number', 'day #', 'sr no', 's no'],
  revenue: ['revenue', 'sales', 'net revenue', 'net sales', 'income', 'total revenue', 'gross revenue', 'billing'],
  manpower: ['manpower', 'manpower cost', 'man power', 'labour', 'labor', 'labour cost', 'labor cost', 'salaries', 'salary', 'wages', 'staff cost', 'manpower costs'],
  packaging: ['packaging', 'packaging cost', 'packing', 'packing material', 'packaging material', 'consumables', 'packaging costs'],
  powerFuel: ['power and fuel', 'power fuel', 'power & fuel', 'power', 'fuel', 'electricity', 'power and fuel cost', 'utilities', 'diesel', 'dg'],
  rent: ['fc rent', 'rent', 'warehouse rent', 'rental', 'lease', 'rent cost', 'space rent'],
  equipment: ['equipment rentals', 'equipment rental', 'equipment', 'mhe rental', 'mhe', 'equipment hire', 'equipment cost'],
  overheads: ['overheads', 'overhead', 'other costs', 'other cost', 'misc', 'miscellaneous', 'others', 'g&a', 'admin', 'overhead cost'],
  cm1: ['cm1', 'cm 1', 'cm1 %', 'contribution margin 1'],
  cm2: ['cm2', 'cm 2', 'cm2 %', 'contribution margin 2'],
};

export const LABELS = { fc: 'FC', date: 'Date', day: 'Day', revenue: 'Revenue', manpower: 'Manpower', packaging: 'Packaging', powerFuel: 'Power & Fuel', rent: 'FC Rent', equipment: 'Equipment Rentals', overheads: 'Overheads', cm1: 'CM1', cm2: 'CM2' };

export function normHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/₹|\brs\.?|\binr\b|%|\bin\b|\bamt\b|\bamount\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TABLE = Object.entries(SYNONYMS).flatMap(([k, list]) => list.map((s) => [normHeader(s), k])).sort((a, b) => b[0].length - a[0].length);

export function matchHeader(cell) {
  const n = normHeader(cell);
  if (!n || n.length > 40) return null;
  for (const [syn, k] of TABLE) if (n === syn) return k;
  for (const [syn, k] of TABLE) if (syn.length >= 3 && (n.startsWith(syn + ' ') || n.endsWith(' ' + syn))) return k;
  return null;
}

// Find the header row in the first `scan` rows: needs revenue + at least 3 cost columns.
export function findHeader(rows, scan = 25) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, scan); r++) {
    const map = {};
    (rows[r] || []).forEach((cell, c) => {
      const k = matchHeader(cell);
      if (k && map[k] === undefined) map[k] = c;
    });
    const costs = COST_KEYS.filter((k) => map[k] !== undefined).length;
    if (map.revenue !== undefined && costs >= 3 && (!best || costs > best.costs)) best = { row: r, map, costs };
  }
  return best;
}
