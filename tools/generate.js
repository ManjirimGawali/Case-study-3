// Test-data generator with an answer key.
//   npm run generate                         -> test-data/multi_fc.xlsx (+ .answers.json)
//       FC-PUNE = the provided 100 sample days unchanged; 5 more FCs generated with planted scenarios.
//   npm run generate -- --fcs 50 --days 365 --out test-data/scale   -> large random set with planted scenarios
//   Also writes test-data/bad/* (empty, corrupt, wrong headers, garbage) for the bad-input tests.
// The answer key is computed here with its own arithmetic (it does not import the engine).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const NFC = Number(opt('--fcs', 0));
const NDAYS = Number(opt('--days', 100));
const OUT = path.resolve(ROOT, opt('--out', 'test-data'));
const START = opt('--start', '2026-05-01');
const SEED = Number(opt('--seed', 7));

// Must mirror config/rules.json defaults (the generated workbook also carries them in a Targets sheet).
const T = { manpower: [25, 30], packaging: [4, 7], powerFuel: [9, 13], rent: [13, 18], equipment: [4, 8], overheads: [8, 12] };
const KEYS = Object.keys(T);
const HEAD = ['FC', 'Date', 'Revenue', 'Manpower Cost', 'Packaging Cost', 'Power & Fuel', 'FC Rent', 'Equipment Rentals', 'Overheads'];
const CENTRE = { manpower: 27.5, packaging: 5.5, powerFuel: 11, rent: 15.5, equipment: 6, overheads: 10 };
const SD = { manpower: 0.8, packaging: 0.45, powerFuel: 0.55, rent: 0, equipment: 0.55, overheads: 0.55 };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(SEED);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Independent expectation (own arithmetic).
function expect(rev, c) {
  if (!(rev > 0) || KEYS.some((k) => c[k] === null || c[k] === undefined || typeof c[k] !== 'number')) return { colour: 'GREY', dayClass: 'DATA_ISSUE', flags: [] };
  const p = Object.fromEntries(KEYS.map((k) => [k, +(Math.round((c[k] / rev) * 10000) / 100).toFixed(2)]));
  const cm1 = +(100 - p.manpower - p.packaging).toFixed(2);
  const cm2 = +(cm1 - p.powerFuel - p.rent - p.equipment - p.overheads).toFixed(2);
  const flags = KEYS.filter((k) => p[k] > T[k][1] || p[k] < T[k][0]).map((k) => ({ key: k, status: p[k] > T[k][1] ? 'ABOVE_MAX' : 'BELOW_MIN' }));
  const cm1f = cm1 < 62 ? 'BELOW_TARGET' : cm1 > 73 ? 'ABOVE_TARGET' : null;
  const cm2f = cm2 < 12 ? 'BELOW_TARGET' : cm2 > 33 ? 'ABOVE_TARGET' : null;
  if (cm1f) flags.push({ key: 'cm1', status: cm1f });
  if (cm2f) flags.push({ key: 'cm2', status: cm2f });
  const colour = cm2 < 12 ? 'RED' : cm2 < 15 ? 'YELLOW' : cm2 <= 30 ? 'GREEN' : cm2 < 33 ? 'YELLOW' : 'BLUE';
  const dayClass = colour === 'BLUE' || cm2f === 'ABOVE_TARGET' ? 'SUSPICIOUS_HIGH' : cm2f ? 'CM2_BREACH' : cm1f ? 'CM1_BREACH' : flags.length ? 'LINE_ONLY' : 'CLEAN';
  return { colour, dayClass, flags, cm1: +cm1.toFixed(2), cm2: +cm2.toFixed(2) };
}

// A normal day: every line inside its band with a margin, rent fixed in rupees.
function normalDay(base, dayIdx) {
  const weekday = [1.0, 1.04, 1.02, 1.0, 1.06, 0.95, 0.93][dayIdx % 7];
  const rev = Math.round(base * weekday * (1 + clamp(gauss() * 0.03, -0.06, 0.06)));
  const c = {};
  for (const k of KEYS) {
    if (k === 'rent') { c.rent = Math.round(base * 0.155); continue; }
    const p = clamp(CENTRE[k] + gauss() * SD[k], T[k][0] + 0.4, T[k][1] - 0.4);
    c[k] = Math.round((p / 100) * rev);
  }
  return { rev, c };
}
const setPct = (d, k, p) => { d.c[k] = Math.round((p / 100) * d.rev); };

