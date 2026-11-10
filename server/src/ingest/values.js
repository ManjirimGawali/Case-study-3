// Tolerant value parsing: Indian number formats, accounting negatives, many date shapes.
const MISSING = /^(|-|–|—|na|n\/a|nil|null|none|nan|#n\/a|#value!|#ref!)$/i;

export function parseNumber(v) {
  if (v === null || v === undefined) return { value: null, missing: true };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { value: null, invalid: true };
  if (typeof v === 'object' && v.result !== undefined) return parseNumber(v.result); // exceljs formula cell
  if (typeof v === 'object' && v.richText) return parseNumber(v.richText.map((t) => t.text).join(''));
  let s = String(v).trim();
  if (MISSING.test(s)) return { value: null, missing: true };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/₹|rs\.?|inr|\s|,/gi, '');
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return { value: null, invalid: true, raw: String(v) };
  const n = Number(s);
  return { value: neg ? -n : n };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};
const year4 = (y) => (y < 100 ? 2000 + y : y);

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Returns ISO yyyy-mm-dd or null. Day-first for slashed dates (India).
export function parseDate(v, startDate) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.result !== undefined) return parseDate(v.result, startDate);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel serial date
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ t].*)?$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return iso(year4(+m[3]), +m[2], +m[1]);
  const defaultYear = Number(String(startDate || '2026').slice(0, 4));
  if ((m = s.match(/^(\d{1,2})[- ]([a-z]{3,9})\.?(?:[- ](\d{2,4}))?$/)) && MONTHS[m[2].slice(0, 3)]) {
    return iso(m[3] ? year4(+m[3]) : defaultYear, MONTHS[m[2].slice(0, 3)], +m[1]);
  }
  if ((m = s.match(/^([a-z]{3,9})\.? (\d{1,2})(?: (\d{2,4}))?$/)) && MONTHS[m[1].slice(0, 3)]) {
    return iso(m[3] ? year4(+m[3]) : defaultYear, MONTHS[m[1].slice(0, 3)], +m[2]);
  }
  return null;
}

export function parseDay(v) {
  const n = parseNumber(v);
  if (n.value === null || !Number.isInteger(n.value) || n.value < 1 || n.value > 3660) return null;
  return n.value;
}
