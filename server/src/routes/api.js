// REST API. Long work is queued; every handler returns a clear JSON error instead of crashing.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { CFG, ROOT } from '../config.js';
import { store } from '../store/index.js';
import { enqueue, queueLength } from '../jobs/queue.js';
import { processInbox } from '../jobs/scheduler.js';
import { deliverRun } from '../run.js';
import { buildDigests, managerFor } from '../digest/build.js';
import { buildWorkbook, anomalyRows, toCsv } from '../report/workbook.js';
import { withOverrides } from '../engine/overrides.js';
import { ask } from '../ai/ask.js';
import { loadSettings, saveSettings, resetSettings } from '../settings.js';
import { channels } from '../deliver/index.js';
import { parseDate } from '../ingest/values.js';
import { lineItemInsight } from '../engine/analyst.js';

export const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CFG.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const SAMPLES = {
  multi: { files: ['multi_fc.xlsx'], label: 'Sample + extended data (6 FCs, 100 days)' },
  pune: { files: ['sample_pune.csv'], fcHint: 'FC-PUNE', label: 'Provided sample only (FC-PUNE, 100 days)' },
};

async function startRun({ files, startDate, fcHint, send, trigger }) {
  const run = await store.createRun({ files: files.map((f) => f.name), startDate, fcHint: fcHint || null, trigger, send: !!send });
  enqueue({ runId: run.id, files, startDate, fcHint, send });
  return run;
}

function validStart(s) { return s ? parseDate(s) : CFG.START_DATE; }

router.post('/runs', upload.array('files', 10), wrap(async (req, res) => {
  const files = (req.files || []).map((f) => ({ name: f.originalname, buffer: f.buffer }));
  if (!files.length) return bad(res, 'No file received. Choose a .xlsx or .csv with the daily P&L (Day/Date, Revenue, cost lines).');
  const empty = files.find((f) => !f.buffer.length);
  if (empty) return bad(res, `"${empty.name}" is empty (0 bytes).`);
  const fc = (req.body.fc || '').trim();
  if (!fc) return bad(res, 'FC center name is mandatory. Please provide the FC center name (e.g. FC-Gurugram).');
  if (!req.body.startDate || !req.body.startDate.trim()) return bad(res, 'Day 1 date is mandatory. Please provide the start date (YYYY-MM-DD).');
  const startDate = parseDate(req.body.startDate.trim());
  if (!startDate) return bad(res, `Start date "${req.body.startDate}" isn't a valid date. Use YYYY-MM-DD.`);
  const send = req.body.send === 'true';
  const settings = loadSettings();
  const mgr = managerFor(settings.fcs, fc);
  if (send && (!mgr || !mgr.email)) {
    return bad(res, `Set mail ID for the given FC center (${fc}) in Targets & managers under Settings before sending digests.`);
  }
  const run = await startRun({ files, startDate, fcHint: fc, send, trigger: 'upload' });
  res.status(202).json({ id: run.id, queued: queueLength() });
}));

router.get('/samples', (req, res) => res.json(Object.entries(SAMPLES).map(([id, s]) => ({ id, label: s.label, available: s.files.every((f) => fs.existsSync(path.join(ROOT, 'test-data', f))) }))));

router.post('/runs/sample', express.json(), wrap(async (req, res) => {
  const s = SAMPLES[req.body?.sample || 'multi'];
  if (!s) return bad(res, 'Unknown sample.');
  const missing = s.files.filter((f) => !fs.existsSync(path.join(ROOT, 'test-data', f)));
  if (missing.length) return bad(res, `Sample file missing: ${missing.join(', ')}. Run "npm run generate" first.`, 404);
  const files = s.files.map((f) => ({ name: f, buffer: fs.readFileSync(path.join(ROOT, 'test-data', f)) }));
  const run = await startRun({ files, startDate: CFG.START_DATE, fcHint: s.fcHint, send: false, trigger: 'sample' });
  res.status(202).json({ id: run.id });
}));

router.get('/runs', wrap(async (req, res) => res.json(await store.listRuns())));

async function loadRun(req, res) {
  const run = await store.getRun(req.params.id);
  if (!run) { bad(res, 'Run not found. It may have been deleted or the link is wrong.', 404); return null; }
  return run;
}
async function loadDone(req, res) {
  const run = await loadRun(req, res);
  if (!run) return null;
  if (run.status !== 'done') { bad(res, run.status === 'failed' ? run.error : 'This run is still processing.', 409); return null; }
  return run;
}

// Run status + light view (grid cells, summary). Full day rows come from /days.
router.get('/runs/:id', wrap(async (req, res) => {
  const run = await loadRun(req, res); if (!run) return;
  const { result, ...rest } = run;
  if (!result) return res.json(rest);
  const grid = result.days.map((d) => [d.fc, d.date, d.colour, d.cm2Pct, d.dayClass, d.anomalies.length]);
  res.json({ ...rest, result: { meta: result.meta, rules: result.rules, summary: result.summary, issues: result.issues.slice(0, 500), issueCount: result.issues.length, grid } });
}));

router.get('/runs/:id/days', wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  const { fc, from, to, date } = req.query;
  let days = run.result.days.filter((d) => (!fc || d.fc === fc) && (!date || d.date === date) && (!from || d.date >= from) && (!to || d.date <= to));
  days = withOverrides(days, await store.listOverrides());
  res.json(days.slice(0, 2000));
}));