// Scenario library: each mutates a normal day and states what must happen.
const SCEN = {
  blueZero: { note: 'Power & Fuel booked as ₹0 -> suspiciously high CM2', apply: (d) => { for (const k of ['manpower', 'packaging', 'equipment', 'overheads']) setPct(d, k, CENTRE[k]); d.c.powerFuel = 0; }, want: { dayClass: 'SUSPICIOUS_HIGH', colour: 'BLUE', insightHas: 'Power & Fuel booked as ₹0' } },
  blueLow: { note: 'All costs 20% under-booked -> suspiciously high CM2', apply: (d) => { for (const k of KEYS) d.c[k] = Math.round(d.c[k] * 0.8); }, want: { dayClass: 'SUSPICIOUS_HIGH', colour: 'BLUE' } },
  lineOnly: { note: 'Overheads 13.6% (above 12% max) while margins hold', apply: (d) => { setPct(d, 'overheads', 13.6); setPct(d, 'manpower', 27.2); setPct(d, 'packaging', 5.4); setPct(d, 'powerFuel', 10.8); setPct(d, 'equipment', 5.8); }, want: { dayClass: 'LINE_ONLY', mustFlag: ['overheads'] } },
  revenueDip: { note: 'Revenue −20% with normal cost amounts -> RED, revenue-driven', apply: (d, base) => { const normal = normalDay(base, 0); d.rev = Math.round(base * 0.8); for (const k of KEYS) d.c[k] = k === 'rent' ? Math.round(base * 0.155) : Math.round((CENTRE[k] / 100) * base); void normal; }, want: { dayClass: 'CM2_BREACH', colour: 'RED', actionHas: 'revenue fell' } },
  costSpike: { note: 'Manpower 38% + Power & Fuel 15% -> RED, cost-driven', apply: (d) => { setPct(d, 'manpower', 38); setPct(d, 'powerFuel', 15); for (const k of ['packaging', 'equipment', 'overheads']) setPct(d, k, CENTRE[k]); }, want: { dayClass: 'CM2_BREACH', colour: 'RED', mustFlag: ['manpower', 'powerFuel', 'cm2', 'cm1'], topLine: 'manpower' } },
  cm1High: { note: 'Manpower and packaging under-booked -> CM1 above 73%', apply: (d) => { setPct(d, 'manpower', 24); setPct(d, 'packaging', 2.5); setPct(d, 'powerFuel', 12.8); setPct(d, 'equipment', 7.8); setPct(d, 'overheads', 11.8); d.c.rent = Math.round(0.178 * d.rev); }, want: { dayClass: 'CM1_BREACH', mustFlag: ['manpower', 'packaging', 'cm1'] } },
  yellowLow: { note: 'Every line near its max, none above -> CM2 ~12.6% (YELLOW, no flags)', apply: (d) => { setPct(d, 'manpower', 29.9); setPct(d, 'packaging', 6.9); setPct(d, 'powerFuel', 12.9); setPct(d, 'equipment', 7.9); setPct(d, 'overheads', 11.9); d.c.rent = Math.round(0.179 * d.rev); }, want: { dayClass: 'CLEAN', colour: 'YELLOW' } },
};

function rowsFor(fc, base, ndays, plan) {
  const out = [];
  for (let i = 0; i < ndays; i++) {
    const date = addDays(START, i);
    const d = normalDay(base, i);
    const s = plan[date];
    if (s) SCEN[s].apply(d, base);
    out.push({ fc, date, rev: d.rev, c: d.c, scenario: s || null });
  }
  return out;
}

async function writeWorkbook(file, rows, extraRows = [], { targets = true } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daily P&L');
  ws.addRow(HEAD);
  ws.getRow(1).font = { bold: true };
  for (const r of [...rows, ...extraRows]) {
    const vals = r.raw || [r.fc, new Date(`${r.date}T00:00:00Z`), r.rev, ...KEYS.map((k) => r.c[k])];
    ws.addRow(vals);
  }
  ws.getColumn(2).numFmt = 'dd-mmm-yyyy';
  ws.columns.forEach((c, i) => { c.width = i < 2 ? 13 : 15; });
  if (targets) {
    const t = wb.addWorksheet('Targets');
    t.addRow(['Line Item', 'Min % of Revenue', 'Max % of Revenue']);
    t.getRow(1).font = { bold: true };
    const L = { manpower: 'Manpower', packaging: 'Packaging', powerFuel: 'Power & Fuel', rent: 'FC Rent', equipment: 'Equipment Rentals', overheads: 'Overheads' };
    for (const k of KEYS) t.addRow([L[k], `${T[k][0]}%`, `${T[k][1]}%`]);
    t.addRow(['CM1', '65%', '70%']);
    t.addRow(['CM2', '15%', '30%']);
    t.addRow([]);
    t.addRow(['Line-item ranges are the provisional targets used by this project; CM1/CM2 targets are from the brief.']);
  }
  await wb.xlsx.writeFile(file);
}

