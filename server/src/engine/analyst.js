// The analyst: turns a flagged day into facts (₹ impact ranking, revenue-vs-cost split against the
// FC's own recent baseline, memory of past days, trends) and a template insight + action.
import { COST_KEYS, CM1_KEYS } from '../ingest/headers.js';
import { lineTarget } from '../settings.js';
import { r1, inr, inrK, pct, shortDate } from './format.js';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// history: computed OK days for this FC strictly before `date`, ascending.
export function baselineFor(history, rules) {
  const win = history.slice(-rules.baseline.days);
  if (win.length < rules.baseline.minDays) return null;
  const b = { days: win.length, revenue: median(win.map((d) => d.revenue)), costs: {} };
  for (const k of COST_KEYS) b.costs[k] = median(win.map((d) => d.costs[k]));
  b.totalCost = COST_KEYS.reduce((s, k) => s + b.costs[k], 0);
  return b;
}

// Exact split: pct − basePct = costEffect + revenueEffect
//   costEffect    = (A − A0) / R        (the rupee amount moved)
//   revenueEffect = A0 / R − A0 / R0    (the amount was normal, revenue moved)
export function decompose(amount, revenue, base, k) {
  if (!base || !base.costs[k] || !base.revenue) return { cause: 'unknown' };
  const A0 = base.costs[k], R0 = base.revenue;
  const costEffectPp = ((amount - A0) / revenue) * 100;
  const revenueEffectPp = (A0 / revenue - A0 / R0) * 100;
  const cause = Math.abs(costEffectPp) >= Math.abs(revenueEffectPp) ? 'cost' : 'revenue';
  return { cause, costEffectPp: r1(costEffectPp), revenueEffectPp: r1(revenueEffectPp), normalAmount: Math.round(A0), normalRevenue: Math.round(R0), amountChangePct: r1((amount / A0 - 1) * 100), revenueChangePct: r1((revenue / R0 - 1) * 100) };
}

function playbookAction(playbook, k, dir, cause) {
  const p = playbook[k]?.[dir];
  if (!p) return null;
  return p[cause] || p.any || p.unknown || p.cost || null;
}

export function trends(history, today, rules) {
  const out = [];
  const seq = [...history.slice(-3), today];
  if (seq.length < 4) return out;
  for (const k of COST_KEYS) {
    const v = seq.map((d) => d.pct[k]);
    const t = lineTarget(rules, today.fc, k);
    const rising = v.every((x, i) => i === 0 || x > v[i - 1]);
    if (rising && v[3] - v[0] >= 1 && v[3] >= (t.min + t.max) / 2) {
      out.push({ key: k, line: t.label, kind: 'rising', values: v.map(r1), text: `${t.label} rising 4 days in a row (${v.map((x) => r1(x).toFixed(1)).join(' → ')}%; max ${t.max}%)${v[3] <= t.max ? ', heading for a breach' : ''}` });
    }
  }
  const c = seq.map((d) => d.cm2Pct);
  if (c.every((x, i) => i === 0 || x < c[i - 1]) && c[0] - c[3] >= 3) {
    out.push({ key: 'cm2', line: 'CM2', kind: 'falling', values: c.map(r1), text: `CM2 falling 4 days in a row (${c.map((x) => r1(x).toFixed(1)).join(' → ')}%)` });
  }
  return out;
}

