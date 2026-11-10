// Downloadable outputs: a colour-filled .xlsx and the anomaly log as .csv.
import ExcelJS from 'exceljs';
import { COST_KEYS } from '../ingest/headers.js';
import { lineTarget } from '../settings.js';
import { DAY_CLASS_LABEL } from '../engine/rules.js';
import { withOverrides } from '../engine/overrides.js';
import { lineItemInsight } from '../engine/analyst.js';

const FILL = { RED: 'FFDC2626', YELLOW: 'FFFBBF24', GREEN: 'FF16A34A', BLUE: 'FF1D4ED8', GREY: 'FF9CA3AF' };
const FONT_ON = { RED: 'FFFFFFFF', YELLOW: 'FF000000', GREEN: 'FFFFFFFF', BLUE: 'FFFFFFFF', GREY: 'FFFFFFFF' };
const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
const head = (ws) => { const r = ws.getRow(1); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = fill('FF0A0A0A'); ws.views = [{ state: 'frozen', ySplit: 1 }]; };
const pctFmt = '0.0"%"';
const inrFmt = '#,##,##0';

export function anomalyRows(days) {
  const out = [];
  for (const d of days) for (const a of d.anomalies) out.push({
    Date: a.date, FC: a.fc, 'Line Item': a.line, '% of Revenue': a.pct, 'Target Range': a.target, Status: a.status,
    'Deviation (pp)': a.deviationPp, 'Impact (₹)': a.impactRs, Severity: a.severity,
    Override: a.override ? `${a.override.type}${a.override.note ? `: ${a.override.note}` : ''}` : '',
    Insight: lineItemInsight(a, d) || (a.kind === 'data' ? (d.dataNote || 'Data problem: see Data issues') : ''),
  });
  return out;
}

export function toCsv(rows) {
  if (!rows.length) return 'Date,FC,Line Item,% of Revenue,Target Range,Status\n';
  const cols = Object.keys(rows[0]);
  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n')}\n`;
}

