import React, { useEffect, useMemo, useRef, useState } from 'react';

const COLOURS = ['RED', 'YELLOW', 'GREEN', 'BLUE', 'GREY'];
const COLOUR_TEXT = { RED: 'Red: CM2 below 12%', YELLOW: 'Yellow: 12–15% or 30–33%', GREEN: 'Green: 15–30%', BLUE: 'Blue: 33%+ (suspicious)', GREY: 'No usable data' };
const CLASS = { CLEAN: 'Clean', LINE_ONLY: 'Line-item-only breach', CM1_BREACH: 'CM1 breach', CM2_BREACH: 'CM2 breach', SUSPICIOUS_HIGH: 'Suspiciously high CM2', DATA_ISSUE: 'Data issue' };
const LINES = ['manpower', 'packaging', 'powerFuel', 'rent', 'equipment', 'overheads'];
const inr = (v) => (v === null || v === undefined ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sd = (iso) => (iso ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}` : '');

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (HTTP ${r.status})`);
  return body;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const qs = () => new URLSearchParams(location.search);
const go = (params) => { const u = new URLSearchParams(params); history.pushState(null, '', u.toString() ? `?${u}` : location.pathname); window.dispatchEvent(new Event('popstate')); };

export default function App() {
  const [loc, setLoc] = useState(qs().toString());
  const [health, setHealth] = useState(null);
  useEffect(() => { const f = () => setLoc(qs().toString()); window.addEventListener('popstate', f); api('/health').then(setHealth).catch(() => {}); return () => window.removeEventListener('popstate', f); }, []);
  const p = new URLSearchParams(loc);
  const page = p.get('page') || (p.get('run') ? 'run' : 'home');
  return (
    <>
      <div className="top"><div className="in">
        <h1>FC P&amp;L Monitor</h1>
        <a className={page === 'home' ? 'on' : ''} onClick={() => go({})}>Upload &amp; runs</a>
        <a className={page === 'settings' ? 'on' : ''} onClick={() => go({ page: 'settings' })}>Targets &amp; managers</a>
        <span className="grow" />
        {health && <span className="pill">delivery: {health.delivery.email ? `email (${health.delivery.email})` : 'outbox only'}{health.delivery.slack ? ' + Slack' : ''} · AI: {health.ai.enabled ? (health.ai.ok ? health.ai.model : 'unavailable') : 'off'}</span>}
      </div></div>
      <div className="wrap">
        {page === 'home' && <Home />}
        {page === 'run' && <Run id={p.get('run')} initialFc={p.get('fc')} initialDate={p.get('date')} />}
        {page === 'settings' && <Settings />}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Home */
function Home() {
  const [files, setFiles] = useState([]);
  const [fc, setFc] = useState('');
  const [start, setStart] = useState('2026-05-01');
  const [send, setSend] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState([]);
  const [settings, setSettings] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef();
  const load = () => api('/runs').then(setRuns).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api('/settings').then(setSettings).catch(() => {});
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const managers = settings?.fcs?.managers || {};
  const trimmedFc = fc.trim();
  const configuredManager = trimmedFc ? Object.entries(managers).find(([k, m]) => (
    k.toLowerCase() === trimmedFc.toLowerCase() ||
    k.toLowerCase().replace(/[^a-z0-9]/g, '') === trimmedFc.toLowerCase().replace(/[^a-z0-9]/g, '')
  )) : null;
  const isFcConfigured = Boolean(configuredManager?.[1]?.email);

  const submit = async () => {
    setErr('');
    if (!trimmedFc) { setErr('FC center name is mandatory.'); return; }
    if (!start) { setErr('Day 1 date is mandatory.'); return; }
    if (send && !isFcConfigured) {
      setErr(`Set mail id for the given FC center (${trimmedFc}) from Targets & managers.`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('fc', trimmedFc); fd.append('startDate', start); fd.append('send', String(send));
      const r = await api('/runs', { method: 'POST', body: fd });
      go({ run: r.id });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card" style={{ maxWidth: 860, margin: '0 auto 20px auto' }}>
        <h2>Upload daily P&amp;L</h2>
        <p className="muted small">One or more .xlsx / .csv files (a text PDF export also works). Columns: Date or Day, Revenue, Manpower, Packaging, Power &amp; Fuel, FC Rent, Equipment Rentals, Overheads, and optionally FC. Header names are matched by synonym, and a target-range block in the workbook is used if present.</p>
        <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...e.dataTransfer.files]); }}>
          <input ref={input} type="file" multiple accept=".xlsx,.csv,.tsv,.pdf" style={{ display: 'none' }} onChange={(e) => setFiles([...e.target.files])} />
          <button onClick={() => input.current.click()}>Choose file(s)</button> <span className="muted">or drop them here</span>
          {files.length > 0 && <div className="small" style={{ marginTop: 8 }}>{files.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`).join(', ')}</div>}
        </div>
        <div className="row end" style={{ marginTop: 12 }}>
          <label className="f"><b>FC center name (mandatory)</b>
            <input list="fc-options" value={fc} onChange={(e) => setFc(e.target.value)} placeholder="e.g. FC-Gurugram" required />
            <datalist id="fc-options">
              {Object.keys(managers).map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label className="f"><b>Day 1 date (mandatory)</b><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className="row small"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> send digests when done</label>
        </div>
        {trimmedFc && !isFcConfigured && (
          <div className="note small" style={{ marginTop: 8, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: '4px' }}>
            ⚠️ <b>"{trimmedFc}" is not configured in Targets &amp; managers</b>. Set mail ID for the given FC center from <button className="link" onClick={() => go({ page: 'settings' })}>Targets &amp; managers</button> before sending digests.
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!files.length || !fc.trim() || !start || busy || (send && !isFcConfigured)} onClick={submit}>{busy ? 'Uploading…' : 'Run monitor'}</button>
          <span className="muted small">Processing runs on the server: you can leave and come back.</span>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
      <h3>Runs</h3>
      {!runs.length ? <p className="muted">No runs yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Files</th><th>Status</th><th className="num">FC-days</th><th>Red / Yellow / Green / Blue</th><th>Latest date</th><th>Digests</th></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.id} className="click" onClick={() => go({ run: r.id })}>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{r.meta?.files?.join(', ')}{r.meta?.trigger && r.meta.trigger !== 'upload' ? <span className="muted small"> · {r.meta.trigger}</span> : null}</td>
              <td>{r.status === 'failed' ? <span className="bad" title={r.error}>failed</span> : r.status === 'done' ? 'done' : `${r.progress?.step || r.status} (${r.progress?.pct || 0}%)`}</td>
              <td className="num">{r.summary?.totals?.days ?? ''}</td>
              <td>{r.summary && ['RED', 'YELLOW', 'GREEN', 'BLUE'].map((c) => <span key={c} className={`chip c-${c}`} style={{ marginRight: 3 }}>{r.summary.totals.colours[c]}</span>)}</td>
              <td>{r.summary?.lastDate || ''}</td>
              <td className="small">{r.delivery ? `${r.delivery.emailed} emailed · ${r.delivery.total} in outbox` : ''}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Run */
function Run({ id, initialFc, initialDate }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [sel, setSel] = useState(initialFc && initialDate ? { fc: initialFc, date: initialDate } : null);
  const [ovTick, setOvTick] = useState(0);
  useEffect(() => {
    let t; let alive = true;
    const poll = async () => {
      try {
        const r = await api(`/runs/${id}`);
        if (!alive) return;
        setRun(r);
        if (r.status === 'queued' || r.status === 'running' || r.sending) t = setTimeout(poll, r.sending ? 1500 : 800);
      } catch (e) { setErr(e.message); }
    };
    poll();
    return () => { alive = false; clearTimeout(t); };
  }, [id, ovTick]);
  if (err) return <div className="error">{err} <button className="link" onClick={() => go({})}>back</button></div>;
  if (!run) return <p className="muted">Loading…</p>;
  if (run.status === 'failed') return (<><button className="link" onClick={() => go({})}>← back</button><h2>Run failed</h2><div className="error">{run.error}</div><p className="muted">Fix the file and upload it again. Nothing was sent.</p></>);
  if (run.status !== 'done') return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2>Processing {run.meta.files.join(', ')}</h2>
      <div className="progress"><div style={{ width: `${run.progress?.pct || 1}%` }} /></div>
      <p>{run.progress?.step} · {run.progress?.pct || 0}%</p>
      <p className="muted small">This runs on the server. You can close this tab and come back from "Upload &amp; runs" at any time.</p>
    </div>
  );
  const res = run.result;
  const refresh = () => setOvTick((x) => x + 1);
  return (
    <>
      <div className="row">
        <button className="link" onClick={() => go({})}>← runs</button>
        <span className="muted small">{res.meta.files.join(', ')} · {res.summary.fcs.length} FC(s) · {res.summary.firstDate} to {res.summary.lastDate} · {res.meta.counts.days} FC-days · {res.meta.ms} ms</span>
        <span style={{ flex: 1 }} />
        <a className="btn primary" href={`/api/runs/${id}/anomalies.csv`}>Anomaly log (.csv)</a>
      </div>
      <div className="note small">Targets: {res.rules._source}. {res.rules._note && !res.rules._source.startsWith('uploaded') ? 'Line-item ranges are provisional; edit them under "Targets & managers".' : ''} Insights: {res.meta.ai.status}.{res.issueCount ? ` ${res.issueCount} data issue(s) found: see the report's "Data issues" sheet.` : ''}{res.meta.counts.memoryDaysUsed ? ` Memory: ${res.meta.counts.memoryDaysUsed} earlier day(s) used as baseline.` : ''}</div>
      <div className="tabs">
        {[['dashboard', 'Dashboard'], ['anomalies', `Anomaly log (${res.summary.totals.anomalies})`], ['digests', 'Daily digests'], ['ask', 'Ask'], ['issues', `Data issues (${res.issueCount})`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'dashboard' && <Dashboard id={id} res={res} sel={sel} setSel={setSel} onChange={refresh} />}
      {tab === 'anomalies' && <Anomalies id={id} res={res} onOpen={(fc, date) => { setSel({ fc, date }); setTab('dashboard'); }} />}
      {tab === 'digests' && <Digests id={id} run={run} onSent={refresh} />}
      {tab === 'ask' && <Ask id={id} onOpen={(fc, date) => { setSel({ fc, date }); setTab('dashboard'); }} />}
      {tab === 'issues' && <Issues res={res} />}
    </>
  );
}

function Dashboard({ id, res, sel, setSel, onChange }) {
  const dates = useMemo(() => [...new Set(res.grid.map((g) => g[1]))].sort(), [res]);
  const [win, setWin] = useState(21);
  const [focusDate, setFocusDate] = useState(sel?.date || res.summary.lastDate);
  const cells = useMemo(() => new Map(res.grid.map((g) => [`${g[0]}|${g[1]}`, g])), [res]);
  const end = dates.indexOf(focusDate) >= 0 ? dates.indexOf(focusDate) : dates.length - 1;
  const shown = win === 0 ? dates : dates.slice(Math.max(0, end - win + 1), end + 1);
  const today = res.grid.filter((g) => g[1] === focusDate);
  const count = (c) => today.filter((g) => g[2] === c).length;
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <b>Status on</b>
        <select value={focusDate} onChange={(e) => setFocusDate(e.target.value)}>{[...dates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <span className="muted small">window</span>
        <select value={win} onChange={(e) => setWin(+e.target.value)}><option value={14}>14 days</option><option value={21}>21 days</option><option value={31}>31 days</option><option value={0}>all</option></select>
      </div>
      <div className="stats">
        {COLOURS.map((c) => <div key={c} className={`stat ${c}`}><b>{count(c)}</b><span className="small muted">{COLOUR_TEXT[c]}</span></div>)}
      </div>
      <div className="table-wrap" style={{ maxHeight: 'none' }}>
        <table className="sgrid">
          <thead><tr><th className="fc">FC</th>{shown.map((d) => <th key={d}>{d.slice(8)}<br />{MON[+d.slice(5, 7) - 1]}</th>)}</tr></thead>
          <tbody>{res.summary.fcs.map((f) => (
            <tr key={f.fc}><th className="fc">{f.fc}</th>{shown.map((d) => {
              const g = cells.get(`${f.fc}|${d}`);
              if (!g) return <td key={d}><div className="cell" style={{ background: '#fff', border: '1px dashed var(--line)' }} title="no data" /></td>;
              return <td key={d}><div className={`cell c-${g[2]} ${sel?.fc === f.fc && sel?.date === d ? 'sel' : ''}`} title={`${f.fc} ${d}: ${g[2]} · CM2 ${pct(g[3])} · ${CLASS[g[4]]} · ${g[5]} flag(s)`} onClick={() => setSel({ fc: f.fc, date: d })}>{g[3] === null ? '!' : Math.round(g[3])}</div></td>;
            })}</tr>))}</tbody>
        </table>
      </div>
      <div className="legend">{COLOURS.map((c) => <span key={c} style={{ '--c': `var(--${c})` }}>{COLOUR_TEXT[c]}</span>)}<span style={{ '--c': '#fff' }}>cell number = CM2 %, click a cell for detail</span></div>
      {sel ? <DayDetail id={id} res={res} fc={sel.fc} date={sel.date} onChange={onChange} /> : <p className="muted">Click a cell to see that FC's P&amp;L, the insight and its trend.</p>}
    </>
  );
}

function TrendChart({ days, date, rules }) {
  const pts = days.filter((d) => d.cm2Pct !== null);
  if (pts.length < 2) return null;
  const W = 900, H = 190, P = 28;
  const vals = pts.map((d) => d.cm2Pct);
  const lo = Math.min(5, ...vals) - 2, hi = Math.max(36, ...vals) + 2;
  const x = (i) => P + (i * (W - P - 8)) / (pts.length - 1);
  const y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 30);
  const band = (a, b, c) => <rect x={P} width={W - P - 8} y={y(Math.min(b, hi))} height={Math.max(0, y(Math.max(a, lo)) - y(Math.min(b, hi)))} fill={c} opacity=".13" />;
  const C = rules.colour;
  const selIdx = pts.findIndex((d) => d.date === date);
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="CM2 trend">
      {band(lo, C.red, '#dc2626')}{band(C.red, C.yellowLow, '#f59e0b')}{band(C.yellowLow, C.yellowHigh, '#16a34a')}{band(C.yellowHigh, C.blue, '#f59e0b')}{band(C.blue, hi, '#1d4ed8')}
      {[C.red, C.yellowLow, C.yellowHigh, C.blue].map((v) => <g key={v}><line x1={P} x2={W - 8} y1={y(v)} y2={y(v)} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth=".7" /><text x={2} y={y(v) + 4} fontSize="10" fill="#5b6270">{v}%</text></g>)}
      <polyline fill="none" stroke="#0a0a0a" strokeWidth="1.6" points={pts.map((d, i) => `${x(i)},${y(d.cm2Pct)}`).join(' ')} />
      {pts.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.cm2Pct)} r={i === selIdx ? 5 : 2.2} fill={`var(--${d.colour})`} stroke={i === selIdx ? '#0a0a0a' : 'none'}><title>{`${d.date}: CM2 ${pct(d.cm2Pct)}`}</title></circle>)}
      <text x={P} y={H - 3} fontSize="10" fill="#5b6270">{pts[0].date}</text><text x={W - 70} y={H - 3} fontSize="10" fill="#5b6270">{pts.at(-1).date}</text>
    </svg>
  );
}

function DayDetail({ id, res, fc, date, onChange }) {
  const [days, setDays] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const from = new Date(`${date}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 45);
    api(`/runs/${id}/days?fc=${encodeURIComponent(fc)}&from=${from.toISOString().slice(0, 10)}&to=${date}`).then(setDays).catch((e) => setErr(e.message));
  }, [id, fc, date, tick]);
  if (err) return <div className="error">{err}</div>;
  if (!days) return <p className="muted">Loading…</p>;
  const d = days.find((x) => x.date === date);
  if (!d) return <p className="muted">No data for {fc} on {date}.</p>;
  const rules = res.rules;
  const target = (k) => ({ ...rules.lines[k], ...(rules.fcOverrides?.[fc]?.[k] || {}) });
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row"><h2 style={{ margin: 0 }}>{fc} · {date}</h2><span className={`chip c-${d.colour}`}>{d.colour}{d.cm2Pct !== null ? ` · CM2 ${pct(d.cm2Pct)}` : ''}</span><span className="muted">{CLASS[d.dayClass]}</span></div>
      {d.insight && <div className="insight">{d.insight}<div className="muted small">written by {d.insightSource === 'llm' ? 'local AI (numbers checked)' : 'rules engine'}</div></div>}
      {d.trends?.length > 0 && <div className="note small"><b>Watch:</b> {d.trends.map((t) => t.text).join(' · ')}</div>}
      <div className="grid2">
        <div>
          {d.status === 'OK' ? (
            <table>
              <thead><tr><th>Line</th><th className="num">₹</th><th className="num">% rev</th><th>Target</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr><td><b>Revenue</b></td><td className="num"><b>{inr(d.revenue)}</b></td><td /><td /><td /><td /></tr>
                {LINES.map((k) => {
                  const a = d.anomalies.find((x) => x.key === k); const t = target(k);
                  return <tr key={k}><td>{t.label}</td><td className="num">{inr(d.costs[k])}</td><td className="num">{pct(d.pct[k])}</td><td className="muted">{t.min}–{t.max}%</td>
                    <td>{a ? <span className={a.override ? 'muted' : 'bad'}>{a.status === 'ABOVE_MAX' ? '▲ above' : '▼ below'} · {inr(a.impactRs)}{a.override ? ` (${a.override.type})` : ''}</span> : <span style={{ color: 'var(--GREEN)' }}>ok</span>}</td>
                    <td>{a && <OverrideButtons a={a} onDone={() => { setTick((x) => x + 1); onChange(); }} />}</td></tr>;
                })}
                {[['cm1', 'CM1', d.cm1, d.cm1Pct], ['cm2', 'CM2', d.cm2, d.cm2Pct]].map(([k, l, v, p]) => {
                  const a = d.anomalies.find((x) => x.key === k);
                  return <tr key={k}><td><b>{l}</b></td><td className="num"><b>{inr(v)}</b></td><td className="num"><b>{pct(p)}</b></td><td className="muted">{rules[k].min}–{rules[k].max}% (±{rules[k].tolerancePp})</td><td>{a ? <span className={a.override ? 'muted' : 'bad'}>{a.status === 'BELOW_TARGET' ? '▼ below' : '▲ above'}{a.override ? ` (${a.override.type})` : ''}</span> : <span style={{ color: 'var(--GREEN)' }}>ok</span>}</td><td>{a && <OverrideButtons a={a} onDone={() => { setTick((x) => x + 1); onChange(); }} />}</td></tr>;
                })}
              </tbody>
            </table>
          ) : <div className="error">Data problem ({d.anomalies[0]?.status}): margins were not computed for this day. Fix the source row and re-upload.</div>}
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>CM2 % over the last {days.length} days</h3>
          <TrendChart days={days} date={date} rules={rules} />
          {d.facts?.baseline && <p className="small muted">"Normal" = median of this FC's previous {d.facts.baseline.days} days (revenue {inr(d.facts.baseline.revenue)}). A breach is labelled "low revenue" when the rupee amount was normal but revenue fell.</p>}
        </div>
      </div>
    </div>
  );
}

function OverrideButtons({ a, onDone }) {
  const [err, setErr] = useState('');
  if (a.override) return <button className="link small" onClick={async () => { await api(`/overrides/${a.override.id}`, { method: 'DELETE' }); onDone(); }}>undo</button>;
  const add = async (type) => {
    const note = prompt(type === 'explained' ? `Why is ${a.line} off on ${a.date}? (shown in future insights)` : `Snooze ${a.line} alerts for ${a.fc}. Optional note:`);
    if (note === null) return;
    let until = null;
    if (type === 'snooze') { const d = new Date(`${a.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); until = d.toISOString().slice(0, 10); }
    try { await post('/overrides', { fc: a.fc, date: a.date, line: a.key, type, note, until }); onDone(); } catch (e) { setErr(e.message); alert(e.message); }
  };
  return <span className="row small" style={{ flexWrap: "nowrap", whiteSpace: "nowrap" }} title={err}><button className="link" onClick={() => add('explained')}>explain</button><button className="link" onClick={() => add('snooze')}>snooze 7d</button></span>;
}

