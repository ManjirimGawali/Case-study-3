// Manual overrides: "explained" (one FC-day-line, with a note) or "snooze" (FC-line until a date).
// Overridden anomalies stay in the log (marked) but leave the digest's top issues.
export function overrideFor(a, overrides) {
  return overrides.find((o) => o.fc === a.fc && (o.line === a.key || o.line === '*') && (
    (o.type === 'explained' && o.date === a.date) ||
    (o.type === 'snooze' && a.date >= o.date && a.date <= (o.until || o.date))
  )) || null;
}

export function withOverrides(days, overrides) {
  if (!overrides?.length) return days;
  return days.map((d) => ({ ...d, anomalies: d.anomalies.map((a) => { const o = overrideFor(a, overrides); return o ? { ...a, override: { id: o.id, type: o.type, note: o.note, until: o.until } } : a; }) }));
}
