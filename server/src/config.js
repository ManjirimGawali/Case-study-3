// Runtime configuration from environment (.env). Business rules live in config/*.json (see settings.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const bool = (k, d) => String(env(k, d)).toLowerCase() === 'true';

export const CFG = {
  PORT: Number(env('PORT', 4200)),
  MONGO_URL: env('MONGO_URL', ''),
  START_DATE: env('START_DATE', '2026-05-01'),
  DATA_DIR: path.resolve(ROOT, env('DATA_DIR', 'data')),
  SMTP_HOST: env('SMTP_HOST', ''),
  SMTP_PORT: Number(env('SMTP_PORT', 1025)),
  SMTP_SECURE: bool('SMTP_SECURE', 'false'),
  SMTP_USER: env('SMTP_USER', ''),
  SMTP_PASS: env('SMTP_PASS', ''),
  MAIL_FROM: env('MAIL_FROM', 'FC P&L Monitor <monitor@localhost>'),
  MAIL_REDIRECT_TO: env('MAIL_REDIRECT_TO', ''),
  SLACK_WEBHOOK_URL: env('SLACK_WEBHOOK_URL', ''),
  AI_INSIGHTS: bool('AI_INSIGHTS', 'false'),
  OLLAMA_URL: env('OLLAMA_URL', 'http://localhost:11434'),
  AI_MODEL: env('AI_MODEL', 'qwen2.5:3b'),
  AI_MAX_INSIGHTS: Number(env('AI_MAX_INSIGHTS', 60)),
  AI_TIMEOUT_MS: Number(env('AI_TIMEOUT_MS', 45000)),
  SCHEDULE_ENABLED: bool('SCHEDULE_ENABLED', 'false'),
  SCHEDULE_TIME: env('SCHEDULE_TIME', '08:00'),
  WATCH_DIR: path.resolve(ROOT, env('WATCH_DIR', 'inbox')),
  PUBLIC_URL: env('PUBLIC_URL', `http://localhost:${env('PORT', 4200)}`),
  MAX_UPLOAD_MB: Number(env('MAX_UPLOAD_MB', 25)),
};
