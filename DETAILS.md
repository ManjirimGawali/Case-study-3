# DETAILS: design, rules, data model, API and decisions

This is the detailed companion to [README.md](README.md). Everything here describes the code in `server/src`.

## 1. Pipeline (one run)

| Stage | Module | In → out | Notes |
|---|---|---|---|
| Ingest | `ingest/` | file bytes → `{days[], issues[], sources[], targets}` | Detects the type by content: zip = xlsx, `%PDF`, OLE = old xls (rejected with advice), else CSV/TSV |
| Compute | `engine/compute.js` | day → `pct{}`, `cm1`, `cm1Pct`, `cm2`, `cm2Pct`, `totalCost` | Percentages are rounded to 1e-9 to remove float noise |
| Rules | `engine/rules.js` | computed day → `{colour, dayClass, severity, anomalies[]}` | All thresholds come from the rules object |
| Analyst | `engine/analyst.js` | day + history + memory → `facts` (+ template insight and action) | Ranks by ₹, splits revenue vs cost effects, finds low lines on Blue days, trends, repeat offenders, past explanations |
| Writer | `ai/writer.js` | facts + template → insight text | Optional LLM with a number guard; falls back to the template |
| Digest | `digest/build.js` | run result + date + overrides → per-FC and leadership digests | HTML (inline CSS for mail clients), text, Slack |
| Dispatcher | `deliver/index.js` | digests → outbox files + SMTP + Slack, with a result for each | Always writes `.html` and `.eml` to `data/outbox/` |

`run.js` wires stages 1–5 and stores the result. Delivery is a separate step (`deliverRun`), so an SMTP failure never loses the analysis. `jobs/queue.js` runs one job at a time in the background, and `jobs/scheduler.js` processes `inbox/` once a day.

## 2. Business rules, exactly

```
pct(line) = line ₹ / Revenue × 100
CM1 = Revenue − Manpower − Packaging                  CM1% = CM1 / Revenue × 100
CM2 = CM1 − Power&Fuel − FC Rent − Equipment − Overheads   CM2% = CM2 / Revenue × 100
```

| Check | Fires when (defaults) | Status | Severity |
|---|---|---|---|
| Line item | `pct < min` or `pct > max` (the limits themselves are allowed) | `BELOW_MIN` / `ABOVE_MAX` | MED if ₹ impact ≥ 1,000 or deviation ≥ 2 pp, else LOW |
| CM1 | `CM1% < 65 − 3` or `> 70 + 3` | `BELOW_TARGET` / `ABOVE_TARGET` | MED |
| CM2 | `CM2% < 15 − 3` or `> 30 + 3` | `BELOW_TARGET` / `ABOVE_TARGET` | HIGH |
| Data | revenue blank or ≤ 0 / a cost cell missing or not numeric | `NO_REVENUE` / `INCOMPLETE` | MED, day colour GREY |

- **Deviation** is measured from the target edge, not the tolerance edge. A CM2 of 9.6% shows as −5.4 pp, not −2.4 pp.
- **₹ impact** of a line is `|pct − limit| × revenue / 100`. For CM1 and CM2 it's the margin shortfall (or excess) against the target edge.

**Colour** (CM2%, unrounded): `< 12` RED · `< 15` YELLOW · `≤ 30` GREEN · `< 33` YELLOW · `≥ 33` BLUE · no data GREY.

**Day class** (first match wins):
1. BLUE, or CM2 above tolerance → `SUSPICIOUS_HIGH`
2. CM2 below tolerance → `CM2_BREACH`
3. CM1 outside tolerance → `CM1_BREACH`
4. any line out of band → `LINE_ONLY`
5. otherwise → `CLEAN`

A Yellow day with no line breach is `CLEAN`: it's inside tolerance, so it's coloured but not logged.

Per-FC overrides (`rules.fcOverrides["FC-DELHI"].rent = {min, max}`) replace that FC's band for that line only.

**Targets source, in priority order:**
1. A target block found inside the uploaded workbook. Either vertical (`Manpower | 25% | 30%` or `Manpower | 25-30%`) or horizontal (`Min`/`Max`/`Target` rows under line headers). Fractions ≤ 1 are scaled to %. At least 3 lines must be found.
2. Settings saved from the UI (`data/settings.json`).
3. `config/rules.json`.

The source is recorded in the run, the report and the email footer.

## 3. Analyst maths

**Baseline ("normal").** The median of the FC's previous `baseline.days` (14) OK days, from this upload and from memory of earlier runs. It needs at least `minDays` (5) days. Medians are used so one bad day doesn't shift "normal".

**Cause split.** For a breached line with amount `A` and revenue `R` today, and baseline `A₀` and `R₀`:

```
pct − basePct = (A − A₀)/R  +  (A₀/R − A₀/R₀)
                └ cost effect ┘  └ revenue effect ┘      (identity, both in pp after ×100)
cause = |cost effect| ≥ |revenue effect| ? "cost" : "revenue"
```

The insight writes "amount normal, low revenue" (or "mainly low revenue, amount +10.2% vs normal" when the rupee amount also moved 5% or more) or, for cost, "₹18.6k vs normal ₹12.4k". The action comes from `config/playbook.json[line][above|below][cause]`. On a Red day, if revenue is at least 10% below normal and total cost is within ±5% of normal, the day-level action becomes "revenue fell, check volumes/billing before cutting costs".

**Other facts:**
- **Pressure** (Red with no single line above max): the lines most above the middle of their band, in ₹.
- **Low lines** (Blue): lines that are ₹0, below their minimum, or at least 20% below their baseline amount, with ₹0 lines first.
- **Memory:** red days in the last 7; lines breached on 3 or more of the last 7 days; the last *explained* note for the same FC and line.
- **Trends** (shown on every OK day, not only flagged ones): a line rising 4 days in a row by at least 1 pp in total and ending above the middle of its band; or CM2 falling 4 days in a row by at least 3 pp.

## 4. Writer guard (optional LLM)

The prompt contains a slim facts JSON plus the template ("DRAFT"), with the instruction to copy numbers exactly, keep every line, write at most 3 sentences and return `{"insight": "..."}` (Ollama JSON-schema mode, temperature 0.2). A reply is accepted only if:

1. it has at least 20 characters and is no longer than max(420 characters, 1.4 × the draft);
2. **every number in it** (including ₹ amounts with Indian commas) equals, within ±0.1, a number in the facts or the draft, after rounding to 0 or 1 decimal places. Dates and small counts are also allowed;
3. the first word of each of the top-3 breached line names appears as a whole word. Word boundaries matter: "manpower" contains "power", and that once let a reply that dropped Power & Fuel pass a test.

Otherwise the template is kept, and `insightNote` records why (for example "LLM text rejected: dropped Manpower").

Measured with `qwen2.5vl:3b` on the 6 most recent flagged days: 5 accepted, 1 rejected, about 35 s in total. The model mostly reproduces the draft, so the value is small, and this is said openly in the README.

## 5. Ask the data

`ai/ask.js` turns a question into an intent from a fixed list:

| Intent | Example |
|---|---|
| `explain {fc, date}` | "Why was FC-PUNE red on Jul 8?", "what happened in delhi on day 100" |
| `day {date, colour?}` | "Which FCs were red on 8 Aug?" |
| `rank {order, fc?}` | "Worst days for FC-KOL" |
| `line {line, fc?}` | "Manpower breaches" |
| `colour {colour, fc?}` | "blue days" |
| `fc {fc}` | "How is FC-DELHI doing?" |
| `summary` | "overall status" |

Anything else gets a help message. Parsing is rule-based:
- FC names are matched with or without the `FC-` prefix;
- dates in ISO, dd/mm, "8 Aug", "Aug 8", "day N", or "latest";
- lines by header synonym.

With `AI_INSIGHTS=true`, a question the rules can't parse goes to the LLM, which may only return an intent JSON. The intent is validated (the FC exists, the date is in the run, the line is known) before code answers it. Answers are always built from the computed data.

## 6. Data model

**Run** (`data/runs/<id>.json`, or the Mongo `runs` collection):
```js
{ id, createdAt, status: 'queued'|'running'|'done'|'failed', progress: {step, pct}, error,
  meta: { files, startDate, fcHint, trigger, send },
  result: {
    meta: { files, ms, counts: {days, fcs, anomalies, memoryDaysUsed}, sources, ai },
    rules,                       // the exact rules used, incl. _source
    days: [{ fc, date, day, status, revenue, costs{}, pct{}, totalCost, cm1, cm1Pct, cm2, cm2Pct,
             colour, dayClass, severity, anomalies: [{date, fc, key, line, pct, min, max, target, status,
             deviationPp, impactRs, severity, kind}], facts, insight, insightSource, insightNote, trends[], last7[] }],
    issues: [{ level, fc, date, issue, detail, source }],
    summary: { fcs: [{fc, days, colours{}, classes{}, anomalies, cm2Pct, latest}], totals, firstDate, lastDate }
  },
  delivery: { summary: {at, date, total, emailed, emailFailed, slack, outbox, channels}, results: [...] } }
```

**Memory** (`data/memory/<fc>.json`, or the Mongo `memorydays` collection): `{ "2026-08-07": {revenue, costs, status, zeroLines} }`, one entry per FC per day. The latest upload for a date wins.

**Overrides** (`data/overrides.json`, or Mongo): `{id, fc, date, line, type: 'explained'|'snooze', note, until}`. They're applied when the run is read (dashboard, log, digest, report), so adding one updates the next digest without re-running.