export async function buildWorkbook(run, overrides = []) {
  const { result } = run;
  const rules = result.rules;
  const days = withOverrides(result.days, overrides);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FC P&L Monitor';

  // Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [{ header: 'FC', width: 14 }, { header: 'Days', width: 7 }, { header: 'Red', width: 7 }, { header: 'Yellow', width: 8 }, { header: 'Green', width: 8 }, { header: 'Blue', width: 7 }, { header: 'No data', width: 9 }, { header: 'Clean', width: 7 }, { header: 'Line-only', width: 10 }, { header: 'CM1 breach', width: 11 }, { header: 'CM2 breach', width: 11 }, { header: 'Suspicious high', width: 15 }, { header: 'Anomaly rows', width: 13 }, { header: 'Period CM2 %', width: 13 }, { header: 'Latest date', width: 12 }, { header: 'Latest colour', width: 13 }];
  head(s);
  for (const f of result.summary.fcs) {
    const r = s.addRow([f.fc, f.days, f.colours.RED, f.colours.YELLOW, f.colours.GREEN, f.colours.BLUE, f.colours.GREY, f.classes.CLEAN, f.classes.LINE_ONLY, f.classes.CM1_BREACH, f.classes.CM2_BREACH, f.classes.SUSPICIOUS_HIGH, f.anomalies, f.cm2Pct, f.latest.date, f.latest.colour]);
    r.getCell(14).numFmt = pctFmt;
    r.getCell(16).fill = fill(FILL[f.latest.colour]); r.getCell(16).font = { color: { argb: FONT_ON[f.latest.colour] }, bold: true };
  }
  const T = result.summary.totals;
  const tr = s.addRow(['All FCs', T.days, T.colours.RED, T.colours.YELLOW, T.colours.GREEN, T.colours.BLUE, T.colours.GREY, T.classes.CLEAN, T.classes.LINE_ONLY, T.classes.CM1_BREACH, T.classes.CM2_BREACH, T.classes.SUSPICIOUS_HIGH, T.anomalies]);
  tr.font = { bold: true };
  s.addRow([]);
  s.addRow([`Files: ${result.meta.files.join(', ')} · ${result.meta.counts.days} FC-days · ${result.summary.firstDate} to ${result.summary.lastDate}`]);
  s.addRow([`Targets: ${rules._source || 'settings'}. Colour: Red CM2 < ${rules.colour.red}% · Yellow ${rules.colour.red}–${rules.colour.yellowLow}% or ${rules.colour.yellowHigh}–${rules.colour.blue}% · Green ${rules.colour.yellowLow}–${rules.colour.yellowHigh}% · Blue ≥ ${rules.colour.blue}%`]);

  // Status grid
  const g = wb.addWorksheet('Status grid');
  const dates = [...new Set(days.map((d) => d.date))].sort();
  g.columns = [{ header: 'FC', width: 12 }, ...dates.map((d) => ({ header: d.slice(5), width: 6 }))];
  head(g);
  const idx = new Map(days.map((d) => [`${d.fc}|${d.date}`, d]));
  for (const f of result.summary.fcs) {
    const r = g.addRow([f.fc, ...dates.map((dt) => { const d = idx.get(`${f.fc}|${dt}`); return d ? (d.cm2Pct ?? '!') : ''; })]);
    dates.forEach((dt, i) => { const d = idx.get(`${f.fc}|${dt}`); if (d) { const c = r.getCell(i + 2); c.fill = fill(FILL[d.colour]); c.font = { color: { argb: FONT_ON[d.colour] }, size: 9 }; c.numFmt = '0.0'; } });
  }
  g.addRow([]); g.addRow(['Cell value = CM2 % of revenue; colour = day status; ! = data issue']);

  // Daily P&L
  const p = wb.addWorksheet('Daily P&L');
  const lines = COST_KEYS.map((k) => rules.lines[k].label);
  p.columns = [{ header: 'FC', width: 11 }, { header: 'Date', width: 11 }, { header: 'Revenue', width: 11 },
    ...COST_KEYS.flatMap((k, i) => [{ header: lines[i], width: 11 }, { header: `${lines[i]} %`, width: 9 }]),
    { header: 'Total cost', width: 11 }, { header: 'CM1', width: 10 }, { header: 'CM1 %', width: 8 }, { header: 'CM2', width: 10 }, { header: 'CM2 %', width: 8 }, { header: 'Colour', width: 9 }, { header: 'Day class', width: 20 }, { header: 'Anomalies', width: 10 }];
  head(p);
  for (const d of days) {
    const ok = d.status === 'OK';
    const r = p.addRow([d.fc, d.date, d.revenue, ...COST_KEYS.flatMap((k) => [d.costs[k], ok ? d.pct[k] : null]), d.totalCost, d.cm1, d.cm1Pct, d.cm2, d.cm2Pct, d.colour, DAY_CLASS_LABEL[d.dayClass], d.anomalies.length]);
    r.getCell(3).numFmt = inrFmt;
    COST_KEYS.forEach((k, i) => {
      r.getCell(4 + i * 2).numFmt = inrFmt;
      const pc = r.getCell(5 + i * 2); pc.numFmt = pctFmt;
      if (d.anomalies.some((a) => a.key === k)) pc.font = { bold: true, color: { argb: 'FFDC2626' } };
    });
    const b = 4 + COST_KEYS.length * 2;
    [b, b + 1, b + 3].forEach((c) => (r.getCell(c).numFmt = inrFmt));
    [b + 2, b + 4].forEach((c) => (r.getCell(c).numFmt = pctFmt));
    if (d.anomalies.some((a) => a.key === 'cm1')) r.getCell(b + 2).font = { bold: true, color: { argb: 'FFDC2626' } };
    const cc = r.getCell(b + 5); cc.fill = fill(FILL[d.colour]); cc.font = { bold: true, color: { argb: FONT_ON[d.colour] } };
  }
  p.autoFilter = { from: 'A1', to: { row: 1, column: p.columns.length } };

  // Anomalies (the brief's log + extras)
  const a = wb.addWorksheet('Anomalies');
  const arows = anomalyRows(days);
  a.columns = [['Date', 11], ['FC', 11], ['Line Item', 18], ['% of Revenue', 12], ['Target Range', 18], ['Status', 14], ['Deviation (pp)', 13], ['Impact (₹)', 11], ['Severity', 9], ['Override', 20], ['Insight', 120]].map(([header, width]) => ({ header, key: header, width }));
  head(a);
  for (const row of arows) {
    const r = a.addRow(row);
    r.getCell(4).numFmt = pctFmt; r.getCell(8).numFmt = inrFmt;
    if (row.Severity === 'HIGH') r.getCell(9).font = { bold: true, color: { argb: 'FFDC2626' } };
  }
  a.autoFilter = { from: 'A1', to: { row: 1, column: 11 } };

  // Insights (one per flagged FC-day)
  const ins = wb.addWorksheet('Insights');
  ins.columns = [['Date', 11], ['FC', 11], ['Colour', 9], ['Day class', 20], ['CM2 %', 8], ['Insight', 120], ['Recommended action', 60], ['Written by', 11]].map(([header, width]) => ({ header, width }));
  head(ins);
  for (const d of days.filter((x) => x.insight)) {
    const r = ins.addRow([d.date, d.fc, d.colour, DAY_CLASS_LABEL[d.dayClass], d.cm2Pct, d.insight, d.facts?.action || '', d.insightSource]);
    r.getCell(3).fill = fill(FILL[d.colour]); r.getCell(3).font = { color: { argb: FONT_ON[d.colour] }, bold: true };
    r.getCell(6).alignment = { wrapText: true, vertical: 'top' };
  }

  // Data issues
  const di = wb.addWorksheet('Data issues');
  di.columns = [['Level', 8], ['FC', 11], ['Date', 11], ['Issue', 14], ['Detail', 90], ['Where', 30]].map(([header, width]) => ({ header, width }));
  head(di);
  for (const i of result.issues) di.addRow([i.level, i.fc || '', i.date || '', i.issue, i.detail, i.source]);
  if (!result.issues.length) di.addRow(['', '', '', 'none', 'No data issues found']);

  // Targets used
  const t = wb.addWorksheet('Targets');
  t.columns = [['Item', 20], ['Min %', 8], ['Max %', 8], ['Notes', 70]].map(([header, width]) => ({ header, width }));
  head(t);
  for (const k of COST_KEYS) t.addRow([rules.lines[k].label, rules.lines[k].min, rules.lines[k].max, rules._source || '']);
  t.addRow(['CM1', rules.cm1.min, rules.cm1.max, `flag outside ±${rules.cm1.tolerancePp} pp`]);
  t.addRow(['CM2', rules.cm2.min, rules.cm2.max, `flag outside ±${rules.cm2.tolerancePp} pp`]);
  for (const [fc, o] of Object.entries(rules.fcOverrides || {})) for (const [k, v] of Object.entries(o)) t.addRow([`${fc} · ${rules.lines[k]?.label || k}`, v.min, v.max, 'per-FC override']);

  return wb.xlsx.writeBuffer();
}
