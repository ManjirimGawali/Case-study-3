// Digest agent: one colour-coded digest per FC per day (+ a leadership roll-up), as HTML email,
// plain text and a short Slack message.
import { inr, inrK, pct, longDate, shortDate } from '../engine/format.js';
import { DAY_CLASS_LABEL } from '../engine/rules.js';
import { COST_KEYS, LABELS } from '../ingest/headers.js';
import { lineTarget } from '../settings.js';
import { withOverrides } from '../engine/overrides.js';

export const COLOUR_HEX = { RED: '#dc2626', YELLOW: '#d97706', GREEN: '#16a34a', BLUE: '#1d4ed8', GREY: '#6b7280' };
const EMOJI = { RED: '🔴', YELLOW: '🟡', GREEN: '🟢', BLUE: '🔵', GREY: '⚪' };
const MEANING = { RED: 'Margin breach. Act today', YELLOW: 'Drifting. Watch it', GREEN: 'Healthy', BLUE: 'Suspiciously high margin. Check for unbooked costs', GREY: 'No usable data' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function managerFor(fcsCfg, fc) {
  const m = fcsCfg?.managers || {};
  if (!fc) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(fc);
  let key = Object.keys(m).find((k) => k.toLowerCase() === fc.toLowerCase());
  if (!key) key = Object.keys(m).find((k) => norm(k) === target);
  return key ? m[key] : null;
}

function headline(day) {
  if (!day) return 'No P&L data received for this date.';
  if (day.status !== 'OK') return `Data problem: ${day.anomalies[0]?.status === 'NO_REVENUE' ? 'revenue is missing or zero' : 'one or more cost lines are missing'}, so margins could not be computed.`;
  if (day.insight) return day.insight;
  if (day.colour === 'YELLOW') return `On ${shortDate(day.date)}, CM2 = ${pct(day.cm2Pct)}: inside tolerance but outside the ideal band. No line item breached.`;
  return `On ${shortDate(day.date)}, all clear: CM2 = ${pct(day.cm2Pct)}, CM1 = ${pct(day.cm1Pct)}, every cost line within target.`;
}

export function buildFcDigest({ fc, date, days, rules, fcsCfg, publicUrl, runId }) {
  const fcDays = days.filter((d) => d.fc === fc).sort((a, b) => a.date.localeCompare(b.date));
  const day = fcDays.find((d) => d.date === date) || null;
  // Last 7 days include days remembered from earlier runs (day.last7), so a one-day upload still shows history.
  const prior = day?.last7 || fcDays.filter((d) => d.date <= date).slice(-7);
  const colour = day ? day.colour : 'GREY';
  const mgr = managerFor(fcsCfg, fc);
  const active = (day?.anomalies || []).filter((a) => !a.override && a.kind !== 'data');
  const acknowledged = (day?.anomalies || []).filter((a) => a.override);
  const ranked = [...active].sort((a, b) => ({ HIGH: 3, MED: 2, LOW: 1 }[b.severity] - { HIGH: 3, MED: 2, LOW: 1 }[a.severity]) || (b.impactRs || 0) - (a.impactRs || 0));
  const top = ranked.filter((a) => a.severity !== 'LOW').slice(0, 5);
  const minor = ranked.length - top.length;
  const link = `${publicUrl}/?run=${runId}&fc=${encodeURIComponent(fc)}&date=${date}`;
  const subject = `[FC Alert] ${fc} · ${shortDate(date)} · ${colour}${day?.cm2Pct !== null && day?.cm2Pct !== undefined ? ` · CM2 ${pct(day.cm2Pct)}` : ''}${top.length ? ` · ${top.length} issue${top.length > 1 ? 's' : ''}` : ''}`;
  const head = headline(day);
  const trendLines = day?.trends || [];

  // ---------- plain text ----------
  const t = [];
  t.push(`${fc} · ${longDate(date)} · ${colour} (${MEANING[colour]})`, '');
  t.push(head, '');
  if (day?.status === 'OK') {
    t.push(`Revenue ${inr(day.revenue)} · CM1 ${inr(day.cm1)} (${pct(day.cm1Pct)}, target ${rules.cm1.min}–${rules.cm1.max}%) · CM2 ${inr(day.cm2)} (${pct(day.cm2Pct)}, target ${rules.cm2.min}–${rules.cm2.max}%)`);
    for (const k of COST_KEYS) { const tg = lineTarget(rules, fc, k); t.push(`  ${tg.label.padEnd(18)} ${inr(day.costs[k]).padStart(10)}  ${pct(day.pct[k]).padStart(6)}  (target ${tg.min}–${tg.max}%)`); }
    t.push('');
  }
  if (top.length) { t.push('Top issues:'); top.forEach((a, i) => t.push(`  ${i + 1}. ${a.line} ${pct(a.pct)} (${a.target}) ${a.status}${a.impactRs ? `, ${inr(a.impactRs)}` : ''}`)); }
  if (minor > 0) t.push(`  + ${minor} minor breach${minor > 1 ? 'es' : ''}`);
  if (acknowledged.length) t.push(`Acknowledged: ${acknowledged.map((a) => `${a.line} (${a.override.type}${a.override.note ? `: ${a.override.note}` : ''})`).join('; ')}`);
  if (trendLines.length) { t.push('', 'Watch:'); trendLines.forEach((x) => t.push(`  • ${x.text}`)); }
  t.push('', `Last 7 days: ${prior.map((d) => `${shortDate(d.date)} ${d.colour[0]}`).join(' · ')}`, `Dashboard: ${link}`);
  const text = t.join('\n');

  // ---------- HTML (inline styles for email clients) ----------
  const c = COLOUR_HEX[colour];
  const td = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;';
  const rows = day?.status === 'OK' ? COST_KEYS.map((k) => {
    const tg = lineTarget(rules, fc, k);
    const a = day.anomalies.find((x) => x.key === k);
    const flag = a ? `<b style="color:${a.override ? '#6b7280' : '#dc2626'}">${a.status === 'ABOVE_MAX' ? '▲ above max' : '▼ below min'}${a.override ? ` (${a.override.type})` : ''}</b>` : '<span style="color:#16a34a">ok</span>';
    return `<tr><td style="${td}">${esc(tg.label)}</td><td style="${td}text-align:right">${inr(day.costs[k])}</td><td style="${td}text-align:right">${pct(day.pct[k])}</td><td style="${td}color:#6b7280">${tg.min}–${tg.max}%</td><td style="${td}">${flag}</td></tr>`;
  }).join('') : '';
  const cmRow = (label, v, pctv, tg, key) => {
    const a = day.anomalies.find((x) => x.key === key);
    return `<tr style="font-weight:600"><td style="${td}">${label}</td><td style="${td}text-align:right">${inr(v)}</td><td style="${td}text-align:right">${pct(pctv)}</td><td style="${td}color:#6b7280">${tg.min}–${tg.max}%</td><td style="${td}">${a ? `<b style="color:#dc2626">${a.status === 'BELOW_TARGET' ? '▼ below' : '▲ above'} by &gt;${tg.tolerancePp} pp</b>` : '<span style="color:#16a34a">ok</span>'}</td></tr>`;
  };
  const strip = prior.map((d) => `<td title="${d.date} ${d.colour} ${d.cm2Pct ?? ''}" style="width:34px;height:22px;background:${COLOUR_HEX[d.colour]};color:#fff;font-size:10px;text-align:center;border-radius:3px">${d.date.slice(8)}</td>`).join('<td style="width:3px"></td>');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0a0a">
<div style="max-width:640px;margin:0 auto;background:#fff">
  <div style="background:#0a0a0a;color:#fff;padding:16px 20px;border-bottom:5px solid ${c}">
    <div style="font-size:12px;color:#9ca3af;letter-spacing:.06em;text-transform:uppercase">Daily P&amp;L digest${mgr ? ` · for ${esc(mgr.manager)}` : ''}</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(fc)} · ${esc(longDate(date))}</div>
    <div style="margin-top:8px"><span style="background:${c};color:#fff;font-weight:700;padding:3px 10px;border-radius:4px;font-size:13px">${colour}${day?.cm2Pct !== null && day?.cm2Pct !== undefined ? ` · CM2 ${pct(day.cm2Pct)}` : ''}</span> <span style="color:#d1d5db;font-size:13px">${esc(MEANING[colour])}${day ? ` · ${esc(DAY_CLASS_LABEL[day.dayClass])}` : ''}</span></div>
  </div>
  <div style="padding:16px 20px">
    <p style="font-size:15px;line-height:1.5;margin:0 0 14px;border-left:4px solid ${c};padding-left:10px">${esc(head)}</p>
    ${day?.status === 'OK' ? `<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr style="background:#0a0a0a;color:#fff;font-size:12px"><th style="padding:6px 10px;text-align:left">Line</th><th style="padding:6px 10px;text-align:right">₹</th><th style="padding:6px 10px;text-align:right">% rev</th><th style="padding:6px 10px;text-align:left">Target</th><th style="padding:6px 10px;text-align:left">Status</th></tr>
      <tr style="font-weight:600"><td style="${td}">Revenue</td><td style="${td}text-align:right">${inr(day.revenue)}</td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td></tr>
      ${rows}${cmRow('CM1', day.cm1, day.cm1Pct, rules.cm1, 'cm1')}${cmRow('CM2', day.cm2, day.cm2Pct, rules.cm2, 'cm2')}</table>` : ''}
    ${top.length ? `<div style="font-weight:700;margin-bottom:6px">Top issues (by severity, then ₹ impact)</div><ol style="margin:0 0 12px;padding-left:20px;font-size:14px">${top.map((a) => `<li><b>${esc(a.line)}</b> ${pct(a.pct)} <span style="color:#6b7280">(target ${esc(a.target)})</span>${a.impactRs ? ` · ${inr(a.impactRs)}` : ''} <span style="font-size:11px;color:#fff;background:${a.severity === 'HIGH' ? '#dc2626' : '#4b5563'};padding:1px 6px;border-radius:3px">${a.severity}</span></li>`).join('')}</ol>` : ''}
    ${minor > 0 ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px">+ ${minor} minor breach${minor > 1 ? 'es' : ''} (under ₹${rules.severity.medRupees} and under ${rules.severity.medPp} pp). See dashboard.</p>` : ''}
    ${acknowledged.length ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px">Acknowledged: ${acknowledged.map((a) => `${esc(a.line)} (${a.override.type}${a.override.note ? `: ${esc(a.override.note)}` : ''})`).join('; ')}</p>` : ''}
    ${trendLines.length ? `<div style="background:#eff6ff;border-left:4px solid #1d4ed8;padding:8px 12px;margin:0 0 12px;font-size:13px"><b>Watch</b><br>${trendLines.map((x) => esc(x.text)).join('<br>')}</div>` : ''}
    <div style="font-size:12px;color:#6b7280;margin:6px 0 4px">Last ${prior.length} days</div>
    <table style="border-collapse:separate"><tr>${strip}</tr></table>
    ${!publicUrl || publicUrl.includes('localhost') || publicUrl.includes('127.0.0.1')
      ? `<p style="font-size:12px;color:#6b7280;margin:16px 0 0">Interactive report available on the Prozo Dashboard: <code style="color:#1d4ed8;word-break:break-all">${esc(link)}</code></p>`
      : `<p style="margin:16px 0 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:14px;display:inline-block">Open dashboard</a></p>`}
  </div>
  <div style="padding:10px 20px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb">Numbers are computed from the uploaded P&amp;L; targets from settings${rules._source ? ` (${esc(rules._source)})` : ''}. Insight written by ${day?.insightSource === 'llm' ? 'a local AI model (numbers checked against the computed facts)' : 'the rules engine'}.</div>
</div></body></html>`;

  const slackText = `${EMOJI[colour]} *${fc}* · ${shortDate(date)} · *${colour}*${day?.cm2Pct !== null && day?.cm2Pct !== undefined ? ` · CM2 ${pct(day.cm2Pct)}` : ''}\n${head}${top.length ? `\n${top.slice(0, 3).map((a, i) => `${i + 1}. ${a.line} ${pct(a.pct)} (${a.target})${a.impactRs ? ` ${inr(a.impactRs)}` : ''}`).join('\n')}` : ''}\n<${link}|Open dashboard>`;

  return { fc, date, colour, manager: mgr?.manager || null, email: mgr?.email || null, slackWebhook: mgr?.slackWebhook || null, subject, text, html, slackText, issues: top.length, minor, hasData: !!day };
}

export function buildLeadershipDigest({ date, digests, fcsCfg, publicUrl, runId }) {
  const order = { RED: 0, BLUE: 1, GREY: 2, YELLOW: 3, GREEN: 4 };
  const list = [...digests].sort((a, b) => order[a.colour] - order[b.colour] || a.fc.localeCompare(b.fc));
  const count = (c) => list.filter((d) => d.colour === c).length;
  const subject = `FC status ${shortDate(date)}: ${['RED', 'BLUE', 'YELLOW', 'GREEN', 'GREY'].filter(count).map((c) => `${count(c)} ${c}`).join(' · ')}`;
  const text = [subject, '', ...list.map((d) => `${EMOJI[d.colour]} ${d.fc.padEnd(12)} ${d.colour.padEnd(6)} ${d.text.split('\n')[2].slice(0, 160)}`), '', `Dashboard: ${publicUrl}/?run=${runId}`].join('\n');
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0"><div style="max-width:720px;margin:0 auto;background:#fff">
<div style="background:#0a0a0a;color:#fff;padding:16px 20px;border-bottom:5px solid #1d4ed8"><div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">All FCs · ${esc(longDate(date))}</div><div style="font-size:19px;font-weight:700">${esc(subject)}</div></div>
<table style="border-collapse:collapse;width:100%;font-size:13px">${list.map((d) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${COLOUR_HEX[d.colour]}"></span> <b>${esc(d.fc)}</b></td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(d.text.split('\n')[2])}</td></tr>`).join('')}</table>
<p style="padding:12px 20px;margin:0"><a href="${esc(publicUrl)}/?run=${runId}" style="color:#1d4ed8">Open dashboard</a></p></div></body></html>`;
  const L = fcsCfg.leadership || {};
  return { fc: '(all FCs)', date, colour: count('RED') ? 'RED' : count('BLUE') ? 'BLUE' : count('YELLOW') ? 'YELLOW' : 'GREEN', manager: L.manager || 'Leadership', email: L.email || null, subject, text, html, slackText: `*${subject}*\n${list.map((d) => `${EMOJI[d.colour]} ${d.fc}`).join('  ')}\n<${publicUrl}/?run=${runId}|Open dashboard>`, leadership: true };
}

export function buildDigests({ result, date, overrides, rules, fcsCfg, publicUrl, runId }) {
  const days = withOverrides(result.days, overrides);
  const d = date || result.summary.lastDate;
  const fcs = result.summary.fcs.map((s) => s.fc);
  const digests = fcs.map((fc) => buildFcDigest({ fc, date: d, days, rules, fcsCfg, publicUrl, runId }));
  return { date: d, digests, leadership: buildLeadershipDigest({ date: d, digests, fcsCfg, publicUrl, runId }) };
}