router.get('/runs/:id/anomalies', wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  const { fc, severity, line, status, date, limit = 2000 } = req.query;
  const days = withOverrides(run.result.days, await store.listOverrides());
  const rows = days.flatMap((d) => d.anomalies.map((a) => ({ ...a, insight: lineItemInsight(a, d), dayInsight: d.insight, colour: d.colour, dayClass: d.dayClass, insightSource: d.insightSource })))
    .filter((a) => (!fc || a.fc.toLowerCase() === fc.toLowerCase()) && (!severity || a.severity === severity) && (!line || a.line === line) && (!status || a.status === status) && (!date || a.date === date))
    .sort((a, b) => b.date.localeCompare(a.date) || ({ HIGH: 3, MED: 2, LOW: 1 }[b.severity] - { HIGH: 3, MED: 2, LOW: 1 }[a.severity]) || (b.impactRs || 0) - (a.impactRs || 0));
  res.json({ total: rows.length, rows: rows.slice(0, Number(limit)) });
}));

router.get('/runs/:id/digests', wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  const date = req.query.date || run.result.summary.lastDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 'date must be YYYY-MM-DD');
  const b = buildDigests({ result: run.result, date, overrides: await store.listOverrides(), rules: run.result.rules, fcsCfg: loadSettings().fcs, publicUrl: CFG.PUBLIC_URL, runId: run.id });
  const isSingleFc = run.result.summary.fcs.length === 1;
  const digests = isSingleFc ? b.digests : [...b.digests, b.leadership];
  res.json({ date: b.date, channels: channels(), digests: digests.map(({ html, ...d }) => ({ ...d, html })) });
}));

router.post('/runs/:id/send', express.json(), wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  if (run.sending) return bad(res, 'Digests are already being sent for this run.', 409);
  const date = req.body?.date || run.result.summary.lastDate;
  const fc = req.body?.fc || (run.result.summary.fcs.length === 1 ? run.result.summary.fcs[0].fc : null);
  const settings = loadSettings();
  if (fc) {
    const mgr = managerFor(settings.fcs, fc);
    if (!mgr || !mgr.email) {
      return bad(res, `Set mail ID for the given FC center (${fc}) in Targets & managers under Settings before sending digests.`);
    }
  }
  await store.updateRun(run.id, { sending: true });
  res.status(202).json({ sending: true, date });
  try {
    const delivery = await deliverRun(run, { date, fc });
    await store.updateRun(run.id, { sending: false, delivery });
  } catch (e) {
    await store.updateRun(run.id, { sending: false, delivery: { summary: { at: new Date().toISOString(), date, error: e.message }, results: [] } });
  }
}));

router.post('/runs/:id/ask', express.json(), wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  const q = String(req.body?.question || '').trim();
  if (!q) return bad(res, 'Type a question, e.g. "Why was FC-PUNE red on Jul 8?"');
  if (q.length > 500) return bad(res, 'Question is too long (max 500 characters).');
  const a = await ask(q, run);
  res.json({ ...a, days: (a.days || []).map((d) => ({ fc: d.fc, date: d.date, colour: d.colour, cm2Pct: d.cm2Pct })) });
}));

router.get('/runs/:id/report.xlsx', wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  const buf = await buildWorkbook(run, await store.listOverrides());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="fc_pnl_report_${run.result.summary.lastDate}_${run.id}.xlsx"`);
  res.send(Buffer.from(buf));
}));

router.get('/runs/:id/anomalies.csv', wrap(async (req, res) => {
  const run = await loadDone(req, res); if (!run) return;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="anomalies_${run.id}.csv"`);
  res.send(toCsv(anomalyRows(withOverrides(run.result.days, await store.listOverrides()))));
}));

// Overrides (explained / snooze)
router.get('/overrides', wrap(async (req, res) => res.json(await store.listOverrides())));
router.post('/overrides', express.json(), wrap(async (req, res) => {
  const { fc, date, line, type, note, until } = req.body || {};
  if (!fc || !line || !['explained', 'snooze'].includes(type)) return bad(res, 'Need fc, line and type (explained or snooze).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return bad(res, 'Need date as YYYY-MM-DD.');
  if (type === 'snooze' && !/^\d{4}-\d{2}-\d{2}$/.test(until || '')) return bad(res, 'Snooze needs an "until" date (YYYY-MM-DD).');
  if (type === 'explained' && !String(note || '').trim()) return bad(res, 'Add a short note explaining the anomaly.');
  res.status(201).json(await store.addOverride({ fc, date, line, type, note: String(note || '').slice(0, 300), until: until || null }));
}));
router.delete('/overrides/:id', wrap(async (req, res) => res.json({ deleted: await store.deleteOverride(req.params.id) })));

// Settings (targets, colour bands, managers)
router.get('/settings', (req, res) => { const s = loadSettings(); res.json({ rules: s.rules, fcs: s.fcs }); });
router.put('/settings', express.json({ limit: '1mb' }), wrap(async (req, res) => { const s = saveSettings(req.body || {}); res.json({ rules: s.rules, fcs: s.fcs }); }));
router.delete('/settings', (req, res) => { const s = resetSettings(); res.json({ rules: s.rules, fcs: s.fcs }); });

router.post('/inbox/run-now', wrap(async (req, res) => res.json(await processInbox({ send: true }))));
router.delete('/memory', wrap(async (req, res) => { await store.clearMemory(); res.json({ cleared: true }); }));
