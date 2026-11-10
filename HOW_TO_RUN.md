# How to Run: FC P&L Monitor (any device)

Works on **macOS, Windows and Linux**. It's free and local: no API keys, no database, no Docker and no Python. The core setup takes about **5 minutes**; email and the optional AI take a few more.

## 0. Requirements

| | Minimum |
|---|---|
| Node.js | v20 or newer |
| RAM / disk | 2 GB / 500 MB (plus about 2 GB if you add the optional Ollama model) |
| Internet | only for `npm install` (and for real email) |

## 1. Copy the project

Copy the `code/` folder to the new machine **without** `node_modules/` and `data/`. Packages are installed on each machine, and `data/` holds your local runs.

```bash
# macOS / Linux, from the folder that contains code/
zip -r fc-pnl-monitor.zip code -x "code/node_modules/*" "code/*/node_modules/*" "code/data/*" "code/client/dist/*"
```

## 2. Install Node.js

Check with `node -v`; it should print v20 or higher.

| OS | Install |
|---|---|
| macOS | `brew install node`, or the LTS installer from https://nodejs.org |
| Windows | LTS `.msi` from https://nodejs.org (keep "Add to PATH"), then re-open the terminal |
| Ubuntu/Debian | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt-get install -y nodejs` |

## 3. Install and test

```bash
cd path/to/code
npm install
npm test        # expect: pass 29, fail 0
npm run eval    # optional: rescoring against the answer keys → outputs/eval.md ("All checks passed")
```

## 4. Run

**Web app**
```bash
npm run build   # first time only (builds the React UI)
npm start       # open http://localhost:4200
```
1. Upload your daily P&L (.xlsx, .csv, or text PDF export). Enter the mandatory **FC center name** and **Day 1 date**. The FC input autocompletes configured FCs and verifies that a manager email is configured before sending.
2. Watch the progress bar. Processing runs on the server; you can close the tab and return at any time.
3. **Dashboard:** view the FC × day colour grid. Click any cell for that day's P&L breakdown, plain-language insight, 45-day margin trajectory chart, and **Explain** / **Snooze** override buttons.
4. **Anomaly log:** review line-item specific insights and recommended actions, filter by severity, or download the full **Anomaly log (.csv)**.
5. **Daily digests:** preview each manager's email, inspect delivery status, and dispatch digests.
6. **Ask:** ask natural-language questions (e.g., *"Why was FC-PUNE red on Jul 8?"*).

**Command line**
```bash
npm run monitor -- <file(s)> [--fc FC-PUNE] [--start 2026-05-01] [--out outputs/x] [--date 2026-08-08] [--send] [--no-memory] [--ai]
# e.g. the provided sample:
npm run monitor -- "test-data/sample_dayWisePnL.pdf" --fc FC-PUNE --no-memory --out outputs/mine
```
This writes `pnl_report.xlsx`, `anomalies.csv` and `digests/*.html|txt`. On Windows, quote paths that contain spaces.

**Regenerate test data**
```bash
npm run generate                                               # multi_fc.xlsx/.csv + answers, daily file, bad/ files
npm run generate -- --fcs 50 --days 365 --out test-data/scale  # scale set
```

**Developer mode:** `npm run dev` (UI on http://localhost:5175 with hot reload, API on :4200).

## 5. Email delivery (pick one)

Settings go in `.env`. Copy `.env.example` to `.env` (`cp` on macOS/Linux, `copy` in Windows cmd, `Copy-Item` in PowerShell).

**A. Mailpit: local test inbox (free, offline, recommended for evaluation)**
1. Install: `brew install mailpit` (macOS). On other systems, download a binary from https://github.com/axllent/mailpit/releases, or run `docker run -p 8025:8025 -p 1025:1025 axllent/mailpit`.
2. Run `mailpit` in its own terminal.
3. In `.env`, set `SMTP_HOST=127.0.0.1` and `SMTP_PORT=1025`. Use `127.0.0.1`, not `localhost`: `localhost` first tries IPv6 and can add a few seconds per email.
4. Restart `npm start`, click **Daily digests → Send**, and open http://localhost:8025.

**B. Gmail: real delivery (free)**
1. Turn on 2-step verification for the Google account, then create an **App password** at https://myaccount.google.com/apppasswords.
2. Set these in `.env`:
   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=you@gmail.com
   SMTP_PASS=<the 16-character app password>
   MAIL_FROM=FC P&L Monitor <you@gmail.com>
   MAIL_REDIRECT_TO=you@gmail.com   # optional: send every digest to yourself while testing
   ```
3. Put the real manager emails in **Targets & managers** (or `config/fcs.json`).

**C. Slack (optional, free).** Create an incoming webhook (Slack app → Incoming Webhooks) and set `SLACK_WEBHOOK_URL=https://hooks.slack.com/...`. Each FC can also have its own `slackWebhook` in `config/fcs.json`.

With no SMTP configured, digests are still written to `data/outbox/<run>/<date>/` as `.html` and `.eml` files, which you can double-click to open in a mail client.

## 6. Daily automatic run (optional)

```ini
SCHEDULE_ENABLED=true
SCHEDULE_TIME=08:00     # local time
WATCH_DIR=inbox
```
Each morning, drop the FCs' files into `code/inbox/`. At 08:00 every new file is processed against memory (so one day of data still gets baselines and trends), digests are sent, and files move to `inbox/processed/`. To test it now:

```bash
cp test-data/daily_2026-08-08.csv inbox/ && curl -X POST http://localhost:4200/api/inbox/run-now
```

The scheduler only runs while `npm start` is running. On a server, keep it up with a process manager (pm2, systemd), or call the run-now endpoint from cron.

## 7. Optional local AI wording (Ollama)

1. Install Ollama from https://ollama.com, then run `ollama pull qwen2.5:3b` (about 2 GB).
2. Set `AI_INSIGHTS=true` in `.env`. Optionally set `AI_MODEL` (any pulled model) and `AI_MAX_INSIGHTS=60` (only the most recent flagged days are rephrased).

The AI only rephrases the computed insight. Any sentence with a number that isn't in the facts, or that drops a breached line, is discarded, and the template is kept. Verdicts, numbers and flags never depend on it. With AI on, Ask can also use the model to understand free-form questions.

## 8. Other settings (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `PORT` | 4200 | Web/API port |
| `START_DATE` | 2026-05-01 | The date that "Day 1" maps to for day-numbered sheets |
| `MONGO_URL` | empty | Empty = JSON files in `data/`. Otherwise `mongodb://localhost:27017/fcpnl` or a free Atlas URL |
| `PUBLIC_URL` | http://localhost:4200 | The "Open dashboard" link inside emails |
| `MAX_UPLOAD_MB` | 25 | Upload size limit |

Targets, colour bands, severity thresholds and per-FC overrides are in `config/rules.json`, or editable on the **Targets & managers** page (saved to `data/settings.json`). To reset memory of past days, use the Settings page or `DELETE /api/memory`.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `node` not found / older than 20 | Install Node 20+, then re-open the terminal |
| Error mentioning `exceljs` / `pdfjs` after copying | Delete all `node_modules` folders and `package-lock.json`, then `npm install` |
| "UI not built" in the console | `npm run build` |
| Port in use | `PORT=4201 npm start` (macOS/Linux), or set `PORT` in `.env` |
| "couldn't find the P&L header row" | The sheet needs a header row with Revenue and at least 3 cost columns. The message lists the headers it saw |
| "no Date or Day column" | Add a Date column (any common format) or a Day number column |
| A day shows grey / "Data issue" | Revenue is blank or 0, or a cost cell is missing or not a number. See the **Data issues** tab. Missing costs are never treated as 0 |
| Emails show "failed" | Check the SMTP settings. Gmail needs an app password, not your normal password. The failure reason shows when you hover over "failed" |
| Sending is slow with Mailpit | Use `SMTP_HOST=127.0.0.1` instead of `localhost` |
| AI status "unavailable" | Start Ollama (`ollama serve`) and `ollama pull` the model named in `AI_MODEL` |
| Old .xls file | Open it in Excel and save as .xlsx or .csv |