## 7. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Store, delivery channels, AI status, schedule |
| POST | `/api/runs` | multipart `files[]`, optional `fc`, `startDate`, `send` → `202 {id}` |
| POST | `/api/runs/sample` | `{sample: 'multi'\|'pune'}` |
| GET | `/api/runs` · `/api/runs/:id` | History · status and light view (summary, rules, grid cells) |
| GET | `/api/runs/:id/days?fc&from&to&date` | Full day rows (overrides applied) |
| GET | `/api/runs/:id/anomalies?fc&severity&line&status&date&limit` | Anomaly log rows with insight |
| GET | `/api/runs/:id/digests?date` | Built digests (HTML, text, subject, recipient) |
| POST | `/api/runs/:id/send` | `{date}`: deliver now (202; poll the run for `delivery`) |
| POST | `/api/runs/:id/ask` | `{question}` |
| GET | `/api/runs/:id/report.xlsx` · `/anomalies.csv` | Downloads |
| GET/POST/DELETE | `/api/overrides[/:id]` | Explained / snooze |
| GET/PUT/DELETE | `/api/settings` | Targets and managers (validated: min ≤ max, colour thresholds increasing) |
| POST | `/api/inbox/run-now` | Process `inbox/` now and send |
| DELETE | `/api/memory` | Forget past days |

Every error is JSON `{error}` with a 4xx code: 400 bad input, 404 unknown run or route, 409 still processing, 413 too large.

## 8. Report workbook (`pnl_report.xlsx`)

| Sheet | Contents |
|---|---|
| Summary | Per-FC counts by colour and class, period CM2%, latest colour, targets source |
| Status grid | FC × date, cell = CM2%, filled with the day's colour |
| Daily P&L | Each FC-day: revenue, each line in ₹ and %, total cost, CM1, CM1%, CM2, CM2%, colour, class. Breached % shown in bold red |
| Anomalies | The brief's columns plus deviation, ₹ impact, severity, override and insight |
| Insights | One row per flagged FC-day: insight, action, written by |
| Data issues | Every row-level problem and where it is |
| Targets | The exact targets used, including per-FC overrides |

## 9. Decisions log

| Decision | Alternatives | Why |
|---|---|---|
| Deterministic engine + optional LLM writer | An LLM agent that reads the sheet and decides | Same input gives the same flags; auditable; free; fast (18k FC-days in 0.5 s) |
| Insight per flagged **FC-day**, linked from each log row | One sentence per log row | The brief's example is day-level ("CM2 = 10.1%… Power & Fuel…, Manpower…"); per-row sentences would repeat each other |
| ₹ impact ranking + severity tiers | Count of breaches | With realistic bands most days have some breach; ₹ is what leadership cares about |
| Revenue vs cost split against the FC's own median | Compare only with fixed targets | Separates "sell more" from "spend less"; fixed costs would otherwise always be blamed on slow days |
| Missing cost → INCOMPLETE, never 0 | Treat blank as 0 | A blank Power & Fuel would produce a fake Blue day and a wrong digest |
| Email via nodemailer (Mailpit / Gmail), outbox always | WhatsApp API, Slack-only | Email is free and real with an app password; Mailpit makes the demo work offline; WhatsApp Business needs paid or verified accounts |
| File store default, Mongo optional | Mongo required | Under 15 minutes to run on a fresh machine |
| Day number + start date | Guess dates | The sample has no dates; the brief's "May 27" example matches Day 27 when Day 1 is May 1 |
| Provisional line targets in config, auto-detect from the workbook | Hard-code | The real table wasn't in the export; anyone can change it without touching code |

## 10. Bugs found by the tests and evaluation (all fixed)

1. **A value exactly at a limit was flagged.** `7000 / 100000 × 100 = 7.000000000000001 > 7`. Percentages are now rounded to 1e-9.
2. **The writer guard was fooled by "manpower" containing "power".** A reply that dropped Power & Fuel passed. Line names are now matched as whole words.
3. **Some scenario recipes in the generator didn't always produce the outcome they claimed.** For example, a cost spike on a low-cost day landed in Yellow, not Red. The evaluator caught this because the engine agreed with the independent arithmetic but not with the scenario's stated goal. The recipes now pin the other lines.
4. **A one-day upload's digest showed only one day of history.** Digests now take the last 7 days from memory as well.
5. **SMTP to `localhost` was slow** (IPv6 first). The docs now use `127.0.0.1`.
6. **"Amount normal" was too strong.** On the sample's Jul 8, rent was 10% above normal in rupees, but revenue fell 19%, so the revenue effect (+3.5 pp) still beat the cost effect (+1.8 pp). The text now gives the amount change whenever it is 5% or more.
7. **"0 usable days" with no reason** for a header-only file or rows with unparseable dates. Both cases now say why.
