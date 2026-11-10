// "Ask the data". The question becomes a whitelisted intent {type, fc, date, line, colour}; code
// answers it from the run. Rule-based parsing first; the local LLM (if enabled) only extracts the
// intent JSON when rules can't. Numbers in answers always come from the computed run.
import { parseDate } from '../ingest/values.js';
import { matchHeader, COST_KEYS } from '../ingest/headers.js';
import { pct, inr, shortDate } from '../engine/format.js';
import { DAY_CLASS_LABEL } from '../engine/rules.js';
import { chatJson } from './ollama.js';
import { CFG } from '../config.js';

const HELP = 'I can answer questions about this run\'s FCs, dates, colours and cost lines. Try: "Why was FC-PUNE red on Jul 8?", "Which FCs were red on Aug 8?", "Worst days for FC-BLR", "Manpower breaches", or "How is FC-DELHI doing?"';
const COLOURS = ['red', 'yellow', 'green', 'blue'];

function findFc(q, fcs) {
  const n = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  let best = null;
  for (const fc of fcs) {
    const variants = [fc, fc.replace(/^fc[-_ ]?/i, '')].map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter((v) => v.length >= 3);
    for (const v of variants) if (new RegExp(`\\b${v}\\b`).test(n) && (!best || v.length > best.len)) best = { fc, len: v.length };
  }
  return best?.fc || null;
}

function findDate(q, startDate, dates) {
  const m = q.match(/\b(\d{4}-\d{2}-\d{2})\b/) || q.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)
    || q.match(/\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+\d{4})?)\b/i)
    || q.match(/\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\b/i);
  if (m) return parseDate(m[1], startDate);
  const d = q.match(/\bday\s+(\d{1,4})\b/i);
  if (d) { const dt = new Date(`${startDate}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + Number(d[1]) - 1); return dt.toISOString().slice(0, 10); }
  if (/\b(today|latest|last day|yesterday)\b/i.test(q)) return dates.at(-1);
  return null;
}

function findLine(q) {
  for (const w of q.toLowerCase().split(/[^a-z&]+/).filter(Boolean)) { const k = matchHeader(w); if (k && COST_KEYS.includes(k)) return k; }
  for (const k of COST_KEYS) if (q.toLowerCase().includes(k.toLowerCase())) return k;
  const two = q.toLowerCase().match(/power\s*(?:and|&)\s*fuel|fc rent|equipment rentals?/);
  return two ? matchHeader(two[0]) : null;
}

export function parseQuestion(q, ctx) {
  const s = String(q || '').trim();
  if (s.length < 3 || !/[a-z]/i.test(s)) return { type: 'help' };
  const fc = findFc(s, ctx.fcs);
  const date = findDate(s, ctx.startDate, ctx.dates);
  const line = findLine(s);
  const colour = COLOURS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(s)) || null;
  const lower = s.toLowerCase();
  if (/\b(worst|lowest|bad(dest)?)\b/.test(lower)) return { type: 'rank', order: 'worst', fc };
  if (/\b(best|highest|top)\b/.test(lower) && !line) return { type: 'rank', order: 'best', fc };
  if (fc && date) return { type: 'explain', fc, date };
  if (date) return { type: 'day', date, colour };
  if (line) return { type: 'line', line, fc };
  if (colour) return { type: 'colour', colour: colour.toUpperCase(), fc };
  if (fc) return { type: 'fc', fc };
  if (/\b(summary|overall|status|how|all fcs|everything)\b/.test(lower)) return { type: 'summary' };
  return { type: 'unknown' };
}

export function answer(intent, run) {
  const { days, summary } = run.result;
  const fmtDay = (d) => `${d.fc} ${shortDate(d.date)}: ${d.colour}, CM2 ${pct(d.cm2Pct)}${d.anomalies.length ? `, ${d.anomalies.length} flag(s)` : ''}`;
  switch (intent.type) {
    case 'explain': {
      const d = days.find((x) => x.fc === intent.fc && x.date === intent.date);
      if (!d) return { text: `No data for ${intent.fc} on ${shortDate(intent.date)}. This run covers ${summary.firstDate} to ${summary.lastDate}.` };
      if (d.status !== 'OK') return { text: `${intent.fc} on ${shortDate(d.date)} has a data problem (${d.anomalies[0]?.status}); margins weren't computed.`, days: [d] };
      return { text: d.insight || `On ${shortDate(d.date)}, ${d.fc} was ${d.colour}: CM2 ${pct(d.cm2Pct)}, CM1 ${pct(d.cm1Pct)}, revenue ${inr(d.revenue)}. No line item breached its target.`, days: [d] };
    }
    case 'day': {
      let list = days.filter((x) => x.date === intent.date);
      if (intent.colour) list = list.filter((x) => x.colour === intent.colour.toUpperCase());
      if (!list.length) return { text: `No ${intent.colour ? `${intent.colour.toUpperCase()} ` : ''}FC-days on ${shortDate(intent.date)} in this run (${summary.firstDate} to ${summary.lastDate}).` };
      return { text: `${shortDate(intent.date)}: ${list.map((d) => fmtDay(d).replace(` ${shortDate(d.date)}:`, ':')).join(' · ')}`, days: list };
    }
    case 'rank': {
      const list = days.filter((x) => x.status === 'OK' && (!intent.fc || x.fc === intent.fc)).sort((a, b) => (intent.order === 'worst' ? a.cm2Pct - b.cm2Pct : b.cm2Pct - a.cm2Pct)).slice(0, 5);
      return { text: `${intent.order === 'worst' ? 'Lowest' : 'Highest'} CM2 days${intent.fc ? ` for ${intent.fc}` : ''}: ${list.map(fmtDay).join(' · ')}`, days: list };
    }
    case 'line': {
      const rows = days.flatMap((d) => d.anomalies.filter((a) => a.key === intent.line && (!intent.fc || a.fc === intent.fc)).map((a) => ({ ...a, d })));
      const label = run.result.rules.lines[intent.line].label;
      if (!rows.length) return { text: `${label} stayed within target on every day${intent.fc ? ` for ${intent.fc}` : ''} in this run.` };
      const byFc = {}; rows.forEach((r) => { byFc[r.fc] = (byFc[r.fc] || 0) + 1; });
      const worst = [...rows].sort((a, b) => (b.impactRs || 0) - (a.impactRs || 0)).slice(0, 3);
      return { text: `${label} was outside target on ${rows.length} FC-day(s): ${Object.entries(byFc).map(([f, n]) => `${f} ${n}`).join(', ')}. Largest: ${worst.map((r) => `${r.fc} ${shortDate(r.date)} ${pct(r.pct)} (${inr(r.impactRs)})`).join(' · ')}.`, days: worst.map((r) => r.d) };
    }
    case 'colour': {
      const list = days.filter((x) => x.colour === intent.colour && (!intent.fc || x.fc === intent.fc));
      if (!list.length) return { text: `No ${intent.colour} days${intent.fc ? ` for ${intent.fc}` : ''} in this run.` };
      return { text: `${list.length} ${intent.colour} day(s)${intent.fc ? ` for ${intent.fc}` : ''}: ${list.slice(0, 12).map((d) => `${d.fc} ${shortDate(d.date)} (${pct(d.cm2Pct)})`).join(', ')}${list.length > 12 ? ' …' : ''}`, days: list.slice(0, 12) };
    }
    case 'fc': {
      const f = summary.fcs.find((x) => x.fc === intent.fc);
      return { text: `${f.fc}: ${f.days} days, period CM2 ${pct(f.cm2Pct)}. Red ${f.colours.RED}, Yellow ${f.colours.YELLOW}, Green ${f.colours.GREEN}, Blue ${f.colours.BLUE}${f.colours.GREY ? `, no-data ${f.colours.GREY}` : ''}. Latest ${shortDate(f.latest.date)}: ${f.latest.colour} (${DAY_CLASS_LABEL[f.latest.dayClass]}).` };
    }
    case 'summary': {
      const t = summary.totals;
      return { text: `${summary.fcs.length} FC(s), ${summary.firstDate} to ${summary.lastDate}: Red ${t.colours.RED}, Yellow ${t.colours.YELLOW}, Green ${t.colours.GREEN}, Blue ${t.colours.BLUE} days; ${t.anomalies} anomaly rows. Latest: ${summary.fcs.map((f) => `${f.fc} ${f.latest.colour}`).join(', ')}.` };
    }
    default: return { text: HELP, help: true };
  }
}

