# Evaluation

Generated 2026-11-10T04:32:55.824Z by `npm run eval`. The engine runs with memory off, so results depend only on the file.

## Provided sample (PDF export of the sheet, 1 FC × 100 days)

- PDF parsed 100 days; identical to the transcribed CSV: **yes**
- Colours: Red 3, Yellow 11, Green 86, Blue 0. Red days: 31, 39, 69 (expected 31, 39, 69 from hand calculation)
- Day classes: clean 13, line-only 74, CM1 breach 10, CM2 breach 3, suspicious high 0 (line-item targets are provisional)

## Extended data: multi_fc.xlsx (6 FCs × 100 days, planted scenarios)

| FC-days | Colour correct | Day class correct | Exact flag set | Missed flags | False flags | Planted checks | Time |
|---|---|---|---|---|---|---|---|
| 600 | 600/600 | 600/600 | 600/600 | 0 | 0 | 8/8 | 158 ms |

Data issues reported: ZERO_COST, INCOMPLETE, BAD_VALUE, DUPLICATE, NO_REVENUE (all expected kinds present) · targets: uploaded workbook: vertical target block in "Targets"

Demo date 2026-08-08:

| FC | Colour | Class | CM2 % |
|---|---|---|---|
| FC-BLR | GREEN | LINE_ONLY | 19.86 |
| FC-CHN | GREEN | CLEAN | 24.39 |
| FC-DELHI | BLUE | SUSPICIOUS_HIGH | 36.63 |
| FC-HYD | GREY | DATA_ISSUE | — |
| FC-KOL | RED | CM2_BREACH | 5.63 |
| FC-PUNE | GREEN | LINE_ONLY | 18.38 |

## Extended data: multi_fc.csv (6 FCs × 100 days, planted scenarios)

| FC-days | Colour correct | Day class correct | Exact flag set | Missed flags | False flags | Planted checks | Time |
|---|---|---|---|---|---|---|---|
| 600 | 600/600 | 600/600 | 600/600 | 0 | 0 | 8/8 | 43 ms |

Data issues reported: ZERO_COST, INCOMPLETE, BAD_VALUE, DUPLICATE, NO_REVENUE (all expected kinds present) · targets: settings (config/rules.json or Settings page)

## Scale: scale_50x365.csv

| FC-days | Colour correct | Day class correct | Exact flag set | Missed flags | False flags | Planted checks | Time |
|---|---|---|---|---|---|---|---|
| 18250 | 18250/18250 | 18250/18250 | 18250/18250 | 0 | 0 | 501/501 | 1329 ms |

## Bad inputs

| File | Message |
|---|---|
| all_bad_rows.csv | 0 usable days found. First problems: all_bad_rows.csv row 2: Couldn't read the date "not a date". Row skipped. |
| corrupt.xlsx | Couldn't open "corrupt.xlsx": the file looks corrupt or isn't really .xlsx (Corrupted zip: can't find end of central directory). |
| empty.csv | The file is empty. Upload the day-wise P&L as .xlsx or .csv. |
| header_only.csv | 0 usable days found. The header row was found but there are no data rows under it. |
| random_bytes.bin | Couldn't read "random_bytes.bin" as a spreadsheet. Upload .xlsx, .csv or a text-based PDF export of the sheet. |
| wrong_headers.csv | "wrong_headers.csv": couldn't find the P&L header row (needs Revenue plus cost columns like Manpower, Packaging, Power & Fuel, FC Rent, Equipment Rentals, Overheads). First row seen: Name / Age / City |

**All checks passed.**
