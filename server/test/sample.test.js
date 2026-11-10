// End-to-end on the provided sample (PDF export of the sheet) and the generated digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from '../src/run.js';
import { buildDigests } from '../src/digest/build.js';
import { buildWorkbook } from '../src/report/workbook.js';
import { defaults } from '../src/settings.js';
import ExcelJS from 'exceljs';

const TD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-data');
const f = (n) => ({ name: n, buffer: fs.readFileSync(path.join(TD, n)) });

test('provided sample PDF: 100 days, red on days 31, 39, 69 with hand-checked CM values', async () => {
  const r = await runMonitor({ files: [f('sample_dayWisePnL.pdf')], fcHint: 'FC-PUNE', useMemory: false, ai: false });
  assert.equal(r.days.length, 100);
  const red = r.days.filter((d) => d.colour === 'RED');
  assert.deepEqual(red.map((d) => d.day), [31, 39, 69]);
  const d69 = r.days.find((d) => d.day === 69);
  assert.equal(d69.date, '2026-07-08');
  const cm1 = 91879 - 27943 - 7554, cm2 = cm1 - (12464 + 18315 + 4346 + 12452);
  assert.equal(d69.cm1, cm1); assert.equal(d69.cm2, cm2);
  assert.equal(d69.cm1Pct, Math.round((cm1 / 91879) * 10000) / 100); // 61.37
  assert.equal(d69.cm2Pct, Math.round((cm2 / 91879) * 10000) / 100); // 9.58
  assert.equal(r.summary.fcs[0].colours.BLUE, 0);
  assert.equal(r.summary.fcs[0].colours.YELLOW, 11);
});

test('multi-FC sample: all four required day types on the demo date + digest + workbook', async () => {
  const r = await runMonitor({ files: [f('multi_fc.xlsx')], useMemory: false, ai: false });
  const demo = Object.fromEntries(r.days.filter((d) => d.date === '2026-08-08').map((d) => [d.fc, d]));
  assert.equal(demo['FC-CHN'].dayClass, 'CLEAN');
  assert.equal(demo['FC-KOL'].dayClass, 'CM2_BREACH');
  assert.equal(demo['FC-BLR'].dayClass, 'LINE_ONLY');
  assert.equal(demo['FC-DELHI'].dayClass, 'SUSPICIOUS_HIGH');
  assert.equal(demo['FC-HYD'].dayClass, 'DATA_ISSUE');
  const { digests, leadership } = buildDigests({ result: r, date: '2026-08-08', overrides: [], rules: r.rules, fcsCfg: defaults().fcs, publicUrl: 'http://x', runId: 'abc' });
  assert.equal(digests.length, 6);
  const kol = digests.find((d) => d.fc === 'FC-KOL');
  assert.match(kol.subject, /RED/); assert.match(kol.html, /#dc2626/); assert.equal(kol.email, 'kol.manager@example.com');
  assert.match(leadership.subject, /1 RED/);
  // overrides take an issue out of the digest's top list
  const o = [{ id: 'o1', fc: 'FC-BLR', date: '2026-08-08', line: 'overheads', type: 'explained', note: 'annual AMC bill' }];
  const blr = buildDigests({ result: r, date: '2026-08-08', overrides: o, rules: r.rules, fcsCfg: defaults().fcs, publicUrl: 'http://x', runId: 'abc' }).digests.find((d) => d.fc === 'FC-BLR');
  assert.equal(blr.issues, 0); assert.match(blr.text, /Acknowledged: Overheads \(explained: annual AMC bill\)/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildWorkbook({ id: 'abc', result: r }, []));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Status grid', 'Daily P&L', 'Anomalies', 'Insights', 'Data issues', 'Targets']);
  assert.deepEqual(wb.getWorksheet('Anomalies').getRow(1).values.slice(1, 7), ['Date', 'FC', 'Line Item', '% of Revenue', 'Target Range', 'Status']);
});
