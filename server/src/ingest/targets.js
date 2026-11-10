// Detect a target-range block inside an uploaded workbook, in either orientation:
//   vertical:   | Manpower | 25% | 30% |   or   | Manpower | 25% - 30% |
//   horizontal: a row labelled Min / Max / Target under (or near) a row of line-item headers.
import { matchHeader, COST_KEYS } from './headers.js';
import { parseNumber } from './values.js';

const TARGET_KEYS = [...COST_KEYS, 'cm1', 'cm2'];

function parseRange(v) {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === 'object' && 'result' in v ? v.result : v).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*%?\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)\s*%?$/i);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}
const num = (v) => {
  if (typeof v === 'string' && /%\s*$/.test(v)) { const n = parseNumber(v.replace('%', '')); return n.value; }
  return parseNumber(v).value;
};

function scale(found) {
  const vals = Object.values(found).flat();
  if (vals.length && vals.every((x) => Math.abs(x) <= 1)) for (const k of Object.keys(found)) found[k] = found[k].map((x) => +(x * 100).toFixed(4));
  for (const k of Object.keys(found)) found[k].sort((a, b) => a - b);
  return found;
}

function vertical(rows) {
  const found = {};
  for (const row of rows) {
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const k = matchHeader(row[c]);
      if (!k || !TARGET_KEYS.includes(k) || found[k]) continue;
      const rest = row.slice(c + 1, c + 5).filter((x) => x !== null && x !== undefined && String(x).trim() !== '');
      const r = rest.length ? parseRange(rest[0]) : null;
      if (r) { found[k] = r; break; }
      const nums = rest.map(num).filter((x) => x !== null && Number.isFinite(x));
      if (nums.length >= 2 && nums[0] <= 100 && nums[1] <= 100) { found[k] = [nums[0], nums[1]]; break; }
    }
  }
  return found;
}

function horizontal(rows) {
  for (let h = 0; h < rows.length; h++) {
    const map = {};
    (rows[h] || []).forEach((cell, c) => { const k = matchHeader(cell); if (k && TARGET_KEYS.includes(k) && map[k] === undefined) map[k] = c; });
    if (Object.keys(map).length < 3) continue;
    let minRow = null, maxRow = null, rangeRow = null;
    for (let r = h + 1; r < Math.min(rows.length, h + 400); r++) {
      const label = (rows[r] || []).slice(0, 2).map((x) => String(x ?? '').toLowerCase()).join(' ');
      if (/\bmin/.test(label)) minRow = rows[r];
      else if (/\bmax/.test(label)) maxRow = rows[r];
      else if (/target|range|benchmark|norm/.test(label)) rangeRow = rows[r];
    }
    const found = {};
    for (const [k, c] of Object.entries(map)) {
      if (rangeRow && parseRange(rangeRow[c])) found[k] = parseRange(rangeRow[c]);
      else if (minRow && maxRow) {
        const a = num(minRow[c]), b = num(maxRow[c]);
        if (a !== null && b !== null) found[k] = [a, b];
      }
    }
    if (Object.keys(found).length >= 3) return found;
  }
  return {};
}

export function detectTargets(tables) {
  for (const t of tables) {
    for (const fn of [horizontal, vertical]) {
      const found = fn(t.rows);
      const lines = COST_KEYS.filter((k) => found[k]);
      if (lines.length >= 3) {
        scale(found);
        const out = { source: `${fn.name} target block in "${t.name}"`, lines: {} };
        for (const k of lines) out.lines[k] = { min: found[k][0], max: found[k][1] };
        if (found.cm1) out.cm1 = { min: found.cm1[0], max: found.cm1[1] };
        if (found.cm2) out.cm2 = { min: found.cm2[0], max: found.cm2[1] };
        return out;
      }
    }
  }
  return null;
}
