// Scores the engine against the generator's answer keys and writes outputs/eval.md.
//   npm run eval
// Checks: colour + day class per FC-day, every expected flag raised and no unexpected ones,
// planted-scenario specifics (revenue-vs-cost cause, ₹0 line named, top contributor, trend),
// data issues reported, the provided sample PDF/CSV parse identically, and bad files give clear messages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from '../server/src/run.js';
import { initStore } from '../server/src/store/index.js';
import { loadDataset } from '../server/src/ingest/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TD = (f) => path.join(ROOT, 'test-data', f);
const file = (f) => ({ name: path.basename(f), buffer: fs.readFileSync(f) });
await initStore();

const md = ['# Evaluation', '', `Generated ${new Date().toISOString()} by \`npm run eval\`. The engine runs with memory off, so results depend only on the file.`, ''];
let failures = 0;

function score(label, result, key) {
  const idx = new Map(result.days.map((d) => [`${d.fc}|${d.date}`, d]));
  let n = 0, colourOk = 0, classOk = 0, flagsOk = 0, missing = 0, extra = 0;
  const bad = [];
  const scen = { total: 0, ok: 0, fails: [] };
  for (const a of key.answers) {
    n++;
    const d = idx.get(`${a.fc}|${a.date}`);
    if (!d) { bad.push(`${a.fc} ${a.date}: missing from output`); continue; }
    if (d.colour === a.colour) colourOk++; else bad.push(`${a.fc} ${a.date}: colour ${d.colour}, expected ${a.colour}`);
    if (d.dayClass === a.dayClass) classOk++; else bad.push(`${a.fc} ${a.date}: class ${d.dayClass}, expected ${a.dayClass}`);
    const got = new Set(d.anomalies.map((x) => `${x.key}:${x.status}`));
    const want = new Set(a.flags);
    const m = [...want].filter((x) => !got.has(x)), e = [...got].filter((x) => !want.has(x));
    missing += m.length; extra += e.length;
    if (!m.length && !e.length) flagsOk++; else bad.push(`${a.fc} ${a.date}: flags missing [${m}] extra [${e}]`);
    if (a.want) {
      scen.total++;
      const w = a.want, why = [];
      if (w.dayClass && d.dayClass !== w.dayClass) why.push(`class ${d.dayClass}`);
      if (w.colour && d.colour !== w.colour) why.push(`colour ${d.colour}`);
      for (const k of w.mustFlag || []) if (!d.anomalies.some((x) => x.key === k)) why.push(`no ${k} flag`);
      if (w.insightHas && !(d.insight || '').includes(w.insightHas)) why.push(`insight lacks "${w.insightHas}"`);
      if (w.actionHas && !(d.facts?.action || '').toLowerCase().includes(w.actionHas)) why.push(`action "${d.facts?.action}"`);
      if (w.topLine && d.facts?.breaches?.[0]?.key !== w.topLine) why.push(`top contributor ${d.facts?.breaches?.[0]?.key}`);
      if (why.length) scen.fails.push(`${a.fc} ${a.date} (${a.scenario}): ${why.join(', ')}`); else scen.ok++;
    }
    if (a.wantTrend && !d.trends?.some((t) => t.key === a.wantTrend)) { scen.total++; scen.fails.push(`${a.fc} ${a.date}: no ${a.wantTrend} trend`); }
    else if (a.wantTrend) { scen.total++; scen.ok++; }
  }
  const ok = colourOk === n && classOk === n && flagsOk === n && !scen.fails.length;
  if (!ok) failures++;
  md.push(`## ${label}`, '', `| FC-days | Colour correct | Day class correct | Exact flag set | Missed flags | False flags | Planted checks | Time |`, '|---|---|---|---|---|---|---|---|',
    `| ${n} | ${colourOk}/${n} | ${classOk}/${n} | ${flagsOk}/${n} | ${missing} | ${extra} | ${scen.ok}/${scen.total} | ${result.meta.ms} ms |`, '');
  if (bad.length || scen.fails.length) md.push('Problems:', '', ...[...bad, ...scen.fails].slice(0, 30).map((b) => `- ${b}`), '');
  console.log(`${label}: colour ${colourOk}/${n} class ${classOk}/${n} flags ${flagsOk}/${n} (missed ${missing}, false ${extra}) planted ${scen.ok}/${scen.total} · ${result.meta.ms} ms`);
  return result;
}

