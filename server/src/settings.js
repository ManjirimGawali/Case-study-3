// Business settings: defaults from config/*.json, edits from the Settings page saved to data/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CFG } from './config.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const SAVED = () => path.join(CFG.DATA_DIR, 'settings.json');

export function defaults() {
  return {
    rules: read(path.join(ROOT, 'config', 'rules.json')),
    fcs: read(path.join(ROOT, 'config', 'fcs.json')),
    playbook: read(path.join(ROOT, 'config', 'playbook.json')),
  };
}

export function loadSettings() {
  const d = defaults();
  const p = SAVED();
  if (!fs.existsSync(p)) return d;
  try {
    const s = read(p);
    return { rules: s.rules || d.rules, fcs: s.fcs || d.fcs, playbook: d.playbook };
  } catch { return d; }
}

export function validateRules(rules) {
  const errs = [];
  if (!rules || typeof rules !== 'object' || !rules.lines) return ['rules.lines is missing'];
  for (const [k, l] of Object.entries(rules.lines)) {
    if (!(Number.isFinite(l.min) && Number.isFinite(l.max))) errs.push(`${k}: min and max must be numbers`);
    else if (l.min < 0 || l.max > 100 || l.min > l.max) errs.push(`${k}: need 0 <= min <= max <= 100`);
  }
  for (const k of ['cm1', 'cm2']) {
    const c = rules[k];
    if (!c || !Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min > c.max) errs.push(`${k}: min/max invalid`);
  }
  const c = rules.colour || {};
  if (!(c.red <= c.yellowLow && c.yellowLow <= c.yellowHigh && c.yellowHigh <= c.blue)) errs.push('colour thresholds must be increasing: red <= yellowLow <= yellowHigh <= blue');
  return errs;
}

export function saveSettings({ rules, fcs }) {
  const cur = loadSettings();
  const next = { rules: rules || cur.rules, fcs: fcs || cur.fcs };
  const errs = validateRules(next.rules);
  if (errs.length) { const e = new Error(errs.join('; ')); e.status = 400; throw e; }
  fs.mkdirSync(CFG.DATA_DIR, { recursive: true });
  fs.writeFileSync(SAVED(), JSON.stringify(next, null, 2));
  return loadSettings();
}

export function resetSettings() { if (fs.existsSync(SAVED())) fs.unlinkSync(SAVED()); return loadSettings(); }

// Effective target for an FC (per-FC overrides win).
export function lineTarget(rules, fc, key) {
  const o = rules.fcOverrides?.[fc]?.[key];
  return { ...rules.lines[key], ...(o || {}) };
}
