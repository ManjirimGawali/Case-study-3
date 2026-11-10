// Upload -> clean FC-day records + data issues. Never throws on a bad row; throws InputError
// (clear message) only when nothing usable can be read.
import path from 'node:path';
import { readTables, InputError } from './read.js';
import { findHeader, COST_KEYS, LABELS } from './headers.js';
import { parseNumber, parseDate, parseDay, addDays } from './values.js';
import { detectTargets } from './targets.js';

export { InputError };

const GENERIC_SHEET = /^(sheet\d*|data|daily|day wise.*|p&l|pnl|report|export|table\d*)$/i;

export function fcFromFilename(name) {
  const stem = path.basename(String(name || ''), path.extname(String(name || ''))).replace(/\.(xlsx|csv)\s*-.*$/i, '');
  return stem.replace(/[_]+/g, ' ').trim() || 'FC';
}

const isTotalRow = (row, map) => {
  const first = row.find((c) => c !== null && c !== undefined && String(c).trim() !== '');
  return typeof first === 'string' && /^(grand\s+)?totals?\b|^sub\s*total|^average|^avg\b/i.test(first.trim());
};

export async function loadDataset(files, { startDate, fcHint } = {}) {
  if (!files?.length) throw new InputError('No file uploaded. Choose a .xlsx or .csv with the daily P&L.');
  const records = new Map(); // key fc|date
  const issues = [];
  const sources = [];
  let targets = null;

  for (const f of files) {
    const { kind, tables } = await readTables(f.buffer, f.name);
    if (!targets) targets = detectTargets(tables);
    const dataTables = tables.map((t) => ({ t, h: findHeader(t.rows) })).filter((x) => x.h);
    if (!dataTables.length) {
      const seen = tables.flatMap((t) => (t.rows.find((r) => r && r.filter((c) => c !== null && String(c).trim()).length >= 3) || []).filter(Boolean).map(String)).slice(0, 12);
      throw new InputError(`"${f.name}": couldn't find the P&L header row (needs Revenue plus cost columns like Manpower, Packaging, Power & Fuel, FC Rent, Equipment Rentals, Overheads).${seen.length ? ` First row seen: ${seen.join(' | ')}` : ' The file has no readable rows.'}`);
    }
    for (const { t, h } of dataTables) {
      const { map } = h;
      const missingCols = COST_KEYS.filter((k) => map[k] === undefined);
      if (missingCols.length) issues.push({ level: 'warn', source: `${f.name} / ${t.name}`, issue: 'MISSING_COLUMN', detail: `No column for ${missingCols.map((k) => LABELS[k]).join(', ')}. Those days are marked incomplete.` });
      if (map.date === undefined && map.day === undefined) throw new InputError(`"${f.name}" / ${t.name}: no Date or Day column found.`);
      const tableFc = map.fc !== undefined ? null
        : dataTables.length > 1 || (!GENERIC_SHEET.test(t.name.trim()) && kind === 'xlsx' && t.name !== f.name) ? t.name.trim()
        : (fcHint || fcFromFilename(f.name));
      let used = 0;
      for (let r = h.row + 1; r < t.rows.length; r++) {
        const row = t.rows[r] || [];
        if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue;
        if (isTotalRow(row, map)) continue;
        const where = `${t.name} row ${r + 1}`;
        const fc = tableFc ?? String(row[map.fc] ?? '').trim();
        if (!fc) { issues.push({ level: 'error', source: where, issue: 'NO_FC', detail: 'FC name is blank. Row skipped.' }); continue; }
        let date = map.date !== undefined ? parseDate(row[map.date], startDate) : null;
        let day = map.day !== undefined ? parseDay(row[map.day]) : null;
        if (!date && day) date = addDays(startDate, day - 1);
        if (!date) {
          const raw = map.date !== undefined ? row[map.date] : row[map.day];
          // A row with no date and no revenue is probably a note/footer: skip quietly.
          const revCell = parseNumber(row[map.revenue]);
          if (revCell.missing) continue;
          issues.push({ level: 'error', source: where, fc, issue: 'BAD_DATE', detail: `Couldn't read the date "${raw ?? ''}". Row skipped.` });
          continue;
        }
        const rev = parseNumber(row[map.revenue]);
        const costs = {};
        const rowIssues = [];
        for (const k of COST_KEYS) {
          if (map[k] === undefined) { costs[k] = null; continue; }
          const n = parseNumber(row[map[k]]);
          if (n.invalid) rowIssues.push(`${LABELS[k]} "${n.raw}" is not a number`);
          else if (n.value !== null && n.value < 0) rowIssues.push(`${LABELS[k]} is negative (${n.value})`);
          costs[k] = n.value;
        }
        if (rev.invalid) rowIssues.push(`Revenue "${rev.raw}" is not a number`);
        let status = 'OK';
        if (rev.value === null || rev.value <= 0) status = 'NO_REVENUE';
        else if (COST_KEYS.some((k) => costs[k] === null)) status = 'INCOMPLETE';
        const zeroLines = COST_KEYS.filter((k) => costs[k] === 0);
        const key = `${fc}|${date}`;
        if (records.has(key)) issues.push({ level: 'warn', source: where, fc, date, issue: 'DUPLICATE', detail: `${fc} ${date} appears more than once. The later row (${where}) is used.` });
        if (status === 'NO_REVENUE') issues.push({ level: 'error', source: where, fc, date, issue: 'NO_REVENUE', detail: rev.value === null ? 'Revenue is blank, so % of revenue cannot be computed.' : `Revenue is ${rev.value}. % of revenue cannot be computed.` });
        if (status === 'INCOMPLETE') issues.push({ level: 'error', source: where, fc, date, issue: 'INCOMPLETE', detail: `Missing ${COST_KEYS.filter((k) => costs[k] === null).map((k) => LABELS[k]).join(', ')}. Margins are not computed (a missing cost would fake a high margin).` });
        for (const d of rowIssues) issues.push({ level: 'error', source: where, fc, date, issue: 'BAD_VALUE', detail: d });
        if (zeroLines.length) issues.push({ level: 'warn', source: where, fc, date, issue: 'ZERO_COST', detail: `${zeroLines.map((k) => LABELS[k]).join(', ')} booked as 0. Check whether it's unbooked.` });
        records.set(key, { fc, date, day, revenue: rev.value, costs, status, zeroLines, source: where });
        used++;
      }
      sources.push({ file: f.name, table: t.name, kind, headerRow: h.row + 1, rows: used, fc: tableFc || '(FC column)' });
    }
  }
  const days = [...records.values()].sort((a, b) => a.fc.localeCompare(b.fc) || a.date.localeCompare(b.date));
  if (!days.length) {
    const first = issues.filter((i) => i.level === 'error').slice(0, 5).map((i) => `${i.source}: ${i.detail}`);
    throw new InputError(`0 usable days found.${first.length ? ` First problems: ${first.join(' · ')}` : ' The header row was found but there are no data rows under it.'}`);
  }
  return { days, issues, sources, targets };
}
