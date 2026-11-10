// One monitor run: ingest -> compute/rules/analyst -> writer (optional LLM) -> result.
// Delivery is a separate step (deliverRun) so a failed SMTP never loses the analysis.
import { loadDataset } from './ingest/index.js';
import { analyseAll, summarise } from './engine/index.js';
import { writeInsight } from './ai/writer.js';
import { ollamaAvailable } from './ai/ollama.js';
import { buildDigests } from './digest/build.js';
import { deliver } from './deliver/index.js';
import { loadSettings } from './settings.js';
import { store } from './store/index.js';
import { CFG } from './config.js';

export function effectiveRules(base, targets) {
  const rules = structuredClone(base);
  rules._source = 'settings (config/rules.json or Settings page)';
  if (targets) {
    for (const [k, v] of Object.entries(targets.lines)) rules.lines[k] = { ...rules.lines[k], min: v.min, max: v.max };
    if (targets.cm1) Object.assign(rules.cm1, targets.cm1);
    if (targets.cm2) Object.assign(rules.cm2, targets.cm2);
    rules._source = `uploaded workbook: ${targets.source}`;
  }
  return rules;
}

export async function runMonitor({ files, startDate = CFG.START_DATE, fcHint, settings = loadSettings(), useMemory = false, ai = CFG.AI_INSIGHTS, onProgress = () => {} }) {
  const t0 = Date.now();
  onProgress({ step: 'reading file', pct: 5 });
  const data = await loadDataset(files, { startDate, fcHint });
  const rules = effectiveRules(settings.rules, data.targets);
  const fcs = [...new Set(data.days.map((d) => d.fc))];
  const memory = useMemory ? await store.getMemory(fcs) : {};
  const overrides = await store.listOverrides();
  onProgress({ step: `analysing ${data.days.length} FC-days`, pct: 20 });
  const days = analyseAll({ days: data.days, rules, playbook: settings.playbook, memory, overrides, onProgress: (n) => n % 500 === 0 && onProgress({ step: `analysing ${n}/${data.days.length}`, pct: 20 + Math.round((n / data.days.length) * 40) }) });

  // Writer agent (optional local LLM). Most recent flagged days first; capped for speed.
  const ai_ = { enabled: ai, used: 0, rejected: 0, skipped: 0, status: ai ? null : 'off (template insights)' };
  const flagged = days.filter((d) => d.facts).sort((a, b) => b.date.localeCompare(a.date));
  if (ai && flagged.length) {
    const avail = await ollamaAvailable();
    if (!avail.ok) ai_.status = `unavailable: ${avail.reason}. Template insights used`;
    else {
      const todo = flagged.slice(0, CFG.AI_MAX_INSIGHTS);
      ai_.skipped = flagged.length - todo.length;
      let i = 0;
      for (const d of todo) {
        onProgress({ step: `writing insights ${++i}/${todo.length} (local AI)`, pct: 60 + Math.round((i / todo.length) * 35) });
        const w = await writeInsight(d.facts, d.insight);
        if (w.source === 'llm') { d.insight = w.text; d.insightSource = 'llm'; ai_.used++; } else { d.insightNote = w.note; ai_.rejected++; }
      }
      ai_.status = `${CFG.AI_MODEL}: ${ai_.used} written, ${ai_.rejected} kept as template${ai_.skipped ? `, ${ai_.skipped} older days templated (AI_MAX_INSIGHTS)` : ''}`;
    }
  }
  const summary = summarise(days);
  onProgress({ step: 'saving', pct: 97 });
  if (useMemory) await store.upsertMemory(data.days);
  return {
    meta: { files: files.map((f) => f.name), startDate, fcHint: fcHint || null, ms: Date.now() - t0, counts: { days: days.length, fcs: fcs.length, anomalies: summary.totals.anomalies, memoryDaysUsed: Object.values(memory).reduce((n, m) => n + Object.keys(m).length, 0) }, sources: data.sources, ai: ai_ },
    rules, days, issues: data.issues, summary,
  };
}

export async function deliverRun(run, { date, fc, onProgress } = {}) {
  const settings = loadSettings();
  const overrides = await store.listOverrides();
  const built = buildDigests({ result: run.result, date, overrides, rules: run.result.rules, fcsCfg: settings.fcs, publicUrl: CFG.PUBLIC_URL, runId: run.id });
  let digestsToSend = built.digests;
  const targetFc = fc || (run.result.summary.fcs.length === 1 ? run.result.summary.fcs[0].fc : null);
  if (targetFc) {
    const matched = built.digests.filter((d) => d.fc.toLowerCase() === targetFc.toLowerCase());
    digestsToSend = matched.length ? matched : built.digests;
  }
  const isSingleFc = run.result.summary.fcs.length === 1 || !!targetFc;
  const all = isSingleFc ? digestsToSend : [...digestsToSend, built.leadership];
  return deliver({ runId: run.id, digests: all, onProgress });
}
