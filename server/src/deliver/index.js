// Dispatcher: writes every digest to data/outbox/<run>/ (always), then sends by email (SMTP via
// nodemailer: Mailpit locally or Gmail with an app password) and/or Slack when configured.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { CFG } from '../config.js';

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'digest';

let transport = null;
function smtp() {
  if (!CFG.SMTP_HOST) return null;
  transport ||= nodemailer.createTransport({ host: CFG.SMTP_HOST, port: CFG.SMTP_PORT, secure: CFG.SMTP_SECURE, auth: CFG.SMTP_USER ? { user: CFG.SMTP_USER, pass: CFG.SMTP_PASS } : undefined, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  return transport;
}

export function channels() {
  return { outbox: true, email: CFG.SMTP_HOST ? `${CFG.SMTP_HOST}:${CFG.SMTP_PORT}` : null, redirectTo: CFG.MAIL_REDIRECT_TO || null, slack: !!CFG.SLACK_WEBHOOK_URL };
}

async function sendSlack(url, text) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Slack HTTP ${r.status}`);
}

export async function deliver({ runId, digests, onProgress }) {
  const dir = path.join(CFG.DATA_DIR, 'outbox', runId, digests[0]?.date || 'undated');
  fs.mkdirSync(dir, { recursive: true });
  const eml = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const tx = smtp();
  const results = [];
  let i = 0;
  for (const d of digests) {
    const to = CFG.MAIL_REDIRECT_TO || d.email;
    const r = { fc: d.fc, manager: d.manager, to: to || null, intendedTo: d.email || null, colour: d.colour, subject: d.subject, outbox: null, email: 'skipped', slack: 'skipped', error: null };
    const mail = {
      from: CFG.MAIL_FROM,
      to: to || 'unassigned@localhost',
      replyTo: CFG.SMTP_USER || CFG.MAIL_FROM,
      envelope: CFG.SMTP_USER && to ? { from: CFG.SMTP_USER, to: [to] } : undefined,
      subject: d.subject,
      text: d.text,
      html: d.html,
      headers: {
        'X-FC': d.fc,
        'X-Digest-Date': d.date,
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'Precedence': 'bulk',
        'X-Report-Type': 'Daily-FC-PnL-Digest'
      }
    };
    try {
      const base = path.join(dir, slug(d.fc));
      fs.writeFileSync(`${base}.html`, d.html);
      const built = await eml.sendMail(mail);
      fs.writeFileSync(`${base}.eml`, built.message);
      r.outbox = path.relative(CFG.DATA_DIR, `${base}.html`);
    } catch (e) { r.error = `outbox: ${e.message}`; }
    if (!to) r.email = 'no manager email configured';
    else if (tx) {
      try { await tx.sendMail(mail); r.email = 'sent'; } catch (e) { r.email = 'failed'; r.error = `email: ${e.message}`; }
    }
    const hook = d.slackWebhook || CFG.SLACK_WEBHOOK_URL;
    if (hook) { try { await sendSlack(hook, d.slackText); r.slack = 'sent'; } catch (e) { r.slack = 'failed'; r.error = [r.error, `slack: ${e.message}`].filter(Boolean).join('; '); } }
    results.push(r);
    onProgress?.(++i, digests.length);
  }
  const summary = { at: new Date().toISOString(), date: digests[0]?.date, total: results.length, emailed: results.filter((r) => r.email === 'sent').length, emailFailed: results.filter((r) => r.email === 'failed').length, slack: results.filter((r) => r.slack === 'sent').length, outbox: path.relative(CFG.DATA_DIR, dir), channels: channels() };
  return { summary, results };
}