function answersFrom(rows) {
  return rows.map((r) => {
    const e = expect(r.rev, r.c);
    const a = { fc: r.fc, date: r.date, colour: e.colour, dayClass: e.dayClass, flags: e.flags.map((f) => `${f.key}:${f.status}`), scenario: r.scenario };
    if (r.scenario) { a.want = SCEN[r.scenario].want; a.note = SCEN[r.scenario].note; }
    return a;
  });
}

async function multi() {
  fs.mkdirSync(OUT, { recursive: true });
  const csv = fs.readFileSync(path.join(ROOT, 'test-data', 'sample_pune.csv'), 'utf8').trim().split('\n').slice(1);
  const pune = csv.map((l) => { const [day, rev, ...c] = l.split(',').map(Number); return { fc: 'FC-PUNE', date: addDays(START, day - 1), rev, c: Object.fromEntries(KEYS.map((k, i) => [k, c[i]])), scenario: null }; });
  const ND = pune.length;
  const DEMO = addDays(START, ND - 1); // 2026-08-08 by default
  const D = (n) => addDays(DEMO, -n);
  const plans = {
    'FC-DELHI': { base: 150000, plan: { [DEMO]: 'blueZero', [D(24)]: 'blueLow' } },
    'FC-BLR': { base: 130000, plan: { [DEMO]: 'lineOnly' } },
    'FC-KOL': { base: 80000, plan: { [DEMO]: 'revenueDip', [D(49)]: 'costSpike' } },
    'FC-CHN': { base: 110000, plan: { [D(38)]: 'cm1High', [D(19)]: 'yellowLow' } },
    'FC-HYD': { base: 95000, plan: {} },
  };
  const gen = Object.entries(plans).flatMap(([fc, p]) => rowsFor(fc, p.base, ND, p.plan));

  // BLR: manpower creeping up over the 4 days before the demo day (trend watch, still within max).
  [27.7, 28.4, 29.0, 29.6].forEach((p, i) => { const r = gen.find((x) => x.fc === 'FC-BLR' && x.date === D(3 - i)); setPct(r, 'manpower', p); r.trend = 'manpower'; });
  // Keep demo-day BLR manpower at the top of the creep so the trend is visible on the digest.
  { const r = gen.find((x) => x.fc === 'FC-BLR' && x.date === DEMO); setPct(r, 'manpower', 29.8); }

  // HYD: data problems (all must be reported, none may crash the run).
  const hyd = (n) => gen.find((x) => x.fc === 'FC-HYD' && x.date === D(n));
  const dataRows = [];
  const raw = (r, override) => { const v = [r.fc, new Date(`${r.date}T00:00:00Z`), r.rev, ...KEYS.map((k) => r.c[k])]; Object.entries(override).forEach(([i, x]) => { v[i] = x; }); return v; };
  { const r = hyd(0); r.raw = raw(r, { 2: null }); r.rev = null; r.dataIssue = 'NO_REVENUE'; }            // demo day: revenue blank
  { const r = hyd(28); r.raw = raw(r, { 8: null }); r.c.overheads = null; r.dataIssue = 'INCOMPLETE'; }  // missing overheads cell
  { const r = hyd(27); r.raw = raw(r, { 4: '12k' }); r.c.packaging = null; r.dataIssue = 'INCOMPLETE'; } // text in a number cell
  { const r = hyd(26); r.raw = raw(r, { 3: `₹ ${r.c.manpower.toLocaleString('en-IN')}`, 1: `${r.date.slice(8)}/${r.date.slice(5, 7)}/${r.date.slice(0, 4)}` }); } // Indian format + dd/mm/yyyy string
  { const r = hyd(25); const first = { ...r, c: { ...r.c, overheads: r.c.overheads * 3 } }; dataRows.push({ ...first, raw: raw(first, {}), dupFirst: true }); } // duplicate: the later (correct) row wins
  dataRows.push({ raw: ['Total', null, gen.filter((r) => r.fc === 'FC-HYD').reduce((s, r) => s + (r.rev || 0), 0)] }); // a totals row to skip

  // Put the duplicate before the real row: insert it right before HYD D(25)
  const all = [...pune, ...gen];
  const dupIdx = all.findIndex((x) => x.fc === 'FC-HYD' && x.date === D(25));
  all.splice(dupIdx, 0, dataRows[0]);
  const file = path.join(OUT, 'multi_fc.xlsx');
  await writeWorkbook(file, all, [dataRows[1]]);

  const answers = answersFrom([...pune, ...gen]);
  for (const a of answers) {
    const r = gen.find((x) => x.fc === a.fc && x.date === a.date);
    if (r?.dataIssue) { a.colour = 'GREY'; a.dayClass = 'DATA_ISSUE'; a.flags = [`data:${r.dataIssue}`]; }
    if (a.fc === 'FC-BLR' && a.date === DEMO) a.wantTrend = 'manpower'; // 4th consecutive rise
  }
  const key = { generatedAt: new Date().toISOString(), start: START, demoDate: DEMO, file: 'multi_fc.xlsx', expectedIssues: ['NO_REVENUE', 'INCOMPLETE', 'BAD_VALUE', 'DUPLICATE'], puneRedDays: answers.filter((a) => a.fc === 'FC-PUNE' && a.colour === 'RED').map((a) => a.date), answers };
  fs.writeFileSync(path.join(OUT, 'multi_fc.answers.json'), JSON.stringify(key, null, 1));
  // Same data as CSV (long format) for the "CSV upload" path.
  const q = (v) => (v === null || v === undefined ? '' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csvRows = all.filter((r) => !r.raw || r.fc).map((r) => (r.raw ? r.raw.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)) : [r.fc, r.date, r.rev, ...KEYS.map((k) => r.c[k])]).map(q).join(','));
  fs.writeFileSync(path.join(OUT, 'multi_fc.csv'), [HEAD.join(','), ...csvRows].join('\n') + '\n');
  // A single-day file for the daily "drop in inbox" flow.
  const lastDay = gen.filter((r) => r.date === DEMO && !r.dataIssue);
  fs.writeFileSync(path.join(OUT, `daily_${DEMO}.csv`), [HEAD.join(','), ...lastDay.map((r) => [r.fc, r.date, r.rev, ...KEYS.map((k) => r.c[k])].join(','))].join('\n') + '\n');
  const counts = {}; answers.forEach((a) => { counts[a.dayClass] = (counts[a.dayClass] || 0) + 1; });
  console.log(`wrote ${path.relative(ROOT, file)} (${answers.length} FC-days, 6 FCs, demo date ${DEMO}) + answers, csv, daily file`, counts);
}