function Anomalies({ id, res, onOpen }) {
  const [f, setF] = useState({ fc: '', severity: '', line: '', date: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); q.set('limit', 1000); api(`/runs/${id}/anomalies?${q}`).then(setData).catch((e) => setErr(e.message)); }, [id, f]);
  const lineNames = ['CM1', 'CM2', ...LINES.map((k) => res.rules.lines[k].label), 'Data'];
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={f.fc} onChange={(e) => setF({ ...f, fc: e.target.value })}><option value="">All FCs</option>{res.summary.fcs.map((x) => <option key={x.fc}>{x.fc}</option>)}</select>
        <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">Any severity</option><option>HIGH</option><option>MED</option><option>LOW</option></select>
        <select value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })}><option value="">Any line</option>{lineNames.map((l) => <option key={l}>{l}</option>)}</select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        {data && <span className="muted small">{data.total} row(s){data.total > data.rows.length ? `, showing ${data.rows.length}; download the CSV for all` : ''}</span>}
      </div>
      {err && <div className="error">{err}</div>}
      {data && <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>FC</th><th>Line Item</th><th className="num">% of Revenue</th><th>Target Range</th><th>Status</th><th className="num">Impact</th><th>Severity</th><th>Insight</th></tr></thead>
        <tbody>{data.rows.map((a, i) => (
          <tr key={i} className="click" onClick={() => onOpen(a.fc, a.date)} style={a.override ? { opacity: 0.55 } : null}>
            <td style={{ whiteSpace: 'nowrap' }}><span className={`chip c-${a.colour}`} style={{ marginRight: 5 }}>&nbsp;</span>{a.date}</td><td>{a.fc}</td><td>{a.line}</td><td className="num">{pct(a.pct)}</td><td>{a.target}</td><td>{a.status}{a.override ? ` · ${a.override.type}` : ''}</td><td className="num">{a.impactRs ? inr(a.impactRs) : ''}</td><td><span className={`sev ${a.severity}`}>{a.severity}</span></td>
            <td className="small" style={{ minWidth: 340 }}>{a.insight}</td>
          </tr>))}</tbody>
      </table></div>}
    </>
  );
}

