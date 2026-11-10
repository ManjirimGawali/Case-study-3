// In-process job queue (concurrency 1). Uploads return a run id immediately; the browser polls.
import { store } from '../store/index.js';
import { runMonitor, deliverRun } from '../run.js';

const q = [];
let busy = false;

export function enqueue(job) { q.push(job); pump(); return q.length; }
export const queueLength = () => q.length + (busy ? 1 : 0);

async function pump() {
  if (busy || !q.length) return;
  busy = true;
  const job = q.shift();
  try { await process_(job); } catch (e) { console.error('job failed', e); }
  busy = false;
  setImmediate(pump);
}

async function process_({ runId, files, startDate, fcHint, send, sendDate }) {
  let last = 0;
  const progress = async (p) => { const now = Date.now(); if (now - last > 400 || p.pct >= 97) { last = now; await store.updateRun(runId, { status: 'running', progress: p }); } };
  try {
    await store.updateRun(runId, { status: 'running', progress: { step: 'starting', pct: 1 } });
    const result = await runMonitor({ files, startDate, fcHint, onProgress: progress });
    let run = await store.updateRun(runId, { status: send ? 'running' : 'done', progress: { step: send ? 'sending digests' : 'done', pct: send ? 98 : 100 }, result });
    if (send) {
      const delivery = await deliverRun(run, { date: sendDate, fc: fcHint });
      await store.updateRun(runId, { status: 'done', progress: { step: 'done', pct: 100 }, delivery });
    }
  } catch (e) {
    await store.updateRun(runId, { status: 'failed', progress: { step: 'failed', pct: 100 }, error: e.userFacing ? e.message : `Unexpected error: ${e.message}` });
    if (!e.userFacing) console.error(e);
  }
}
