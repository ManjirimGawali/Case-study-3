import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDate } from '../src/ingest/values.js';
import { matchHeader, findHeader } from '../src/ingest/headers.js';
import { loadDataset, InputError } from '../src/ingest/index.js';
import { detectTargets } from '../src/ingest/targets.js';

test('numbers: Indian grouping, ₹, accounting negatives, missing vs invalid', () => {
  assert.equal(parseNumber('₹1,23,456').value, 123456);
  assert.equal(parseNumber('Rs. 12,000.50').value, 12000.5);
  assert.equal(parseNumber('(1,200)').value, -1200);
  assert.equal(parseNumber(42).value, 42);
  assert.ok(parseNumber('').missing); assert.ok(parseNumber('N/A').missing); assert.ok(parseNumber('-').missing);
  assert.ok(parseNumber('12k').invalid); assert.ok(parseNumber('abc').invalid);
});

test('dates: ISO, day-first, month names, Excel serial, Date objects', () => {
  assert.equal(parseDate('2026-05-27'), '2026-05-27');
  assert.equal(parseDate('27/05/2026'), '2026-05-27');
  assert.equal(parseDate('27-05-26'), '2026-05-27');
  assert.equal(parseDate('27-May-2026'), '2026-05-27');
  assert.equal(parseDate('May 27, 2026'), '2026-05-27');
  assert.equal(parseDate('27th May', '2026-05-01'), '2026-05-27');
  assert.equal(parseDate(46169), '2026-05-27');
  assert.equal(parseDate(new Date(Date.UTC(2026, 4, 27))), '2026-05-27');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('nonsense'), null);
});

test('headers: synonyms, units stripped, longest wins (FC Rent is rent, not FC)', () => {
  assert.equal(matchHeader('FC Rent'), 'rent');
  assert.equal(matchHeader('FC'), 'fc');
  assert.equal(matchHeader('Power and Fuel'), 'powerFuel');
  assert.equal(matchHeader('Power & Fuel (₹)'), 'powerFuel');
  assert.equal(matchHeader('Manpower Cost'), 'manpower');
  assert.equal(matchHeader('Equipment Rentals'), 'equipment');
  assert.equal(matchHeader('Net Sales (INR)'), 'revenue');
  assert.equal(matchHeader('Remarks'), null);
  const h = findHeader([['Prozo FC P&L'], [], ['Day', 'Revenue', 'Manpower', 'Packaging', 'Power and Fuel', 'FC Rent', 'Equipment Rentals', 'Overheads']]);
  assert.equal(h.row, 2); assert.equal(h.map.rent, 5); assert.equal(h.map.day, 0);
});

const csv = (s, name = 'x.csv') => ({ name, buffer: Buffer.from(s) });

test('sample-style file: Day numbers become dates from the start date; FC from hint', async () => {
  const d = await loadDataset([csv('Day,Revenue,Manpower,Packaging,Power and Fuel,FC Rent,Equipment Rentals,Overheads\n27,100000,27000,5000,11000,15000,6000,10000\n')], { startDate: '2026-05-01', fcHint: 'FC-PUNE' });
  assert.equal(d.days[0].date, '2026-05-27'); assert.equal(d.days[0].fc, 'FC-PUNE'); assert.equal(d.days[0].status, 'OK');
});

test('long format with FC column, semicolons, quotes, totals row skipped, duplicates reported', async () => {
  const s = 'FC;Date;Sales;Labour;Packing;Electricity;Rent;MHE Rental;Misc\n"FC-A";2026-06-01;"1,00,000";27000;5000;11000;15000;6000;10000\nFC-B;01/06/2026;80000;20000;4000;9000;12000;5000;8000\nFC-A;2026-06-01;100000;28000;5000;11000;15000;6000;10000\nTotal;;280000;;;;;;\n';
  const d = await loadDataset([csv(s)], { startDate: '2026-05-01' });
  assert.equal(d.days.length, 2);
  assert.equal(d.days.find((x) => x.fc === 'FC-A').costs.manpower, 28000);
  assert.ok(d.issues.some((i) => i.issue === 'DUPLICATE'));
});

test('missing cost → INCOMPLETE (not zero); zero cost → warning; zero revenue → NO_REVENUE', async () => {
  const s = 'FC,Date,Revenue,Manpower,Packaging,Power and Fuel,FC Rent,Equipment Rentals,Overheads\nA,2026-06-01,100000,27000,,11000,15000,6000,10000\nA,2026-06-02,100000,27000,5000,0,15000,6000,10000\nA,2026-06-03,0,27000,5000,11000,15000,6000,10000\n';
  const d = await loadDataset([csv(s)], { startDate: '2026-05-01' });
  assert.deepEqual(d.days.map((x) => x.status), ['INCOMPLETE', 'OK', 'NO_REVENUE']);
  assert.ok(d.issues.some((i) => i.issue === 'ZERO_COST'));
});

test('bad inputs give clear InputErrors', async () => {
  await assert.rejects(loadDataset([csv('', 'e.csv')]), (e) => e instanceof InputError && /empty/.test(e.message));
  await assert.rejects(loadDataset([csv('a,b\n1,2\n')]), (e) => e instanceof InputError && /header row/.test(e.message));
  await assert.rejects(loadDataset([{ name: 'x.xlsx', buffer: Buffer.from('PK\u0003\u0004garbage') }]), (e) => e instanceof InputError && /corrupt/.test(e.message));
  await assert.rejects(loadDataset([{ name: 'x.xls', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]) }]), (e) => e instanceof InputError && /\.xls/.test(e.message));
  await assert.rejects(loadDataset([]), (e) => e instanceof InputError);
});

test('target block detection: vertical (range strings / two columns) and horizontal (Min/Max rows)', () => {
  const v = detectTargets([{ name: 'T', rows: [['Line Item', 'Target'], ['Manpower', '25% - 30%'], ['Packaging', '4-7%'], ['Power & Fuel', '9–13%'], ['CM2', '15-30%']] }]);
  assert.deepEqual(v.lines.manpower, { min: 25, max: 30 }); assert.deepEqual(v.cm2, { min: 15, max: 30 });
  const v2 = detectTargets([{ name: 'T', rows: [['Item', 'Min', 'Max'], ['Manpower', 0.25, 0.3], ['Packaging', 0.04, 0.07], ['FC Rent', 0.13, 0.18]] }]);
  assert.deepEqual(v2.lines.rent, { min: 13, max: 18 });
  const h = detectTargets([{ name: 'S', rows: [['Day', 'Revenue', 'Manpower', 'Packaging', 'Power and Fuel', 'FC Rent'], [1, 100, 27, 5, 11, 15], [], ['Min %', '', 25, 4, 9, 13], ['Max %', '', 30, 7, 13, 18]] }]);
  assert.deepEqual(h.lines.powerFuel, { min: 9, max: 13 });
  assert.equal(detectTargets([{ name: 'S', rows: [['Day', 'Revenue', 'Manpower'], [1, 100, 27]] }]), null);
});