function Digests({ id, run, onSent }) {
  const dates = useMemo(() => [...new Set(run.result.grid.map((g) => g[1]))].sort().reverse(), [run]);
  const [date, setDate] = useState(run.result.summary.lastDate);
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { setData(null); api(`/runs/${id}/digests?date=${date}`).then(setData).catch((e) => setErr(e.message)); }, [id, date]);
  const unconfigured = data?.digests?.filter((d) => !d.email) || [];
  const send = async () => {
    if (unconfigured.length > 0) {
      alert(`Set mail ID for the given FC center (${unconfigured.map((d) => d.fc).join(', ')}) from Targets & managers.`);
      return;
    }
    if (!confirm(`Send ${data.digests.length} digest(s) for ${date}?${data.channels.email ? ` Email via ${data.channels.email}${data.channels.redirectTo ? ` (redirected to ${data.channels.redirectTo})` : ' to each FC manager'}.` : ' No SMTP configured: they will be written to the outbox folder only.'}`)) return;
    setSending(true); setErr('');
    try { await post(`/runs/${id}/send`, { date }); setTimeout(onSent, 800); } catch (e) { setErr(e.message); } finally { setTimeout(() => setSending(false), 1500); }
  };
  const del = run.delivery;
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <b>Digest date</b><select value={date} onChange={(e) => setDate(e.target.value)}>{dates.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="primary" disabled={!data || sending || run.sending || unconfigured.length > 0} onClick={send}>{run.sending || sending ? 'Sending…' : `Send digests for ${sd(date)}`}</button>
        {data && <span className="muted small">Channel: {data.channels.email ? `email via ${data.channels.email}` : 'outbox folder only (set SMTP_HOST in .env to email)'}{data.channels.slack ? ' + Slack' : ''}{data.channels.redirectTo ? ` · all mail redirected to ${data.channels.redirectTo}` : ''}</span>}
      </div>
      {data && unconfigured.length > 0 && (
        <div className="note small" style={{ marginBottom: 10, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: '4px' }}>
          ⚠️ <b>No email configured for {unconfigured.map((d) => d.fc).join(', ')}</b>. Set mail ID for the given FC center from Targets &amp; managers before sending.
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {del && <div className="card" style={{ marginBottom: 12 }}>
        <b>Last delivery</b> <span className="muted small">{new Date(del.summary.at).toLocaleString()} · digest date {del.summary.date} · {del.summary.emailed} emailed{del.summary.emailFailed ? `, ${del.summary.emailFailed} failed` : ''}{del.summary.slack ? `, ${del.summary.slack} to Slack` : ''} · copies in data/{del.summary.outbox}</span>
        {del.summary.error && <div className="error">{del.summary.error}</div>}
        <table style={{ marginTop: 8 }}><thead><tr><th>FC</th><th>To</th><th>Email</th><th>Slack</th><th>Subject</th></tr></thead>
          <tbody>{del.results.map((r) => <tr key={r.fc}><td>{r.fc}</td><td className="small">{r.to || '—'}{r.to && r.intendedTo && r.to !== r.intendedTo ? <span className="muted"> (for {r.intendedTo})</span> : null}</td><td className={r.email === 'failed' ? 'bad' : ''} title={r.error || ''}>{r.email}</td><td>{r.slack}</td><td className="small">{r.subject}</td></tr>)}</tbody></table>
      </div>}
      {!data ? <p className="muted">Building digests…</p> : (
        <div className="grid2" style={{ gridTemplateColumns: '280px 1fr' }}>
          <div>{data.digests.map((d, i) => (
            <div key={d.fc} className="card click" style={{ marginBottom: 6, cursor: 'pointer', borderColor: pick === i ? 'var(--blue)' : undefined }} onClick={() => setPick(i)}>
              <div className="row"><span className={`chip c-${d.colour}`}>{d.colour}</span><b>{d.fc}</b></div>
              <div className="small muted">{d.manager || 'no manager set'} · {d.email || 'no email'}{d.issues ? ` · ${d.issues} issue(s)` : ''}</div>
            </div>))}</div>
          <div><div className="small muted" style={{ marginBottom: 4 }}>Subject: {data.digests[pick]?.subject}</div><iframe className="preview" title="digest preview" sandbox="" srcDoc={data.digests[pick]?.html} /></div>
        </div>
      )}
    </>
  );
}

function Ask({ id, onOpen }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const examples = ['Why was FC-PUNE red on Jul 8?', 'Which FCs were red on Aug 8?', 'Worst days for FC-KOL', 'Manpower breaches', 'How is FC-DELHI doing?'];
  const run = async (question) => {
    setErr(''); setBusy(true);
    try { setA(await post(`/runs/${id}/ask`, { question })); } catch (e) { setErr(e.message); setA(null); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <h2>Ask about this run</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input style={{ flex: 1, minWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why was FC-PUNE red on Jul 8?" maxLength={500} />
        <button className="primary" disabled={busy}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <div className="row small" style={{ marginTop: 8 }}>{examples.map((x) => <button key={x} className="link" onClick={() => { setQ(x); run(x); }}>{x}</button>)}</div>
      {err && <div className="error">{err}</div>}
      {a && <div className="answer">{a.text}
        {a.days?.length > 0 && <div className="row small" style={{ marginTop: 8 }}>{a.days.map((d) => <button key={d.fc + d.date} className="link" onClick={() => onOpen(d.fc, d.date)}><span className={`chip c-${d.colour}`}>{d.fc} {sd(d.date)}</span></button>)}</div>}
        <div className="muted small" style={{ marginTop: 6 }}>Answered from the computed data ({a.via === 'llm-intent' ? 'question understood by local AI' : 'question understood by rules'}).</div></div>}
    </div>
  );
}

function Issues({ res }) {
  if (!res.issues.length) return <p className="muted">No data issues: every row was read cleanly.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Level</th><th>FC</th><th>Date</th><th>Issue</th><th>Detail</th><th>Where</th></tr></thead>
      <tbody>{res.issues.map((i, k) => <tr key={k}><td className={i.level === 'error' ? 'bad' : ''}>{i.level}</td><td>{i.fc || ''}</td><td>{i.date || ''}</td><td>{i.issue}</td><td>{i.detail}</td><td className="small muted">{i.source}</td></tr>)}</tbody>
    </table></div>
  );
}

/* ---------------------------------------------------------------- Settings */
function Settings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [newFc, setNewFc] = useState('');
  const [newMgr, setNewMgr] = useState('');
  const [newEmail, setNewEmail] = useState('');
  useEffect(() => { api('/settings').then(setS).catch((e) => setErr(e.message)); }, []);
  if (!s) return err ? <div className="error">{err}</div> : <p className="muted">Loading…</p>;
  const r = s.rules;
  const setLine = (k, f, v) => setS({ ...s, rules: { ...r, lines: { ...r.lines, [k]: { ...r.lines[k], [f]: v === '' ? '' : Number(v) } } } });
  const setCm = (k, f, v) => setS({ ...s, rules: { ...r, [k]: { ...r[k], [f]: Number(v) } } });
  const setCol = (f, v) => setS({ ...s, rules: { ...r, colour: { ...r.colour, [f]: Number(v) } } });
  const mgr = s.fcs.managers || {};
  const setMgr = (fc, f, v) => setS({ ...s, fcs: { ...s.fcs, managers: { ...mgr, [fc]: { ...mgr[fc], [f]: v } } } });
  const removeFc = (fcToRemove) => {
    const copy = { ...mgr };
    delete copy[fcToRemove];
    setS({ ...s, fcs: { ...s.fcs, managers: copy } });
  };
  const addFc = () => {
    const name = newFc.trim();
    if (!name) return;
    setS({
      ...s,
      fcs: {
        ...s.fcs,
        managers: {
          ...mgr,
          [name]: { manager: newMgr.trim() || `${name} Manager`, email: newEmail.trim() }
        }
      }
    });
    setNewFc(''); setNewMgr(''); setNewEmail('');
  };
  const save = async () => { setErr(''); setMsg(''); try { setS(await api('/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) })); setMsg('Saved. New runs use these settings (earlier runs keep the targets they were computed with).'); } catch (e) { setErr(e.message); } };
  const reset = async () => { if (!confirm('Reset targets and managers to the defaults in config/?')) return; setS(await api('/settings', { method: 'DELETE' })); setMsg('Reset to defaults.'); };
  const n = (v, on) => <input type="number" step="0.1" style={{ width: 80 }} value={v} onChange={(e) => on(e.target.value)} />;
  return (
    <>
      <div className="grid2">
        <div className="card">
          <h2>Target ranges (% of revenue)</h2>
          {r._note && <div className="note small">{r._note}</div>}
          <table><thead><tr><th>Line</th><th>Min</th><th>Max</th></tr></thead>
            <tbody>{LINES.map((k) => <tr key={k}><td>{r.lines[k].label}</td><td>{n(r.lines[k].min, (v) => setLine(k, 'min', v))}</td><td>{n(r.lines[k].max, (v) => setLine(k, 'max', v))}</td></tr>)}
              {['cm1', 'cm2'].map((k) => <tr key={k}><td><b>{k.toUpperCase()}</b> (flag beyond ±{n(r[k].tolerancePp, (v) => setCm(k, 'tolerancePp', v))} pp)</td><td>{n(r[k].min, (v) => setCm(k, 'min', v))}</td><td>{n(r[k].max, (v) => setCm(k, 'max', v))}</td></tr>)}
            </tbody></table>
          <h3>Colour bands (CM2 %)</h3>
          <div className="row small">Red below {n(r.colour.red, (v) => setCol('red', v))} · Green from {n(r.colour.yellowLow, (v) => setCol('yellowLow', v))} to {n(r.colour.yellowHigh, (v) => setCol('yellowHigh', v))} · Blue from {n(r.colour.blue, (v) => setCol('blue', v))} · Yellow in between</div>
        </div>
        <div className="card">
          <h2>FC managers (digest recipients)</h2>
          <p className="muted small">Digest emails are routed strictly to the email configured for each FC center.</p>
          <table><thead><tr><th>FC</th><th>Manager</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {Object.entries(mgr).map(([fc, m]) => (
                <tr key={fc}>
                  <td><b>{fc}</b></td>
                  <td><input value={m.manager || ''} onChange={(e) => setMgr(fc, 'manager', e.target.value)} placeholder="Manager name" /></td>
                  <td><input type="email" value={m.email || ''} onChange={(e) => setMgr(fc, 'email', e.target.value)} placeholder="manager@example.com" /></td>
                  <td><button className="link bad small" onClick={() => removeFc(fc)}>Remove</button></td>
                </tr>
              ))}
              {Object.keys(mgr).length === 0 && (
                <tr><td colSpan={4} className="muted small" style={{ textAlign: 'center', padding: '12px' }}>No FC managers configured. Add one below.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#f9fafb', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Add FC Center &amp; Email ID</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input placeholder="FC Name (e.g. FC-Gurugram)" value={newFc} onChange={(e) => setNewFc(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
              <input placeholder="Manager (optional)" value={newMgr} onChange={(e) => setNewMgr(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
              <input type="email" placeholder="Email (e.g. user@gmail.com)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ flex: 1.5, minWidth: 160 }} />
              <button className="primary" disabled={!newFc.trim()} onClick={addFc}>Add FC</button>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Email server, Slack webhook and AI are configured in <code>.env</code>.</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={save}>Save settings</button><button onClick={reset}>Reset to defaults</button>
      </div>
      {msg && <div className="note">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </>
  );
}
