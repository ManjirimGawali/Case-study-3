// Flags, colour, day class and severity. All thresholds come from settings (config/rules.json).
import { COST_KEYS } from '../ingest/headers.js';
import { lineTarget } from '../settings.js';
import { r2 } from './format.js';

export function colourFor(cm2Pct, c) {
  if (cm2Pct === null || cm2Pct === undefined || !Number.isFinite(cm2Pct)) return 'GREY';
  if (cm2Pct < c.red) return 'RED';
  if (cm2Pct < c.yellowLow) return 'YELLOW';
  if (cm2Pct <= c.yellowHigh) return 'GREEN';
  if (cm2Pct < c.blue) return 'YELLOW';
  return 'BLUE';
}

const SEV_RANK = { HIGH: 3, MED: 2, LOW: 1 };

export function evaluateDay(d, rules) {
  const anomalies = [];
  if (d.status !== 'OK') {
    anomalies.push({ date: d.date, fc: d.fc, key: 'data', line: 'Data', pct: null, min: null, max: null, target: '—', status: d.status, deviationPp: null, impactRs: null, severity: 'MED', kind: 'data' });
    return { colour: 'GREY', dayClass: 'DATA_ISSUE', anomalies, severity: 'MED' };
  }
  for (const k of COST_KEYS) {
    const t = lineTarget(rules, d.fc, k);
    const p = r2(d.pct[k]);
    if (p > t.max || p < t.min) {
      const above = p > t.max;
      const dev = above ? p - t.max : p - t.min;
      const impactRs = Math.abs(dev) / 100 * d.revenue;
      if (Math.round(impactRs) === 0 && Math.abs(r2(dev)) === 0) continue;
      const sev = impactRs >= rules.severity.medRupees || Math.abs(dev) >= rules.severity.medPp ? 'MED' : 'LOW';
      anomalies.push({ date: d.date, fc: d.fc, key: k, line: t.label, pct: p, min: t.min, max: t.max, target: `${t.min}–${t.max}%`, status: above ? 'ABOVE_MAX' : 'BELOW_MIN', deviationPp: r2(dev), impactRs: Math.round(impactRs), severity: sev, kind: 'line' });
    }
  }
  const cmFlags = {};
  for (const [k, label, rawVal] of [['cm1', 'CM1', d.cm1Pct], ['cm2', 'CM2', d.cm2Pct]]) {
    const val = r2(rawVal);
    const t = rules[k];
    const lo = t.min - t.tolerancePp, hi = t.max + t.tolerancePp;
    if (val < lo || val > hi) {
      const below = val < lo;
      const dev = below ? val - t.min : val - t.max;
      const impactRs = Math.round(Math.abs(dev) / 100 * d.revenue);
      if (impactRs === 0 && Math.abs(r2(dev)) === 0) continue;
      cmFlags[k] = below ? 'BELOW_TARGET' : 'ABOVE_TARGET';
      anomalies.push({ date: d.date, fc: d.fc, key: k, line: label, pct: val, min: t.min, max: t.max, target: `${t.min}–${t.max}% (±${t.tolerancePp} pp)`, status: cmFlags[k], deviationPp: r2(dev), impactRs, severity: k === 'cm2' ? 'HIGH' : 'MED', kind: 'margin' });
    }
  }
  const colour = colourFor(d.cm2Pct, rules.colour);
  const lineFlags = anomalies.filter((a) => a.kind === 'line').length;
  let dayClass = 'CLEAN';
  if (colour === 'BLUE' || cmFlags.cm2 === 'ABOVE_TARGET') dayClass = 'SUSPICIOUS_HIGH';
  else if (cmFlags.cm2 === 'BELOW_TARGET') dayClass = 'CM2_BREACH';
  else if (cmFlags.cm1) dayClass = 'CM1_BREACH';
  else if (lineFlags) dayClass = 'LINE_ONLY';
  if (colour === 'BLUE' && !anomalies.some((a) => a.key === 'cm2')) {
    // Blue threshold lower than tolerance edge (custom settings): still raise it.
    anomalies.push({ date: d.date, fc: d.fc, key: 'cm2', line: 'CM2', pct: r2(d.cm2Pct), min: rules.cm2.min, max: rules.cm2.max, target: `${rules.cm2.min}–${rules.cm2.max}%`, status: 'ABOVE_TARGET', deviationPp: r2(d.cm2Pct - rules.cm2.max), impactRs: null, severity: 'HIGH', kind: 'margin' });
  }
  const severity = anomalies.length ? anomalies.map((a) => a.severity).sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0] : null;
  return { colour, dayClass, anomalies, severity };
}

export const DAY_CLASS_LABEL = {
  CLEAN: 'Clean', LINE_ONLY: 'Line-item-only breach', CM1_BREACH: 'CM1 breach', CM2_BREACH: 'CM2 breach', SUSPICIOUS_HIGH: 'Suspiciously high CM2', DATA_ISSUE: 'Data issue',
};
