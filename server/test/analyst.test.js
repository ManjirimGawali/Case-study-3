import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose, baselineFor } from '../src/engine/analyst.js';
import { guard, writeInsight, numbersIn } from '../src/ai/writer.js';
import { analyseAll } from '../src/engine/index.js';
import { defaults } from '../src/settings.js';
import { parseQuestion } from '../src/ai/ask.js';

const { rules, playbook } = defaults();

test('revenue-vs-cost decomposition is exact and picks the right cause', () => {
  const base = { revenue: 100000, costs: { rent: 15000 } };
  const rev = decompose(15000, 80000, base, 'rent'); // same rupees, revenue down
  assert.equal(rev.cause, 'revenue'); assert.equal(rev.costEffectPp, 0); assert.equal(rev.revenueEffectPp, 3.8);
  const cost = decompose(20000, 100000, base, 'rent');
  assert.equal(cost.cause, 'cost'); assert.equal(cost.costEffectPp, 5);
  assert.equal(decompose(1, 1, null, 'rent').cause, 'unknown');
});

test('baseline needs minDays of history', () => {
  const h = (n) => Array.from({ length: n }, () => ({ revenue: 100, costs: { manpower: 27, packaging: 5, powerFuel: 11, rent: 15, equipment: 6, overheads: 10 } }));
  assert.equal(baselineFor(h(4), rules), null);
  assert.equal(baselineFor(h(5), rules).costs.rent, 15);
});

function series(n, mutate = {}) {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10);
    const costs = { manpower: 27000, packaging: 5000, powerFuel: 11000, rent: 15000, equipment: 6000, overheads: 10000 };
    const d = { fc: 'FC-T', date, revenue: 100000, costs, status: 'OK', zeroLines: [] };
    return mutate[i] ? mutate[i](d) : d;
  });
}

test('analyst: contributors sorted by ₹ impact; revenue dip recognised; insight + action', () => {
  const days = series(20, {
    18: (d) => ({ ...d, costs: { ...d.costs, overheads: 14000, packaging: 9500 } }), // packaging +2.5k, overheads +2k
    19: (d) => ({ ...d, revenue: 78000 }),
  });
  const out = analyseAll({ days, rules, playbook });
  const d18 = out[18], d19 = out[19];
  assert.deepEqual(d18.facts.breaches.map((b) => b.key), ['packaging', 'overheads']);
  assert.ok(d18.facts.breaches.every((b) => b.cause === 'cost'));
  assert.equal(d19.colour, 'RED');
  assert.ok(d19.facts.breaches.every((b) => b.cause === 'revenue'));
  assert.match(d19.facts.action, /revenue fell/);
  assert.match(d19.insight, /^On May 20, CM2 = 5\.1%/);
});

test('analyst: BLUE day names the ₹0 line', () => {
  const out = analyseAll({ days: series(10, { 9: (d) => ({ ...d, costs: { ...d.costs, powerFuel: 0 }, zeroLines: ['powerFuel'] }) }), rules, playbook });
  assert.equal(out[9].colour, 'BLUE');
  assert.match(out[9].insight, /Power & Fuel booked as ₹0 \(normal ₹11\.0k\)/);
});

test('trend: 4 rising days towards the max is a watch item', () => {
  const mp = [27000, 27600, 28300, 29000];
  const out = analyseAll({ days: series(10, Object.fromEntries(mp.map((v, i) => [6 + i, (d) => ({ ...d, costs: { ...d.costs, manpower: v } })]))), rules, playbook });
  assert.ok(out[9].trends.some((t) => t.key === 'manpower'));
  assert.equal(out[8].trends.length, 0);
});

test('memory: a single-day upload still gets a baseline from earlier runs', () => {
  const hist = series(15);
  const memory = { 'FC-T': Object.fromEntries(hist.slice(0, 14).map((d) => [d.date, { revenue: d.revenue, costs: d.costs, status: 'OK' }])) };
  const today = { ...hist[14], revenue: 78000 };
  const out = analyseAll({ days: [today], rules, playbook, memory });
  assert.equal(out.length, 1);
  assert.equal(out[0].facts.baseline.days, 14);
  assert.match(out[0].facts.action, /revenue fell/);
});

test('writer guard: rejects invented numbers or dropped lines, accepts faithful rephrasing', async () => {
  const facts = { date: '2026-05-27', fc: 'FC-T', breaches: [{ line: 'Power & Fuel', pct: 15.2, max: 13, excessRs: 2200 }, { line: 'Manpower', pct: 32.8, max: 30, excessRs: 2800 }], cm2Pct: 10.1, lowLines: [] };
  const draft = 'On May 27, CM2 = 10.1% (RED). Above max: Manpower 32.8% (max 30%, +₹2,800), Power & Fuel 15.2% (max 13%, +₹2,200). Recommend: cost audit.';
  assert.ok(guard('CM2 fell to 10.1% on May 27. Manpower (32.8%) and Power & Fuel (15.2%) are over their limits, adding ₹2,800 and ₹2,200. Do a cost audit.', facts, draft).ok);
  assert.match(guard('CM2 fell to 9.4% on May 27; Manpower and Power & Fuel are high. Audit.', facts, draft).reason, /9\.4/);
  assert.match(guard('CM2 fell to 10.1% on May 27 because Manpower is too high. Audit costs now.', facts, draft).reason, /Power/);
  const fake = async () => ({ insight: 'CM2 is 7% today, Manpower 40%, Power & Fuel up. Audit.' });
  const w = await writeInsight({ ...facts, action: 'x' }, draft, fake);
  assert.equal(w.source, 'template'); assert.equal(w.text, draft);
  const none = await writeInsight({ ...facts, action: 'x' }, draft, async () => null);
  assert.equal(none.source, 'template');
  assert.deepEqual(numbersIn('₹1,23,456 and 10.1%'), [123456, 10.1]);
});

test('ask: questions map to whitelisted intents; nonsense gets help', () => {
  const ctx = { fcs: ['FC-PUNE', 'FC-DELHI'], dates: ['2026-05-01', '2026-08-08'], startDate: '2026-05-01' };
  assert.deepEqual(parseQuestion('Why was FC-PUNE red on Jul 8?', ctx), { type: 'explain', fc: 'FC-PUNE', date: '2026-07-08' });
  assert.deepEqual(parseQuestion('what happened in delhi on day 100', ctx), { type: 'explain', fc: 'FC-DELHI', date: '2026-08-08' });
  assert.equal(parseQuestion('which FCs were red on 8 Aug', ctx).type, 'day');
  assert.deepEqual(parseQuestion('worst days for pune', ctx), { type: 'rank', order: 'worst', fc: 'FC-PUNE' });
  assert.equal(parseQuestion('manpower breaches', ctx).line, 'manpower');
  assert.equal(parseQuestion('asdf qwerty', ctx).type, 'unknown');
  assert.equal(parseQuestion('??', ctx).type, 'help');
});
