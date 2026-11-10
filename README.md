# Case Study 3: Daily FC P&L Monitor & Alert Digest

This app watches each fulfilment centre's (FC's) daily cost and revenue numbers. It finds the days where margins slip, names the cost lines that caused it in plain language, and emails each FC manager a colour-coded daily digest. A central dashboard shows every FC's status.

It's free and runs locally (Node 20+, Express, React/Vite, MongoDB optional), and **no paid API key is needed**. The core is deterministic: the same file always gives the same flags. A local LLM (Ollama) is optional and only rephrases text; it never produces a number.

```
upload / inbox file ─► Ingest ─► Compute ─► Rules ─► Analyst ─► (Writer LLM, optional) ─► Digest ─► Email / Slack / outbox
                                                        ▲                                              │
                                     Memory (past days, overrides) ◄──────────────────────────────────┘   + Dashboard, csv, Ask
```

## Run it in under 15 minutes

Requires Node 20 or newer. Full details for any OS are in [HOW_TO_RUN.md](HOW_TO_RUN.md).

```bash
cd case_study_3_code
npm install            # ~1–3 min
npm test               # 29 tests, expect "pass 29"
npm run build && npm start
# open http://localhost:4200
```

To try real email delivery locally (free), install Mailpit (`brew install mailpit` or a binary from https://mailpit.axllent.org), run `mailpit`, then start the app with `SMTP_HOST=127.0.0.1 SMTP_PORT=1025 npm start`. Click **Daily digests → Send** and open http://localhost:8025 to see one email per FC manager. For delivery to real inboxes, use Gmail with an app password (see HOW_TO_RUN §5).

Command-line alternative:

```bash
npm run monitor -- "test-data/sample_dayWisePnL.pdf" --fc FC-Gurugram --out outputs/mine
```

## What it does (mapped to the brief)

| Brief | Where |
|---|---|
| Per-day, per-FC P&L: each cost line as % of revenue, CM1, CM1%, CM2, CM2% | Dashboard day panel; **Daily P&L** view with 2-decimal financial rounding (`r2`) |
| Flagged anomalies log: Date \| FC \| Line Item \| % of Revenue \| Target Range \| Status | **Anomaly log** tab; `anomalies.csv` export (includes deviation, ₹ impact, severity, override, and line-specific insight) |
| Plain-language insight per anomaly: deviation size, breached lines, top contributors sorted by impact, recommended action | **Dedicated section-specific insight per line item** in Anomaly log; contributors sorted by ₹ impact; root-cause action from playbook |
| Daily colour-coded digest per FC to its manager over a real channel | HTML + text email via authenticated SMTP (Gmail or Mailpit locally), optional Slack webhook; strict routing to configured FC manager (`manjiriswork@gmail.com`), copies saved to `data/outbox/` |
| Central dashboard of daily status across FCs | FC × day colour grid, today's counts, drill-down with 46-day lookback CM2 trend chart and 14-day median baselines |
| Non-blocking large batches, leave and come back | Jobs run in a server queue with Windows-resilient file writes; the browser polls; `?run=<id>` URL; run history |
| Bad input gives a clear message | Empty, corrupt, `.xls`, random bytes, missing mandatory FC/date inputs, unconfigured manager emails, wrong headers each produce a specific user-friendly message |
| Test data: clean day, CM2 breach, line-item-only breach, suspiciously high CM2 | `test-data/multi_fc.xlsx`: on **Aug 8** the FCs show all four, plus a data-issue day |

### Example insight (real output, provided sample, Day 69 = Jul 8)

> On Jul 8, CM2 = 9.6%, 5.4 pp below the 15% target (RED). CM1 = 61.4% (target 65–70%). Above max, by impact: FC Rent 19.9% (max 18%, +₹1,777; mainly low revenue, amount +10.2% vs normal), Overheads 13.6% (max 12%, +₹1,427; amount normal, low revenue), Packaging 8.2% (max 7%, +₹1,122; amount normal, low revenue), Power & Fuel 13.6% (max 13%, +₹520; mainly low revenue, amount -6.7% vs normal) and 1 more. Revenue was 19.1% below this FC's recent normal while total cost moved -4.8%. Recommend: Costs were normal; revenue fell. Check volumes/billing for the day before cutting costs.

## Approach and why

1. **Deterministic numbers, LLM only for wording.** P&L maths, flags, colours, ₹ impact and cause are plain code. An alert system that occasionally invents a number is worse than none. When the optional LLM rephrases an insight, a strict **anti-hallucination guardrail** checks that every number it writes matches the computed facts (±0.1), and every breached line is named. Otherwise the deterministic template is kept.
2. **Rules written down with no gaps & 2-decimal precision.** CM2 thresholds are evaluated with 2-decimal rounding (`r2`): `<12` Red, `<15` Yellow, `15–30` Green, `30–33` Yellow, `≥33` Blue. The $\pm 3\,\text{pp}$ tolerance prevents false alarms on boundary floats (e.g. 24.9997% vs 25.0%). Every threshold lives in `config/rules.json` and the Settings page, not in code.
3. **Ranking by Rupee Impact (₹), not by count.** Breaches are sorted by exact financial loss: $\text{Impact} = \text{Actual Cost} - (\text{Revenue} \times \text{Max Target \%})$. Severities are assigned as HIGH (Red/Blue day), MED (at least ₹1,000 impact or $\ge 2\,\text{pp}$ deviation), and LOW. Digests prioritize top ₹ impact drivers, preventing alert fatigue.
4. **Low revenue vs real overspend.** Rent is a fixed cost, so "Rent 19.9% of revenue" on a slow-sales day isn't a rent problem. Each breach is decomposed into a cost effect $(A - A_0)/R$ and a revenue effect $A_0/R - A_0/R_0$, measured against the FC's own 14-day median baseline. The insight and playbook action follow whichever effect is larger.
5. **Section-specific line item insights.** Rather than repeating the day summary across all table rows, every line item in the Anomaly log gets its own tailored operational insight (e.g. shift roster reviews for Manpower, rental equipment audit for Equipment, carton waste reviews for Packaging), while the overall summary remains on the main dashboard.
6. **Robust 5-stage ingestion pipeline.** It accepts `.xlsx`, `.csv`, `.tsv`, and text `.pdf` exports. Inspects magic bytes (never trusts extensions), auto-detects CSV delimiters (`,`, `;`, `\t`, `|`), matches column synonyms (`Labour` $\rightarrow$ `manpower`), reads Indian currency formats (`₹`, `(1,200)`), and auto-detects embedded target range blocks inside workbooks.
7. **Deliverability & strict recipient routing.** Digests for a selected FC (e.g. `FC-Gurugram`) route **strictly** to that FC's configured manager (`manjiriswork@gmail.com`), suppressing duplicate leadership emails. Deliverability is engineered to avoid Spam folders: clean subject lines without leading emoji triggers, removal of `http://localhost` links, and injection of RFC 3834 auto-generated headers.

## Results

Generated by `npm run eval`, saved to [outputs/eval.md](outputs/eval.md).

| Data | FC-days | Colour / class / exact flags | Missed / false flags | Planted-scenario checks | Time |
|---|---|---|---|---|---|
| Provided sample (PDF export) | 100 | Red days 31, 39, 69, as calculated by hand; the PDF parse is identical to the transcribed CSV | n/a | n/a | 0.5 s |
| Extended `multi_fc.xlsx` (6 FCs) | 600 | 600 / 600 / 600 | 0 / 0 | 8 / 8 | 70 ms |
| Same data as CSV | 600 | 600 / 600 / 600 | 0 / 0 | 8 / 8 | 30 ms |
| Scale: 50 FCs × 365 days | 18,250 | 18,250 / 18,250 / 18,250 | 0 / 0 | 501 / 501 | 0.5 s |
| 6 bad files | n/a | all give a clear message, 0 crashes | n/a | n/a | n/a |

The answer keys are computed by the generator with its own arithmetic, not the engine's. The planted checks also verify the *reasoning*:
- a revenue-dip day gets the "revenue fell" action;
- a cost spike ranks Manpower as the top contributor;
- a ₹0 line is named in the Blue insight;
- a 4-day manpower creep appears under "Watch".

Outputs produced from the test data are in [`outputs/`](outputs/):
- `provided_sample/`: report, anomaly log, and digests for Jul 8 (Red) and Aug 8;
- `extended_multi_fc/`: report, anomaly log, and digests for Aug 8;
- `eval.md`.

Delivery was tested end to end: digests were sent through authenticated Gmail SMTP directly to `manjiriswork@gmail.com`, confirmed with `250 2.0.0 OK`.

### Test data

| File | What |
|---|---|
| `test-data/sample_dayWisePnL.pdf` | The provided sheet export (copied unchanged) |
| `test-data/sample_pune.csv` | The same 100 days transcribed (Day 1 = 2026-05-01, so Day 27 = May 27, as in the brief's example) |
| `test-data/multi_fc.xlsx` / `.csv` | Extended data with planted scenarios, data-quality problems, and a **Targets** sheet |
| `test-data/multi_fc.answers.json` | Expected colour, class and flags for every FC-day |
| `test-data/daily_2026-08-08.csv` | A one-day file, as an FC would send it each morning |
| `test-data/scale/` | 50 FCs × 365 days with 501 planted scenarios and an answer key |
| `test-data/bad/` | Empty, corrupt, wrong-header, header-only, unreadable-rows and random-bytes files |

Regenerate everything with `npm run generate` (and `npm run generate -- --fcs 50 --days 365 --out test-data/scale`).

## How this system gets smarter over time

**Built now:**
- **Single-Day vs. Multi-Day Intelligence.** A standalone single-day upload evaluates strict static targets and exact rupee impacts. When multiple days are uploaded—or when connected to stored historical memory—the system unlocks longitudinal intelligence: a 14-day rolling median baseline, cost-vs-revenue decomposition, and a 46-day lookback margin trajectory chart.
- **Manual overrides.** A manager can mark an anomaly **explained** (with an operational note) or **snooze** a line for an FC for 7 days. Overridden items stay in the log, marked, but leave the digest's top issues. Explained notes are recalled in later insights for the same line.
- **Trend tracking.** A cost line rising 4 days in a row towards the ceiling, or CM2 falling 3 days in a row, shows as a **Watch** item before a threshold is breached.
- **Dynamic FC & Manager Configuration.** Managers and recipient emails can be added, edited, or removed directly from the Settings UI with zero dummy data (`FC-Gurugram` $\rightarrow$ `manjiriswork@gmail.com`).
- **Upload Recipient Validation.** The UI auto-suggests configured FCs and alerts the user if an entered FC has no recipient email set, preventing undelivered alerts.

**Next steps (The EIR Vision):**
1. **Real-Time Event Streaming.** Connect directly to Prozo's WMS and ERP databases via Kafka streams for intra-day alerts rather than waiting for end-of-day file batches.
2. **Autonomous Tool-Calling Agents.** When manpower spikes, the agent autonomously queries biometric turnstile clock-ins and ERP vendor rate cards to verify root causes before notifying leadership.
3. **Bi-Directional Slack & WhatsApp Workflows.** Enable managers to reply with 1-click approvals (`[Acknowledge]`, `[Approve Overtime]`) directly from mobile messaging channels.
4. **Learned per-FC target bands.** Suggest warehouse-specific bands from 90 days of history (median $\pm k \cdot \text{MAD}$), adapting automatically for seasonal peaks (Diwali / Big Billion Days).

## Known limitations (honest)

- **The line-item target ranges are placeholders.** The provided PDF export doesn't contain the target table. Placeholder ranges were selected to sit inside observed spread. Target blocks inside uploaded workbooks are detected automatically, or editable on the Settings page or in `config/rules.json`. CM1/CM2 targets and colour bands are exactly as in the brief.
- **The baseline needs 5 or more earlier days for that FC.** On a cold-start single day without history, variance decomposition shows as "unknown" and relies on static rules until baseline history is established.
- **Batch file input vs real-time streams.** In this phase, inputs are file uploads (`.xlsx`, `.csv`, `.pdf`); production should connect to database change-data-capture streams.
- **Local LLM hardware dependency.** Running local Ollama inference takes a few seconds per day on CPU; production scaling across 100+ warehouses would use batched GPU inference or an enterprise gateway.
- **PDF input requires text layer.** PDF table extraction works on digital vector/text exports (like the provided sample); scanned image PDFs without text layers are rejected with a clear message (no OCR).

## Repository

```
case_study_3_code/
├── config/            rules.json (targets, colour bands, severity) · fcs.json (reference managers) · playbook.json (actions)
├── server/src/
│   ├── ingest/        read.js (magic-byte sniffing, auto-delimiter) · pdf.js · headers.js (synonyms) · values.js · targets.js · index.js
│   ├── engine/        compute.js (margins, r2 rounding) · rules.js · analyst.js (₹ impact, baseline, trends) · overrides.js · index.js
│   ├── ai/            ollama.js · writer.js (LLM + hallucination guardrail) · ask.js
│   ├── digest/        build.js (per-FC digests, anti-spam subjects, HTML/text templates)
│   ├── deliver/       index.js (outbox + authenticated SMTP + RFC 3834 headers + Slack)
│   ├── report/        workbook.js (7-sheet xlsx, anomalies.csv)
│   ├── jobs/          queue.js · scheduler.js (daily inbox run)
│   ├── store/         fileStore.js (atomic write fallback for Windows/OneDrive) · mongoStore.js
│   └── routes/api.js · run.js · cli.js · index.js · settings.js · config.js
├── server/test/       Test suite (29 tests covering math, rules, ingest, AI guardrails, delivery)
├── client/            React UI (Vite)
├── tools/             generate.js (test data + answer keys) · evaluate.js
├── test-data/ · outputs/
└── README.md · DETAILS.md · HOW_TO_RUN.md · explainer.html
```

No secrets are in the repository: `.env` is git-ignored, and `.env.example` contains no credentials.