// day: computed + evaluated day; history: earlier OK days of same FC (any source); recent: earlier evaluated days (for memory facts)
export function analyseDay({ day, evaluation, history, recent, rules, playbook, explained }) {
  const base = baselineFor(history, rules);
  const lineAnoms = evaluation.anomalies.filter((a) => a.kind === 'line');
  const breaches = lineAnoms.map((a) => {
    const dir = a.status === 'ABOVE_MAX' ? 'above' : 'below';
    const dec = decompose(day.costs[a.key], day.revenue, base, a.key);
    const prev = explained?.find((o) => o.fc === day.fc && o.line === a.key && o.date < day.date);
    return { key: a.key, line: a.line, pct: a.pct, min: a.min, max: a.max, dir, excessRs: a.impactRs, amount: day.costs[a.key], ...dec, action: playbookAction(playbook, a.key, dir, dir === 'below' ? 'any' : dec.cause), lastExplained: prev ? { date: prev.date, note: prev.note } : null };
  }).sort((a, b) => b.excessRs - a.excessRs);

  const last7 = [...recent.slice(-6), { date: day.date, colour: evaluation.colour, anomalies: evaluation.anomalies }];
  const redDaysLast7 = last7.filter((d) => d.colour === 'RED').length;
  const lineCounts = {};
  for (const d of last7) for (const a of d.anomalies || []) if (a.kind === 'line') lineCounts[a.key] = (lineCounts[a.key] || 0) + 1;
  const repeatLines = Object.entries(lineCounts).filter(([, n]) => n >= 3).map(([k, n]) => ({ key: k, line: lineTarget(rules, day.fc, k).label, days: n }));

  let pressure = [];
  if (evaluation.dayClass === 'CM2_BREACH' || evaluation.dayClass === 'CM1_BREACH') {
    // Lines above the middle of their band (even if within band), by rupee pressure.
    pressure = COST_KEYS.map((k) => { const t = lineTarget(rules, day.fc, k); const mid = (t.min + t.max) / 2; return { key: k, line: t.label, pct: r1(day.pct[k]), overMidRs: Math.round(((day.pct[k] - mid) / 100) * day.revenue) }; })
      .filter((x) => x.overMidRs > 0).sort((a, b) => b.overMidRs - a.overMidRs).slice(0, 3);
  }

  let lowLines = [];
  if (evaluation.dayClass === 'SUSPICIOUS_HIGH') {
    lowLines = COST_KEYS.map((k) => {
      const t = lineTarget(rules, day.fc, k);
      const normal = base?.costs[k] ?? null;
      return { key: k, line: t.label, pct: r1(day.pct[k]), amount: day.costs[k], normal: normal === null ? null : Math.round(normal), min: t.min, belowMin: day.pct[k] < t.min, zero: day.costs[k] === 0, dropPct: normal ? r1((day.costs[k] / normal - 1) * 100) : null };
    }).filter((x) => x.zero || x.belowMin || (x.dropPct !== null && x.dropPct <= -20)).sort((a, b) => (a.zero === b.zero ? (a.dropPct ?? 0) - (b.dropPct ?? 0) : a.zero ? -1 : 1));
  }

  const revenueEffect = base ? { revenueChangePct: r1((day.revenue / base.revenue - 1) * 100), costChangePct: r1((day.totalCost / base.totalCost - 1) * 100) } : null;

  const facts = {
    date: day.date, fc: day.fc, colour: evaluation.colour, dayClass: evaluation.dayClass,
    revenue: day.revenue, cm1Pct: r1(day.cm1Pct), cm2Pct: r1(day.cm2Pct), cm1Target: [rules.cm1.min, rules.cm1.max], cm2Target: [rules.cm2.min, rules.cm2.max],
    cm1Flag: evaluation.anomalies.find((a) => a.key === 'cm1')?.status || null, cm2Flag: evaluation.anomalies.find((a) => a.key === 'cm2')?.status || null,
    breaches, pressure, lowLines, zeroLines: day.zeroLines || [],
    baseline: base ? { days: base.days, revenue: Math.round(base.revenue), totalCost: Math.round(base.totalCost) } : null,
    revenueEffect, memory: { redDaysLast7, repeatLines }, trends: trends(history, day, rules),
  };
  facts.action = dayAction(facts, playbook);
  facts.insight = templateInsight(facts, rules);
  return facts;
}

function dayAction(f, playbook) {
  const D = playbook._day;
  if (f.dayClass === 'SUSPICIOUS_HIGH') {
    const z = f.lowLines.find((l) => l.zero);
    return z ? `${D.BLUE}. ${z.line} is ₹0. Confirm the ${z.line.toLowerCase()} entry` : D.BLUE;
  }
  if (f.dayClass === 'CM2_BREACH') {
    const re = f.revenueEffect;
    if (re && re.revenueChangePct <= -10 && Math.abs(re.costChangePct) <= 5) return D.RED_REVENUE;
    const costLines = f.breaches.filter((b) => b.dir === 'above' && b.cause !== 'revenue').slice(0, 2).map((b) => b.line.toLowerCase());
    return costLines.length ? `Cost audit: ${f.breaches.find((b) => b.cause !== 'revenue' && b.dir === 'above').action.replace(/^./, (c) => c.toLowerCase())}${costLines.length > 1 ? `; also check ${costLines[1]}` : ''}` : D.RED;
  }
  if (f.dayClass === 'CM1_BREACH') return f.breaches.find((b) => CM1_KEYS.includes(b.key))?.action || D.CM1;
  if (f.dayClass === 'LINE_ONLY') return f.breaches[0]?.action || D.LINE_ONLY;
  return null;
}