// 1. Provided sample: PDF export and transcribed CSV must parse to the same 100 days.
{
  const pdf = await loadDataset([file(TD('sample_dayWisePnL.pdf'))], { startDate: '2026-05-01', fcHint: 'FC-PUNE' });
  const csv = await loadDataset([file(TD('sample_pune.csv'))], { startDate: '2026-05-01', fcHint: 'FC-PUNE' });
  const same = pdf.days.length === csv.days.length && pdf.days.every((d, i) => d.date === csv.days[i].date && d.revenue === csv.days[i].revenue && Object.keys(d.costs).every((k) => d.costs[k] === csv.days[i].costs[k]));
  if (!same) failures++;
  const r = await runMonitor({ files: [file(TD('sample_dayWisePnL.pdf'))], fcHint: 'FC-PUNE', useMemory: false, ai: false });
  const reds = r.days.filter((d) => d.colour === 'RED').map((d) => d.day);
  const s = r.summary.fcs[0];
  md.push('## Provided sample (PDF export of the sheet, 1 FC × 100 days)', '',
    `- PDF parsed ${pdf.days.length} days; identical to the transcribed CSV: **${same ? 'yes' : 'NO'}**`,
    `- Colours: Red ${s.colours.RED}, Yellow ${s.colours.YELLOW}, Green ${s.colours.GREEN}, Blue ${s.colours.BLUE}. Red days: ${reds.join(', ')} (expected 31, 39, 69 from hand calculation)`,
    `- Day classes: clean ${s.classes.CLEAN}, line-only ${s.classes.LINE_ONLY}, CM1 breach ${s.classes.CM1_BREACH}, CM2 breach ${s.classes.CM2_BREACH}, suspicious high ${s.classes.SUSPICIOUS_HIGH} (line-item targets are provisional)`, '');
  if (reds.join() !== '31,39,69') failures++;
  console.log(`sample PDF: ${pdf.days.length} days, same as CSV: ${same}, red days ${reds}`);
}

// 2. Extended multi-FC workbook (+ the same data as CSV).
const key = JSON.parse(fs.readFileSync(TD('multi_fc.answers.json'), 'utf8'));
for (const f of ['multi_fc.xlsx', 'multi_fc.csv']) {
  const r = await runMonitor({ files: [file(TD(f))], useMemory: false, ai: false });
  score(`Extended data: ${f} (6 FCs × 100 days, planted scenarios)`, r, key);
  const kinds = new Set(r.issues.map((i) => i.issue));
  const missingIssues = key.expectedIssues.filter((k) => !kinds.has(k));
  if (missingIssues.length) failures++;
  md.push(`Data issues reported: ${[...kinds].join(', ')}${missingIssues.length ? ` · **missing: ${missingIssues.join(', ')}**` : ' (all expected kinds present)'} · targets: ${r.rules._source}`, '');
  if (f.endsWith('.xlsx')) {
    const demo = r.days.filter((d) => d.date === key.demoDate);
    md.push(`Demo date ${key.demoDate}:`, '', '| FC | Colour | Class | CM2 % |', '|---|---|---|---|', ...demo.map((d) => `| ${d.fc} | ${d.colour} | ${d.dayClass} | ${d.cm2Pct ?? '—'} |`), '');
  }
}

// 3. Scale sets, if generated (npm run generate -- --fcs 50 --days 365 --out test-data/scale).
const scaleDir = TD('scale');
if (fs.existsSync(scaleDir)) {
  for (const f of fs.readdirSync(scaleDir).filter((x) => x.endsWith('.csv'))) {
    const k = JSON.parse(fs.readFileSync(path.join(scaleDir, f.replace(/\.csv$/, '.answers.json')), 'utf8'));
    const r = await runMonitor({ files: [file(path.join(scaleDir, f))], useMemory: false, ai: false });
    score(`Scale: ${f}`, r, k);
  }
}

// 4. Bad inputs: each must produce a clear message (InputError), never a crash.
md.push('## Bad inputs', '', '| File | Message |', '|---|---|');
for (const f of fs.readdirSync(TD('bad')).sort()) {
  try {
    await loadDataset([file(path.join(TD('bad'), f))], { startDate: '2026-05-01' });
    md.push(`| ${f} | **accepted (unexpected)** |`); failures++;
  } catch (e) {
    md.push(`| ${f} | ${e.userFacing ? e.message.replace(/\|/g, '/') : `**CRASH: ${e.message}**`} |`);
    if (!e.userFacing) failures++;
  }
}
md.push('', failures ? `**${failures} check group(s) failed.**` : '**All checks passed.**', '');
fs.mkdirSync(path.join(ROOT, 'outputs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'outputs', 'eval.md'), md.join('\n'));
console.log(`wrote outputs/eval.md · ${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
