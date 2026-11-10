const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
export const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
export const inr = (x) => (x === null || x === undefined ? '—' : `${x < 0 ? '−' : ''}₹${Math.round(Math.abs(x)).toLocaleString('en-IN')}`);
export const inrK = (x) => {
  if (x === null || x === undefined) return '—';
  const a = Math.abs(x);
  const s = a >= 100000 ? `${(a / 100000).toFixed(2)}L` : a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${Math.round(a)}`;
  return `${x < 0 ? '−' : ''}₹${s}`;
};
export const pct = (x) => (x === null || x === undefined ? '—' : `${r1(x).toFixed(1)}%`);
export const pp = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(r1(x)).toFixed(1)} pp`;
export const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
export const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const range = (min, max) => `${min}–${max}%`;
