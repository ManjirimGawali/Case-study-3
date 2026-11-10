// Express API + built React UI on one port.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { CFG, ROOT } from './config.js';
import { initStore, store } from './store/index.js';
import { router } from './routes/api.js';
import { startScheduler } from './jobs/scheduler.js';
import { channels } from './deliver/index.js';
import { ollamaAvailable } from './ai/ollama.js';

const app = express();
app.get('/api/health', async (req, res) => res.json({
  ok: true, store: store.kind, startDate: CFG.START_DATE, delivery: channels(),
  ai: CFG.AI_INSIGHTS ? { enabled: true, model: CFG.AI_MODEL, ...(await ollamaAvailable()) } : { enabled: false },
  schedule: CFG.SCHEDULE_ENABLED ? { time: CFG.SCHEDULE_TIME, dir: path.relative(ROOT, CFG.WATCH_DIR) } : null,
}));
app.use('/api', router);
app.use('/api', (req, res) => res.status(404).json({ error: `No API route ${req.method} ${req.path}` }));

const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, req, res, next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${CFG.MAX_UPLOAD_MB} MB).` : err.type === 'entity.parse.failed' ? 'Request body is not valid JSON.' : err.message;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: msg });
});

await initStore();
fs.mkdirSync(CFG.WATCH_DIR, { recursive: true });
const sched = startScheduler();
app.listen(CFG.PORT, () => {
  console.log(`FC P&L Monitor on http://localhost:${CFG.PORT}  (store: ${store.kind})`);
  const ch = channels();
  console.log(`  delivery: outbox${ch.email ? ` + email via ${ch.email}` : ' only (set SMTP_HOST to email)'}${ch.slack ? ' + Slack' : ''}${ch.redirectTo ? ` (all mail redirected to ${ch.redirectTo})` : ''}`);
  console.log(`  AI insights: ${CFG.AI_INSIGHTS ? CFG.AI_MODEL : 'off (template)'} · schedule: ${sched ? `daily ${CFG.SCHEDULE_TIME} on ${CFG.WATCH_DIR}` : 'off'}`);
  if (!fs.existsSync(dist)) console.log('  UI not built: run "npm run build", or "npm run dev" for the Vite dev server on :5175');
});
