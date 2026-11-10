// CLI: npm run monitor -- <file...> [--fc FC-PUNE] [--start 2026-05-01] [--out outputs] [--send] [--date YYYY-MM-DD] [--no-memory] [--ai]
import fs from 'node:fs';
import path from 'node:path';
import { runMonitor, deliverRun } from './run.js';
import { initStore, store } from './store/index.js';
import { buildWorkbook, anomalyRows, toCsv } from './report/workbook.js';
import { buildDigests } from './digest/build.js';
import { loadSettings } from './settings.js';
import { CFG } from './config.js';
import { pct } from './engine/format.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const fc = flag('--fc'), start = flag('--start') || CFG.START_DATE, out = flag('--out') || 'outputs', date = flag('--date');
const send = bool('--send'), noMemory = bool('--no-memory'), ai = bool('--ai') || CFG.AI_INSIGHTS;
if (!args.length) { console.error('usage: npm run monitor -- <file.xlsx|csv|pdf ...> [--fc NAME] [--start YYYY-MM-DD] [--out DIR] [--date YYYY-MM-DD] [--send] [--no-memory] [--ai]'); process.exit(2); }

await initStore();
try {
  const files = args.map((p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) }));
  const result = await runMonitor({ files, startDate: start, fcHint: fc, useMemory: !noMemory, ai, onProgress: (p) => process.stderr.write(`\r${p.step.padEnd(50)}`) });
  process.stderr.write('\n');
  const run = { id: `cli${Date.now().toString(36)}`, result, meta: { startDate: start } };
  fs.mkdirSync(out, { recursive: true });
  const overrides = await store.listOverrides();
  fs.writeFileSync(path.join(out, 'pnl_report.xlsx'), Buffer.from(await buildWorkbook(run, overrides)));
  fs.writeFileSync(path.join(out, 'anomalies.csv'), toCsv(anomalyRows(result.days)));
  const b = buildDigests({ result, date, overrides, rules: result.rules, fcsCfg: loadSettings().fcs, publicUrl: CFG.PUBLIC_URL, runId: run.id });
  fs.mkdirSync(path.join(out, 'digests'), { recursive: true });
  for (const d of [...b.digests, b.leadership]) {
    const n = d.fc.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'all_fcs';
    fs.writeFileSync(path.join(out, 'digests', `${b.date}_${n}.html`), d.html);
    fs.writeFileSync(path.join(out, 'digests', `${b.date}_${n}.txt`), d.text);
  }
  const s = result.summary;
  console.log(`${result.meta.counts.days} FC-days · ${s.fcs.length} FC(s) · ${s.firstDate}..${s.lastDate} · ${s.totals.anomalies} anomaly rows · ${result.meta.ms} ms`);
  console.log(`targets: ${result.rules._source}`);
  for (const f of s.fcs) console.log(`  ${f.fc.padEnd(10)} R${f.colours.RED} Y${f.colours.YELLOW} G${f.colours.GREEN} B${f.colours.BLUE} grey${f.colours.GREY} · clean ${f.classes.CLEAN} line-only ${f.classes.LINE_ONLY} cm1 ${f.classes.CM1_BREACH} cm2 ${f.classes.CM2_BREACH} blue ${f.classes.SUSPICIOUS_HIGH} · period CM2 ${pct(f.cm2Pct)} · latest ${f.latest.date} ${f.latest.colour}`);
  if (result.issues.length) console.log(`data issues: ${result.issues.length} (see "Data issues" sheet)`);
  console.log(`AI: ${result.meta.ai.status}`);
  console.log(`wrote ${out}/pnl_report.xlsx, ${out}/anomalies.csv, ${out}/digests/ (${b.date})`);
  if (send) {
    const d = await deliverRun(run, { date });
    console.log(`delivery: ${JSON.stringify(d.summary)}`);
    for (const r of d.results) console.log(`  ${r.fc.padEnd(10)} email ${r.email}${r.to ? ` -> ${r.to}` : ''}${r.error ? ` (${r.error})` : ''}`);
  }
  process.exit(0);
} catch (e) {
  console.error(e.userFacing ? `Error: ${e.message}` : e);
  process.exit(1);
}
