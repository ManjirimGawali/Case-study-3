// Writer agent: asks a local LLM to rephrase the template insight for a manager.
// Guard: every number in the LLM text must appear in the facts/template (±0.1), every breached
// line must still be named, and the length must stay short. Otherwise the template is kept.
import { chatJson } from './ollama.js';

const SYSTEM = `You write one short alert for a warehouse (FC) manager in India.
Use ONLY the facts given. Never invent or recompute numbers; copy numbers exactly as written in DRAFT.
Keep every cost line named in DRAFT. Max 3 sentences, plain words, end with the recommended action.
Return JSON: {"insight": "..."}`;

const NUM = /-?\d[\d,]*(?:\.\d+)?/g;
export function numbersIn(text) {
  return (String(text).match(NUM) || []).map((s) => Number(s.replace(/,/g, ''))).filter(Number.isFinite);
}

function allowedNumbers(facts, draft) {
  const set = new Set();
  const add = (x) => { if (typeof x === 'number' && Number.isFinite(x)) { set.add(x); set.add(Math.round(x)); set.add(Math.round(x * 10) / 10); } };
  const walk = (o) => { if (o === null || o === undefined) return; if (typeof o === 'number') add(o); else if (typeof o === 'string') numbersIn(o).forEach(add); else if (typeof o === 'object') Object.values(o).forEach(walk); };
  walk(facts); numbersIn(draft).forEach(add);
  const [y, m, d] = facts.date.split('-').map(Number); [y, m, d, 1, 2, 3, 4, 5, 6, 7].forEach(add);
  return [...set];
}

export function guard(text, facts, draft) {
  if (typeof text !== 'string' || text.trim().length < 20) return { ok: false, reason: 'empty' };
  if (text.length > Math.max(420, draft.length * 1.4)) return { ok: false, reason: 'too long' };
  const allowed = allowedNumbers(facts, draft);
  for (const n of numbersIn(text)) if (!allowed.some((a) => Math.abs(a - n) <= 0.1)) return { ok: false, reason: `number ${n} not in facts` };
  for (const b of facts.breaches.slice(0, 3)) {
    const first = b.line.split(/[ &]/)[0].toLowerCase();
    if (!new RegExp(`\\b${first}\\b`, 'i').test(text)) return { ok: false, reason: `dropped ${b.line}` };
  }
  return { ok: true };
}

export async function writeInsight(facts, draft, llm = chatJson) {
  const slim = { date: facts.date, fc: facts.fc, colour: facts.colour, dayClass: facts.dayClass, cm1Pct: facts.cm1Pct, cm2Pct: facts.cm2Pct, breaches: facts.breaches.slice(0, 4).map((b) => ({ line: b.line, pct: b.pct, limit: b.dir === 'above' ? b.max : b.min, dir: b.dir, rupees: b.excessRs, cause: b.cause })), lowLines: facts.lowLines.slice(0, 3), action: facts.action };
  const out = await llm({ system: SYSTEM, user: `FACTS: ${JSON.stringify(slim)}\nDRAFT: ${draft}`, schema: { type: 'object', properties: { insight: { type: 'string' } }, required: ['insight'] } });
  const text = out?.insight?.trim();
  if (!text) return { text: draft, source: 'template', note: 'LLM gave no answer' };
  const g = guard(text, facts, draft);
  return g.ok ? { text, source: 'llm' } : { text: draft, source: 'template', note: `LLM text rejected: ${g.reason}` };
}
