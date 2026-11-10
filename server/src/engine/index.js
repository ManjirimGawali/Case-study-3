// Whole-dataset analysis: compute -> rules -> analyst, per FC in date order, using memory
// (days from earlier runs) so a one-day upload still gets a baseline and trends.
import { computeDay } from './compute.js';
import { evaluateDay } from './rules.js';
import { analyseDay, lineItemInsight, trends } from './analyst.js';
import { r2 } from './format.js';
import { COST_KEYS } from '../ingest/headers.js';

const COLOURS = ['RED', 'YELLOW', 'GREEN', 'BLUE', 'GREY'];
const CLASSES = ['CLEAN', 'LINE_ONLY', 'CM1_BREACH', 'CM2_BREACH', 'SUSPICIOUS_HIGH', 'DATA_ISSUE'];

export function analyseAll({ days, rules, playbook, memory = {}, overrides = [], onProgress }) {
  const byFc = new Map();
  for (const d of days) { if (!byFc.has(d.fc)) byFc.set(d.fc, []); byFc.get(d.fc).push(d); }
  const explained = overrides.filter((o) => o.type === 'explained' && o.note);
  const results = [];
  let done = 0;
  for (const [fc, list] of byFc) {
    const current = new Set(list.map((d) => d.date));
    const past = Object.entries(memory[fc] || {}).filter(([date]) => !current.has(date)).map(([date, m]) => ({ fc, date, ...m, fromMemory: true }));
    const timeline = [...past, ...list].sort((a, b) => a.date.localeCompare(b.date)).map(computeDay);
    const history = []; // OK computed days so far
    const recent = []; // evaluated days so far
    for (const d of timeline) {
      const ev = evaluateDay(d, rules);
      if (!d.fromMemory) {
        const facts = ev.anomalies.some((a) => a.kind !== 'data') ? analyseDay({ day: d, evaluation: ev, history, recent, rules, playbook, explained }) : null;
        const dayResult = {
          fc, date: d.date, day: d.day, status: d.status, source: d.source,
          revenue: d.revenue, costs: d.costs, pct: d.pct ? Object.fromEntries(COST_KEYS.map((k) => [k, r2(d.pct[k])])) : null,
          totalCost: d.totalCost, cm1: d.cm1, cm1Pct: r2(d.cm1Pct), cm2: d.cm2, cm2Pct: r2(d.cm2Pct),
          colour: ev.colour, dayClass: ev.dayClass, severity: ev.severity, anomalies: ev.anomalies,
          facts, insight: facts?.insight || null, insightSource: facts ? 'template' : null,
          last7: [...recent.slice(-6).map((r) => ({ date: r.date, colour: r.colour, cm2Pct: r.cm2Pct })), { date: d.date, colour: ev.colour, cm2Pct: r2(d.cm2Pct) }],
          trends: facts?.trends || (d.status === 'OK' ? trends(history, d, rules) : []),
        };
        for (const a of ev.anomalies) a.insight = lineItemInsight(a, dayResult);
        results.push(dayResult);
        onProgress?.(++done);
      }
      if (d.status === 'OK') history.push(d);
      recent.push({ date: d.date, colour: ev.colour, cm2Pct: r2(d.cm2Pct), anomalies: ev.anomalies });
    }
  }
  results.sort((a, b) => a.fc.localeCompare(b.fc) || a.date.localeCompare(b.date));
  return results;
}

export function summarise(dayResults) {
  const fcs = {};
  for (const d of dayResults) {
    const s = (fcs[d.fc] ||= { fc: d.fc, days: 0, colours: Object.fromEntries(COLOURS.map((c) => [c, 0])), classes: Object.fromEntries(CLASSES.map((c) => [c, 0])), anomalies: 0, firstDate: d.date, lastDate: d.date, revenue: 0, cm2: 0 });
    s.days++; s.colours[d.colour]++; s.classes[d.dayClass]++; s.anomalies += d.anomalies.length;
    if (d.date > s.lastDate) s.lastDate = d.date;
    if (d.status === 'OK') { s.revenue += d.revenue; s.cm2 += d.cm2; }
  }
  for (const s of Object.values(fcs)) {
    s.cm2Pct = s.revenue ? r2((s.cm2 / s.revenue) * 100) : null;
    const last = dayResults.find((d) => d.fc === s.fc && d.date === s.lastDate);
    s.latest = { date: last.date, colour: last.colour, cm2Pct: last.cm2Pct, dayClass: last.dayClass };
  }
  const totals = { days: dayResults.length, anomalies: dayResults.reduce((n, d) => n + d.anomalies.length, 0), colours: Object.fromEntries(COLOURS.map((c) => [c, dayResults.filter((d) => d.colour === c).length])), classes: Object.fromEntries(CLASSES.map((c) => [c, dayResults.filter((d) => d.dayClass === c).length])) };
  const dates = [...new Set(dayResults.map((d) => d.date))].sort();
  return { fcs: Object.values(fcs), totals, firstDate: dates[0], lastDate: dates.at(-1), dates: dates.length };
}
