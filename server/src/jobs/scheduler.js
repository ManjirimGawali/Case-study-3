// Daily automatic run: at SCHEDULE_TIME, every new file in WATCH_DIR is processed and digests are sent.
// Processed files move to WATCH_DIR/processed/. "Run now" calls the same function.
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { store } from '../store/index.js';
import { enqueue } from './queue.js';

let lastRunDay = null;
const OK = /\.(xlsx|csv|tsv|pdf)$/i;

export async function processInbox({ send = true } = {}) {
  fs.mkdirSync(path.join(CFG.WATCH_DIR, 'processed'), { recursive: true });
  const files = fs.readdirSync(CFG.WATCH_DIR).filter((f) => OK.test(f) && !f.startsWith('.'));
  const runs = [];
  for (const f of files) {
    const src = path.join(CFG.WATCH_DIR, f);
    const buffer = fs.readFileSync(src);
    const run = await store.createRun({ files: [f], startDate: CFG.START_DATE, trigger: 'schedule', send });
    enqueue({ runId: run.id, files: [{ name: f, buffer }], startDate: CFG.START_DATE, send });
    fs.renameSync(src, path.join(CFG.WATCH_DIR, 'processed', `${new Date().toISOString().slice(0, 10)}_${f}`));
    runs.push(run.id);
  }
  return { files, runs };
}

export function startScheduler() {
  if (!CFG.SCHEDULE_ENABLED) return false;
  const [hh, mm] = CFG.SCHEDULE_TIME.split(':').map(Number);
  setInterval(async () => {
    const now = new Date();
    const today = now.toDateString();
    if (now.getHours() === hh && now.getMinutes() === mm && lastRunDay !== today) {
      lastRunDay = today;
      const r = await processInbox().catch((e) => ({ error: e.message }));
      console.log(`[schedule] ${now.toISOString()} inbox:`, r);
    }
  }, 20000).unref();
  return true;
}