function describeBreach(b) {
  const lim = b.dir === 'above' ? `max ${b.max}%` : `min ${b.min}%`;
  const imp = b.dir === 'above' ? `+${inr(b.excessRs)}` : `${inr(b.excessRs)} under`;
  let why = '';
  if (b.cause === 'revenue') why = Math.abs(b.amountChangePct) < 5 ? '; amount normal, low revenue' : `; mainly low revenue, amount ${b.amountChangePct > 0 ? '+' : ''}${b.amountChangePct}% vs normal`;
  else if (b.cause === 'cost' && b.amountChangePct !== undefined) why = `; ${inrK(b.amount)} vs normal ${inrK(b.normalAmount)}`;
  const limit = b.dir === 'above' ? b.max : b.min;
  const shown = Math.abs(Math.round(b.pct * 10) / 10 - limit) < 0.05 ? `${b.pct.toFixed(2)}%` : pct(b.pct); // 13.04% not "13.0% (max 13%)"
  return `${b.line} ${shown} (${lim}, ${imp}${why})`;
}

export function templateInsight(f, rules) {
  const when = `On ${shortDate(f.date)}`;
  const parts = [];
  const above = f.breaches.filter((b) => b.dir === 'above');
  const below = f.breaches.filter((b) => b.dir === 'below');
  if (f.dayClass === 'SUSPICIOUS_HIGH') {
    parts.push(`${when}, CM2 = ${pct(f.cm2Pct)}, suspiciously high (BLUE, above ${rules.colour.blue}%).`);
    if (f.lowLines.length) parts.push(`Possibly under-reported: ${f.lowLines.slice(0, 3).map((l) => (l.zero ? `${l.line} booked as ₹0${l.normal ? ` (normal ${inrK(l.normal)})` : ''}` : `${l.line} ${pct(l.pct)}${l.dropPct !== null ? ` (${l.dropPct}% vs normal)` : ''}`)).join(', ')}.`);
    else parts.push('No single cost line stands out as low; check revenue for a one-off or double booking.');
  } else if (f.dayClass === 'CM2_BREACH') {
    parts.push(`${when}, CM2 = ${pct(f.cm2Pct)}, ${r1(f.cm2Target[0] - f.cm2Pct).toFixed(1)} pp below the ${f.cm2Target[0]}% target (RED).`);
    if (f.cm1Flag) parts.push(`CM1 = ${pct(f.cm1Pct)} (target ${f.cm1Target[0]}–${f.cm1Target[1]}%).`);
    if (above.length) parts.push(`Above max, by impact: ${above.slice(0, 4).map(describeBreach).join(', ')}${above.length > 4 ? ` and ${above.length - 4} more` : ''}.`);
    else if (f.pressure.length) parts.push(`No single line broke its max; biggest pressures: ${f.pressure.map((p) => `${p.line} ${pct(p.pct)}`).join(', ')}.`);
    if (f.revenueEffect && f.revenueEffect.revenueChangePct <= -10) parts.push(`Revenue was ${Math.abs(f.revenueEffect.revenueChangePct)}% below this FC's recent normal while total cost moved ${f.revenueEffect.costChangePct >= 0 ? '+' : ''}${f.revenueEffect.costChangePct}%.`);
  } else if (f.dayClass === 'CM1_BREACH') {
    parts.push(`${when}, CM1 = ${pct(f.cm1Pct)}, outside the ${f.cm1Target[0]}–${f.cm1Target[1]}% target by more than 3 pp; CM2 = ${pct(f.cm2Pct)}.`);
    if (above.length) parts.push(`Above max: ${above.slice(0, 3).map(describeBreach).join(', ')}.`);
  } else if (f.dayClass === 'LINE_ONLY') {
    parts.push(`${when}, margins held (CM2 = ${pct(f.cm2Pct)}, ${f.colour}) but ${f.breaches.length === 1 ? 'one line is' : `${f.breaches.length} lines are`} outside target:`);
    parts.push(`${f.breaches.slice(0, 3).map(describeBreach).join(', ')}${f.breaches.length > 3 ? ` and ${f.breaches.length - 3} more` : ''}.`);
  } else return null;
  if (below.length && f.dayClass !== 'LINE_ONLY' && f.dayClass !== 'SUSPICIOUS_HIGH') parts.push(`Below min: ${below.map(describeBreach).join(', ')}.`);
  if (f.memory.redDaysLast7 >= 2 && f.colour === 'RED') parts.push(`${f.memory.redDaysLast7} red days in the last 7.`);
  const lx = f.breaches.find((b) => b.lastExplained);
  if (lx) parts.push(`(${lx.line} was last explained on ${shortDate(lx.lastExplained.date)}: "${lx.lastExplained.note}".)`);
  if (f.action) parts.push(`Recommend: ${f.action}.`);
  return parts.join(' ').replace(/\.\./g, '.');
}

