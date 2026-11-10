// Text-layer PDF tables (e.g. a "Print to PDF" of the sheet). Items are placed into the
// columns of the header line found on each page, by horizontal overlap with the header cell.
import { findHeader, matchHeader } from './headers.js';

const LINE_TOL = 3;

async function pages(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false }).promise;
  } catch (e) {
    const { InputError } = await import('./read.js');
    throw new InputError(`Couldn't open the PDF (${e.message.slice(0, 80)}). Upload the sheet as .xlsx or .csv instead.`);
  }
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str.trim(), x0: it.transform[4], x1: it.transform[4] + it.width, y: it.transform[5] }));
    items.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const lines = [];
    for (const it of items) {
      const l = lines.find((L) => Math.abs(L.y - it.y) <= LINE_TOL);
      if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => l.items.sort((a, b) => a.x0 - b.x0));
    out.push(lines);
  }
  return out;
}

export async function readPdfTables(buf, filename) {
  const all = await pages(buf);
  const rows = [];
  let cols = null; // [{x0,x1,cx}] from the most recent header line
  let headerEmitted = false;
  for (const lines of all) {
    const asRows = lines.map((l) => l.items.map((i) => i.s));
    const h = findHeader(asRows, asRows.length);
    let start = 0;
    if (h) {
      const hl = lines[h.row];
      cols = hl.items.map((i) => ({ x0: i.x0, x1: i.x1, cx: (i.x0 + i.x1) / 2, s: i.s }));
      if (!headerEmitted) { rows.push(cols.map((c) => c.s)); headerEmitted = true; }
      start = h.row + 1;
    }
    if (!cols) continue;
    for (let li = start; li < lines.length; li++) {
      const cells = new Array(cols.length).fill(null);
      for (const it of lines[li].items) {
        const cx = (it.x0 + it.x1) / 2;
        let best = 0, bestScore = -Infinity;
        cols.forEach((c, k) => {
          const overlap = Math.min(it.x1, c.x1) - Math.max(it.x0, c.x0);
          const score = overlap > 0 ? 1000 + overlap : -Math.min(Math.abs(cx - c.cx), Math.abs(it.x1 - c.x1));
          if (score > bestScore) { bestScore = score; best = k; }
        });
        cells[best] = cells[best] === null ? it.s : `${cells[best]} ${it.s}`;
      }
      if (cells.some((c) => c !== null) && !(cells.filter(Boolean).length > 2 && cells.every((c) => c === null || matchHeader(c)))) rows.push(cells);
    }
  }
  if (!rows.length) {
    const hasText = all.some((ls) => ls.length);
    const { InputError } = await import('./read.js');
    throw new InputError(hasText
      ? `Found text in "${filename}" but no P&L table header (Revenue, Manpower, Packaging…).`
      : `"${filename}" has no text layer (scanned image?). Upload the sheet as .xlsx or .csv.`);
  }
  return [{ name: filename.replace(/\.pdf$/i, ''), rows }];
}
