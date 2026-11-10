// File bytes -> tables (array of { name, rows[][] }). Detects type by content, not extension.
import ExcelJS from 'exceljs';
import { readPdfTables } from './pdf.js';

export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; this.userFacing = true; }
}

export function sniff(buf, filename = '') {
  if (!buf || buf.length === 0) return 'empty';
  const head = buf.subarray(0, 8);
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'xls';
  const sample = buf.subarray(0, 4096);
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 9) || (b > 13 && b < 32)) bad++;
  if (bad / sample.length > 0.02) return 'binary';
  return /\.tsv$/i.test(filename) ? 'tsv' : 'csv';
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = ['\t', ';', ',', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result ?? null;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return null;
  }
  return v;
}

export async function readTables(buf, filename = 'upload') {
  const kind = sniff(buf, filename);
  if (kind === 'empty') throw new InputError('The file is empty. Upload the day-wise P&L as .xlsx or .csv.');
  if (kind === 'xls') throw new InputError('This is an old .xls file. Open it in Excel and "Save As" .xlsx (or .csv), then upload again.');
  if (kind === 'binary') throw new InputError(`Couldn't read "${filename}" as a spreadsheet. Upload .xlsx, .csv or a text-based PDF export of the sheet.`);
  if (kind === 'pdf') return { kind, tables: await readPdfTables(buf, filename) };
  if (kind === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch (e) {
      throw new InputError(`Couldn't open "${filename}": the file looks corrupt or isn't really .xlsx (${e.message.slice(0, 80)}).`);
    }
    const tables = [];
    wb.eachSheet((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (r, n) => {
        const vals = [];
        r.eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = cellValue(c.value); });
        rows[n - 1] = vals;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      tables.push({ name: ws.name, rows });
    });
    return { kind, tables };
  }
  const text = buf.toString('utf8');
  return { kind, tables: [{ name: filename, rows: parseCsv(text) }] };
}
