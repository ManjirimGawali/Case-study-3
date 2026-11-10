// Minimal Ollama client (local, free). Returns null on any failure: callers must have a fallback.
import { CFG } from '../config.js';

export async function ollamaAvailable() {
  try {
    const r = await fetch(`${CFG.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, reason: `Ollama HTTP ${r.status}` };
    const { models = [] } = await r.json();
    const names = models.map((m) => m.name);
    const has = names.some((n) => n === CFG.AI_MODEL || n.startsWith(`${CFG.AI_MODEL}:`) || n === `${CFG.AI_MODEL}:latest`);
    return has ? { ok: true } : { ok: false, reason: `model ${CFG.AI_MODEL} not pulled (have: ${names.join(', ') || 'none'})` };
  } catch (e) { return { ok: false, reason: `Ollama not reachable at ${CFG.OLLAMA_URL}` }; }
}

export async function chatJson({ system, user, schema, maxTokens = 400 }) {
  try {
    const r = await fetch(`${CFG.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(CFG.AI_TIMEOUT_MS),
      body: JSON.stringify({ model: CFG.AI_MODEL, stream: false, format: schema || 'json', options: { temperature: 0.2, num_predict: maxTokens, num_ctx: 4096 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const txt = body?.message?.content || '';
    try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  } catch { return null; }
}
