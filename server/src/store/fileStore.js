// Default store: JSON files under data/ (no database needed).
//   data/runs/<id>.json · data/memory/<fc>.json (raw past days per FC) · data/overrides.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CFG } from '../config.js';

const dir = (...p) => path.join(CFG.DATA_DIR, ...p);
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => {
  const content = JSON.stringify(v);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    try {
      fs.renameSync(tmp, p);
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EBUSY') {
        fs.writeFileSync(p, content);
        try { fs.unlinkSync(tmp); } catch {}
      } else {
        throw e;
      }
    }
  } catch {
    fs.writeFileSync(p, content);
  }
};
const safeFc = (fc) => encodeURIComponent(fc).replace(/%/g, '_');
const cache = new Map(); // id -> run (hot copies of in-flight runs)

export const fileStore = {
  kind: 'file (data/)',
  async init() { for (const d of ['runs', 'memory']) fs.mkdirSync(dir(d), { recursive: true }); },
  async createRun(meta) {
    const run = { id: crypto.randomBytes(6).toString('hex'), createdAt: new Date().toISOString(), status: 'queued', progress: { step: 'queued', pct: 0 }, meta, result: null, error: null, delivery: null };
    cache.set(run.id, run);
    writeJson(dir('runs', `${run.id}.json`), run);
    return run;
  },
  async updateRun(id, patch) {
    const run = cache.get(id) || (await this.getRun(id));
    if (!run) return null;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    if (['done', 'failed'].includes(run.status)) cache.delete(id); else cache.set(id, run);
    writeJson(dir('runs', `${id}.json`), run);
    return run;
  },
  async getRun(id) {
    if (!/^[a-f0-9]{12}$/.test(id)) return null;
    return cache.get(id) || readJson(dir('runs', `${id}.json`), null);
  },
  async listRuns() {
    return fs.readdirSync(dir('runs')).filter((f) => f.endsWith('.json')).map((f) => {
      const r = readJson(dir('runs', f), null);
      return r && { id: r.id, createdAt: r.createdAt, status: r.status, progress: r.progress, meta: r.meta, error: r.error, summary: r.result?.summary ? { totals: r.result.summary.totals, fcs: r.result.summary.fcs.length, lastDate: r.result.summary.lastDate } : null, delivery: r.delivery?.summary || null };
    }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  },
  async getMemory(fcs) {
    const out = {};
    for (const fc of fcs) out[fc] = readJson(dir('memory', `${safeFc(fc)}.json`), {});
    return out;
  },
  async upsertMemory(days) {
    const byFc = {};
    for (const d of days) (byFc[d.fc] ||= []).push(d);
    for (const [fc, list] of Object.entries(byFc)) {
      const p = dir('memory', `${safeFc(fc)}.json`);
      const m = readJson(p, {});
      for (const d of list) m[d.date] = { revenue: d.revenue, costs: d.costs, status: d.status, zeroLines: d.zeroLines || [] };
      writeJson(p, m);
    }
  },
  async clearMemory() { for (const f of fs.readdirSync(dir('memory'))) fs.unlinkSync(dir('memory', f)); },
  async listOverrides() { return readJson(dir('overrides.json'), []); },
  async addOverride(o) {
    const list = readJson(dir('overrides.json'), []);
    const item = { id: crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), ...o };
    list.push(item); writeJson(dir('overrides.json'), list);
    return item;
  },
  async deleteOverride(id) {
    const list = readJson(dir('overrides.json'), []);
    const next = list.filter((o) => o.id !== id);
    writeJson(dir('overrides.json'), next);
    return next.length !== list.length;
  },
};
