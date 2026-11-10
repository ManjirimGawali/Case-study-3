import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourFor, evaluateDay } from '../src/engine/rules.js';
import { computeDay } from '../src/engine/compute.js';
import { defaults } from '../src/settings.js';

const rules = defaults().rules;
const C = rules.colour;

test('colour boundaries are gap-free and match the brief', () => {
  const cases = [[-5, 'RED'], [11.99, 'RED'], [12, 'YELLOW'], [14.99, 'YELLOW'], [15, 'GREEN'], [22, 'GREEN'], [30, 'GREEN'], [30.01, 'YELLOW'], [32.99, 'YELLOW'], [33, 'BLUE'], [60, 'BLUE'], [null, 'GREY'], [NaN, 'GREY']];
  for (const [v, want] of cases) assert.equal(colourFor(v, C), want, `CM2 ${v}`);
});

// Build a day from target % values (revenue 100000 so 1% = ₹1000).
const day = (p, extra = {}) => computeDay({ fc: 'FC-X', date: '2026-05-27', revenue: 100000, costs: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * 1000])), status: 'OK', zeroLines: [], ...extra });
const NORMAL = { manpower: 27, packaging: 5, powerFuel: 11, rent: 15, equipment: 6, overheads: 10 }; // CM1 68, CM2 26

test('CM1 / CM2 formulas', () => {
  const d = day(NORMAL);
  assert.equal(d.cm1, 68000); assert.equal(d.cm1Pct, 68);
  assert.equal(d.cm2, 26000); assert.equal(d.cm2Pct, 26);
  assert.equal(d.pct.manpower, 27);
});

test('clean day: no rows, GREEN, CLEAN', () => {
  const e = evaluateDay(day(NORMAL), rules);
  assert.equal(e.anomalies.length, 0); assert.equal(e.colour, 'GREEN'); assert.equal(e.dayClass, 'CLEAN');
});

test('line min/max are inclusive (exactly at max is not a breach)', () => {
  const e = evaluateDay(day({ ...NORMAL, overheads: 12, equipment: 4 }), rules);
  assert.equal(e.anomalies.length, 0);
});

test('line-item-only breach', () => {
  const e = evaluateDay(day({ ...NORMAL, overheads: 13, rent: 14 }), rules);
  assert.equal(e.dayClass, 'LINE_ONLY');
  assert.deepEqual(e.anomalies.map((a) => [a.key, a.status]), [['overheads', 'ABOVE_MAX']]);
  assert.equal(e.anomalies[0].impactRs, 1000);
  assert.equal(e.anomalies[0].deviationPp, 1);
});

test('CM2 breach: RED, HIGH, deviation vs the 15% target', () => {
  const e = evaluateDay(day({ ...NORMAL, manpower: 33, powerFuel: 14 }), rules); // line breaches, CM2 17 (fine)
  const d = day({ manpower: 30, packaging: 7, powerFuel: 13, rent: 18, equipment: 8, overheads: 13 }); // CM2 11
  const e2 = evaluateDay(d, rules);
  assert.equal(e2.colour, 'RED'); assert.equal(e2.dayClass, 'CM2_BREACH');
  const cm2 = e2.anomalies.find((a) => a.key === 'cm2');
  assert.equal(cm2.status, 'BELOW_TARGET'); assert.equal(cm2.deviationPp, -4); assert.equal(cm2.severity, 'HIGH');
  assert.ok(e.anomalies.some((a) => a.key === 'manpower'));
});

test('CM2 12–15 is YELLOW but not a CM2 anomaly (inside ±3 pp)', () => {
  const e = evaluateDay(day({ manpower: 30, packaging: 7, powerFuel: 12, rent: 18, equipment: 8, overheads: 11.5 }), rules); // CM2 13.5
  assert.equal(e.colour, 'YELLOW');
  assert.ok(!e.anomalies.some((a) => a.key === 'cm2'));
  assert.equal(e.dayClass, 'CLEAN');
});

test('suspiciously high CM2 → BLUE + SUSPICIOUS_HIGH', () => {
  const e = evaluateDay(day({ ...NORMAL, powerFuel: 0 }), rules); // CM2 37
  assert.equal(e.colour, 'BLUE'); assert.equal(e.dayClass, 'SUSPICIOUS_HIGH');
  assert.ok(e.anomalies.some((a) => a.key === 'cm2' && a.status === 'ABOVE_TARGET'));
  assert.ok(e.anomalies.some((a) => a.key === 'powerFuel' && a.status === 'BELOW_MIN'));
});

test('CM1 outside 62–73 flags CM1 (CM1 breach class when CM2 is fine)', () => {
  const e = evaluateDay(day({ ...NORMAL, manpower: 24, packaging: 2.5, rent: 18, overheads: 12, powerFuel: 13, equipment: 8 }), rules); // CM1 73.5, CM2 22.5
  assert.equal(e.dayClass, 'CM1_BREACH');
  assert.equal(e.anomalies.find((a) => a.key === 'cm1').status, 'ABOVE_TARGET');
});

test('data-issue day is GREY with a data row, never a fake margin', () => {
  const d = computeDay({ fc: 'FC-X', date: '2026-05-27', revenue: 0, costs: NORMAL, status: 'NO_REVENUE' });
  const e = evaluateDay(d, rules);
  assert.equal(e.colour, 'GREY'); assert.equal(e.dayClass, 'DATA_ISSUE'); assert.equal(e.anomalies[0].status, 'NO_REVENUE');
});

test('per-FC override changes only that FC', () => {
  const r = structuredClone(rules); r.fcOverrides = { 'FC-X': { rent: { min: 15, max: 21 } } };
  const d = day({ ...NORMAL, rent: 20, overheads: 8 });
  assert.equal(evaluateDay(d, r).anomalies.length, 0);
  assert.equal(evaluateDay({ ...d, fc: 'FC-Y' }, r).anomalies[0].key, 'rent');
});