export function lineItemInsight(a, d) {
  if (!a) return '';
  if (a.kind === 'data') {
    return d?.status === 'NO_REVENUE'
      ? 'Data issue: Revenue is missing or zero. Margins could not be computed.'
      : 'Data issue: One or more required cost lines are missing or non-numeric.';
  }

  if (a.kind === 'line') {
    const breach = d?.facts?.breaches?.find((b) => b.key === a.key);
    const lim = a.status === 'ABOVE_MAX' ? `max ${a.max}%` : `min ${a.min}%`;
    const dev = a.deviationPp !== null && a.deviationPp !== undefined
      ? `${Math.abs(a.deviationPp)} pp ${a.status === 'ABOVE_MAX' ? 'above max' : 'below min'}`
      : '';
    const imp = a.impactRs ? `${a.status === 'ABOVE_MAX' ? '+' : ''}${inr(a.impactRs)} impact` : '';
    const stats = [lim, dev, imp].filter(Boolean).join(', ');

    let cause = '';
    if (breach) {
      if (breach.cause === 'revenue') {
        cause = Math.abs(breach.amountChangePct) < 5
          ? ' Incurred cost was normal; breach was driven by lower sales volume.'
          : ` Low revenue effect; amount was ${breach.amountChangePct > 0 ? '+' : ''}${breach.amountChangePct}% vs normal.`;
      } else if (breach.cause === 'cost' && breach.amountChangePct !== undefined) {
        cause = ` Incurred cost moved ${breach.amountChangePct > 0 ? '+' : ''}${breach.amountChangePct}% vs baseline (${inrK(breach.amount)} vs normal ${inrK(breach.normalAmount)}).`;
      }
    }
    const act = breach?.action ? ` Recommend: ${breach.action}.` : '';
    const expl = a.override?.note ? ` (Override: ${a.override.note})` : breach?.lastExplained ? ` (Last explained on ${shortDate(breach.lastExplained.date)}: "${breach.lastExplained.note}")` : '';
    return `${a.line} was ${pct(a.pct)} (${stats}).${cause}${act}${expl}`;
  }

  if (a.key === 'cm2') {
    const isBelow = a.status === 'BELOW_TARGET';
    const dev = a.deviationPp !== null && a.deviationPp !== undefined
      ? `${Math.abs(a.deviationPp)} pp ${isBelow ? 'below' : 'above'} ${isBelow ? a.min : a.max}% target`
      : '';
    const imp = a.impactRs ? `${isBelow ? 'shortfall' : 'excess'} of ${inr(a.impactRs)}` : '';
    const stats = [dev, imp].filter(Boolean).join(', ');

    if (isBelow) {
      const topCost = d?.facts?.breaches?.filter((b) => b.dir === 'above').slice(0, 2).map((b) => `${b.line} (+${inr(b.excessRs)})`).join(', ');
      const drivers = topCost ? ` Top cost contributors: ${topCost}.` : '';
      const revNote = d?.facts?.revenueEffect && d.facts.revenueEffect.revenueChangePct <= -10
        ? ` Revenue was ${Math.abs(d.facts.revenueEffect.revenueChangePct)}% below recent normal.`
        : '';
      const act = d?.facts?.action ? ` Recommend: ${d.facts.action}.` : ' Recommend: Cost audit on top contributors.';
      return `CM2 dropped to ${pct(a.pct)} (${stats}).${drivers}${revNote}${act}`;
    } else {
      const lowCost = d?.facts?.lowLines?.slice(0, 2).map((l) => (l.zero ? `${l.line} booked as ₹0` : `${l.line} ${pct(l.pct)}`)).join(', ');
      const lowText = lowCost ? ` Unusually low lines: ${lowCost}.` : '';
      return `CM2 was ${pct(a.pct)} (${stats}). Suspiciously high margin; verify if all vendor bills or accruals were booked.${lowText} Recommend: Confirm all daily expense vouchers.`;
    }
  }

  if (a.key === 'cm1') {
    const isBelow = a.status === 'BELOW_TARGET';
    const dev = a.deviationPp !== null && a.deviationPp !== undefined
      ? `${Math.abs(a.deviationPp)} pp ${isBelow ? 'below' : 'above'} target (${a.target})`
      : '';
    const imp = a.impactRs ? `${inr(a.impactRs)} impact` : '';
    const stats = [dev, imp].filter(Boolean).join(', ');

    if (isBelow) {
      const cm1Breaches = d?.facts?.breaches?.filter((b) => CM1_KEYS.includes(b.key)).map((b) => `${b.line} was ${pct(b.pct)} (${b.dir === 'above' ? 'max' : 'min'} ${b.dir === 'above' ? b.max : b.min}%)`).join(', ');
      const drivers = cm1Breaches ? ` Direct cost drivers: ${cm1Breaches}.` : '';
      return `CM1 was ${pct(a.pct)} (${stats}).${drivers} Recommend: Review direct labour shift scheduling and packaging consumption against order volume.`;
    } else {
      return `CM1 was ${pct(a.pct)} (${stats}). Direct costs lower than expected; check for delayed labour and packaging entries.`;
    }
  }

  return d?.insight || '';
}
