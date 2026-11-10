// Pure P&L arithmetic. CM1 = Revenue − Manpower − Packaging; CM2 = CM1 − all remaining costs.
import { COST_KEYS, CM1_KEYS } from '../ingest/headers.js';

// Round away float noise (7000/100000*100 = 7.000000000000001) so a value exactly at a limit is not a breach.
const clean = (x) => Math.round(x * 1e9) / 1e9;

export function computeDay(d) {
  if (d.status !== 'OK') return { ...d, pct: null, cm1: null, cm1Pct: null, cm2: null, cm2Pct: null, totalCost: null };
  const pct = {};
  for (const k of COST_KEYS) pct[k] = clean((d.costs[k] / d.revenue) * 100);
  const cm1 = d.revenue - CM1_KEYS.reduce((s, k) => s + d.costs[k], 0);
  const totalCost = COST_KEYS.reduce((s, k) => s + d.costs[k], 0);
  const cm2 = d.revenue - totalCost;
  return { ...d, pct, cm1, cm1Pct: clean((cm1 / d.revenue) * 100), cm2, cm2Pct: clean((cm2 / d.revenue) * 100), totalCost };
}