async function scale() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  const names = Object.keys(SCEN);
  for (let f = 0; f < NFC; f++) {
    const fc = `FC-${String(f + 1).padStart(3, '0')}`;
    const plan = {};
    for (let i = 7; i < NDAYS; i++) if (rand() < 0.03) plan[addDays(START, i)] = names[Math.floor(rand() * names.length)];
    rows.push(...rowsFor(fc, 60000 + Math.round(rand() * 140000), NDAYS, plan));
  }
  const file = path.join(OUT, `scale_${NFC}x${NDAYS}.csv`);
  fs.writeFileSync(file, [HEAD.join(','), ...rows.map((r) => [r.fc, r.date, r.rev, ...KEYS.map((k) => r.c[k])].join(','))].join('\n') + '\n');
  fs.writeFileSync(file.replace(/\.csv$/, '.answers.json'), JSON.stringify({ start: START, file: path.basename(file), answers: answersFrom(rows) }));
  console.log(`wrote ${path.relative(ROOT, file)} (${rows.length} FC-days, ${rows.filter((r) => r.scenario).length} planted scenarios)`);
}

function bad() {
  const dir = path.join(ROOT, 'test-data', 'bad');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'empty.csv'), '');
  fs.writeFileSync(path.join(dir, 'corrupt.xlsx'), Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('this is not a real zip archive '.repeat(20))]));
  fs.writeFileSync(path.join(dir, 'wrong_headers.csv'), 'Name,Age,City\nAsha,31,Pune\nRavi,29,Delhi\n');
  fs.writeFileSync(path.join(dir, 'random_bytes.bin'), Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 256)));
  fs.writeFileSync(path.join(dir, 'header_only.csv'), 'Date,Revenue,Manpower,Packaging,Power and Fuel,FC Rent,Equipment Rentals,Overheads\n');
  fs.writeFileSync(path.join(dir, 'all_bad_rows.csv'), 'Date,Revenue,Manpower,Packaging,Power and Fuel,FC Rent,Equipment Rentals,Overheads\nnot a date,abc,1,2,3,4,5,6\n');
  console.log('wrote test-data/bad/ (6 files)');
}

if (NFC > 0) await scale(); else { await multi(); bad(); }