export async function ask(question, run, { startDate } = {}) {
  const ctx = { fcs: run.result.summary.fcs.map((f) => f.fc), dates: [...new Set(run.result.days.map((d) => d.date))].sort(), startDate: startDate || run.meta.startDate || CFG.START_DATE };
  let intent = parseQuestion(question, ctx);
  let via = 'rules';
  if (intent.type === 'unknown' && CFG.AI_INSIGHTS) {
    const out = await chatJson({
      system: `Extract a query intent from a question about daily FC P&L data. FCs: ${ctx.fcs.join(', ')}. Dates ${ctx.dates[0]}..${ctx.dates.at(-1)}. Lines: ${COST_KEYS.join(', ')}. Return JSON {"type": one of explain|day|rank|line|colour|fc|summary|unknown, "fc": string|null, "date": "YYYY-MM-DD"|null, "line": string|null, "colour": RED|YELLOW|GREEN|BLUE|null, "order": worst|best|null}. If the question is not about this data, type=unknown.`,
      user: String(question).slice(0, 300), maxTokens: 120,
    });
    const ok = out && ['explain', 'day', 'rank', 'line', 'colour', 'fc', 'summary'].includes(out.type)
      && (!out.fc || ctx.fcs.includes(out.fc)) && (!out.line || COST_KEYS.includes(out.line)) && (!out.date || ctx.dates.includes(out.date))
      && (out.type !== 'explain' || (out.fc && out.date)) && (out.type !== 'fc' || out.fc) && (out.type !== 'line' || out.line) && (out.type !== 'day' || out.date) && (out.type !== 'colour' || out.colour);
    if (ok) { intent = { ...out, order: out.order || 'worst' }; via = 'llm-intent'; }
  }
  return { intent, via, ...answer(intent, run) };
}
