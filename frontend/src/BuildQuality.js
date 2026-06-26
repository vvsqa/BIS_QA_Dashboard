import React, { useState, useEffect, useCallback } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, LineController, Title, Tooltip, Legend,
} from 'chart.js';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import { TicketJourney } from './TicketSpeed';
import './dashboard.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, LineController, Title, Tooltip, Legend);

// Shared dark-theme-friendly chart styling (mirrors TicketSpeed)
const AXIS = 'rgba(148,163,184,0.85)';
const GRID = 'rgba(148,163,184,0.12)';
const chartOpts = (extra = {}) => ({
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false, labels: { color: AXIS, font: { size: 11 } } },
    tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: GRID, borderWidth: 1, padding: 8 },
  },
  scales: {
    x: { ticks: { color: AXIS, font: { size: 10 } }, grid: { color: GRID } },
    y: { ticks: { color: AXIS, font: { size: 10 } }, grid: { color: GRID }, beginAtZero: true },
  },
  ...extra,
});

const PM_TICKET_URL = 'https://pm.bissafety.app/tickets/';

const PERIOD_KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'all', label: 'All time' },
];
const PLATFORMS = [
  { value: 'all', label: 'All' },
  { value: 'web', label: 'Web' },
  { value: 'mobile', label: 'Mobile' },
];
const MIN_REFIX_OPTS = [
  { value: 1, label: 'All failures (1×+)' },
  { value: 2, label: 'Repeat offenders (2×+)' },
  { value: 3, label: 'Chronic (3×+)' },
];

function monthOptions(n = 24) {
  const now = new Date();
  const o = [];
  for (let k = 0; k < n; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    o.push({ offset: k, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return o;
}
function quarterOptions(n = 8) {
  const now = new Date();
  const cur = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
  const o = [];
  for (let k = 0; k < n; k++) { const idx = cur - k; o.push({ offset: k, label: `Q${(idx % 4) + 1} ${Math.floor(idx / 4)}` }); }
  return o;
}

const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const downloadCsv = (name, headers, rows) => {
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(r.map(csvEsc).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};

// Small delta chip vs the previous period. For reject-rate "down is good" → green when negative.
function Delta({ now, prev, suffix = '', goodWhenDown = false }) {
  if (prev == null || now == null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <div className="bq-delta bq-delta-flat">±0{suffix} vs prev</div>;
  const up = d > 0;
  const good = goodWhenDown ? !up : up;
  return (
    <div className={`bq-delta ${good ? 'bq-delta-good' : 'bq-delta-bad'}`}>
      {up ? '▲' : '▼'} {Math.abs(d)}{suffix} vs prev
    </div>
  );
}

// Reject-rate badge by severity
const rejectColor = (v) => (v >= 35 ? 'var(--accent-red)' : v >= 20 ? 'var(--accent-amber)' : 'var(--accent-green)');

function FailRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <React.Fragment>
      <tr className="qcq-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center' }}><a href={`${PM_TICKET_URL}${row.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link" onClick={e => e.stopPropagation()}>#{row.ticket_id}</a></td>
        <td style={{ maxWidth: '240px', whiteSpace: 'normal', textAlign: 'left' }}>{row.title} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{open ? '▲' : '▼'}</span></td>
        <td style={{ textAlign: 'center' }}>{row.module}</td>
        <td style={{ textAlign: 'center' }}>{row.platform}</td>
        <td style={{ textAlign: 'center' }}>{row.backend_developer || '–'}</td>
        <td style={{ textAlign: 'center' }}>{row.frontend_developer || '–'}</td>
        <td style={{ textAlign: 'center' }}>
          <span className="bq-refix-badge" style={{ background: row.fail_events >= 3 ? 'var(--accent-red)' : row.fail_events === 2 ? 'var(--accent-amber)' : 'var(--accent-blue)' }}>{row.fail_events}×</span>
        </td>
        <td style={{ textAlign: 'center' }}>{row.current_status || '–'}</td>
        <td style={{ textAlign: 'center' }}>{row.qc_tester || '–'}</td>
        <td style={{ textAlign: 'center' }}>{(row.last_failed_on || '').slice(0, 10) || '–'}</td>
      </tr>
      {open && (
        <tr className="qcq-expand-row"><td colSpan={10} style={{ padding: '8px 14px' }}><TicketJourney ticketId={row.ticket_id} /></td></tr>
      )}
    </React.Fragment>
  );
}

export default function BuildQuality() {
  const [kind, setKind] = useState('quarter');
  const [offset, setOffset] = useState(0);
  const [platform, setPlatform] = useState('all');
  const [moduleF, setModuleF] = useState('');
  const [developerF, setDeveloperF] = useState('');
  const [minRefix, setMinRefix] = useState(1);
  const [search, setSearch] = useState('');
  const [hideThin, setHideThin] = useState(true);     // hide devs/modules with <3 delivered
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [devSort, setDevSort] = useState('reject_pct');
  const [modSort, setModSort] = useState('reject_pct');

  const buildQuery = useCallback((off) => {
    const p = new URLSearchParams();
    p.set('period', kind);
    if (kind !== 'all') p.set('offset', String(off));
    if (platform !== 'all') p.set('platform', platform);
    if (moduleF) p.set('module', moduleF);
    if (developerF) p.set('developer', developerF);
    if (minRefix > 1) p.set('min_refix', String(minRefix));
    return p.toString();
  }, [kind, platform, moduleF, developerF, minRefix]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/build-quality?${buildQuery(offset)}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
      // previous period (for deltas) — best-effort, only when a period is selected
      if (kind !== 'all') {
        try {
          const pr = await fetch(`${API_BASE}/build-quality?${buildQuery(offset + 1)}`);
          setPrev(pr.ok ? await pr.json() : null);
        } catch { setPrev(null); }
      } else { setPrev(null); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [buildQuery, offset, kind]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const s = data?.summary || {};
  const ps = prev?.summary || {};

  // Module / developer dropdown options come from the response aggregations
  const moduleOptions = [...new Set((data?.by_module || []).map(m => m.name))].filter(Boolean).sort();
  const devOptions = [...new Set((data?.by_developer || []).map(d => d.name))].filter(d => d && d !== 'Unassigned').sort();

  const sortAgg = (rows, key) => [...rows]
    .filter(r => !hideThin || r.reached_qc >= 3)
    .sort((a, b) => (b[key] - a[key]) || (b.failed - a.failed));
  const devRows = sortAgg(data?.by_developer || [], devSort).filter(r => r.name && r.name !== 'Unassigned');
  const modRows = sortAgg(data?.by_module || [], modSort);

  // Most-failed tickets (client-side ticket-id search on top of server filters)
  const tickets = (data?.tickets || []).filter(t =>
    !search || String(t.ticket_id).includes(search) || (t.title || '').toLowerCase().includes(search.toLowerCase())
  );

  // ----- Charts -----
  const trend = data?.trend || [];
  const trendData = {
    labels: trend.map(t => t.label),
    datasets: [
      { type: 'bar', label: 'Fail events', data: trend.map(t => t.fail_events), backgroundColor: 'rgba(239,68,68,0.30)', borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Reject rate %', data: trend.map(t => t.reject_pct), borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.3, pointRadius: 3, yAxisID: 'y1', order: 1 },
    ],
  };
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'top', labels: { color: AXIS, font: { size: 10 }, boxWidth: 12 } }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)' } },
    scales: {
      x: { ticks: { color: AXIS, font: { size: 9 } }, grid: { color: GRID } },
      y: { position: 'left', beginAtZero: true, ticks: { color: AXIS, font: { size: 9 } }, grid: { color: GRID }, title: { display: true, text: 'Fail events', color: AXIS, font: { size: 9 } } },
      y1: { position: 'right', beginAtZero: true, max: 100, ticks: { color: AXIS, font: { size: 9 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Reject %', color: AXIS, font: { size: 9 } } },
    },
  };

  const refixDist = data?.refix_distribution || [];
  const refixData = {
    labels: refixDist.map(b => b.bucket),
    datasets: [{ label: 'Tickets', data: refixDist.map(b => b.count), backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444'], borderRadius: 6 }],
  };

  const devChart = {
    labels: devRows.slice(0, 10).map(d => d.name),
    datasets: [{ label: 'Reject %', data: devRows.slice(0, 10).map(d => d.reject_pct), backgroundColor: '#ef4444', borderRadius: 4 }],
  };
  const modChart = {
    labels: modRows.slice(0, 10).map(m => m.name),
    datasets: [{ label: 'Reject %', data: modRows.slice(0, 10).map(m => m.reject_pct), backgroundColor: '#f59e0b', borderRadius: 4 }],
  };

  const exportDevs = () => downloadCsv(
    `build-quality_devs_${(s.window_label || '').replace(/\s+/g, '-')}.csv`,
    ['Developer', 'Delivered', 'Failed', 'Fail events', 'Reject %', 'FPY %'],
    devRows.map(d => [d.name, d.reached_qc, d.failed, d.fail_events, d.reject_pct, d.fpy_pct]));
  const exportMods = () => downloadCsv(
    `build-quality_modules_${(s.window_label || '').replace(/\s+/g, '-')}.csv`,
    ['Module', 'Delivered', 'Failed', 'Fail events', 'Reject %', 'FPY %'],
    modRows.map(m => [m.name, m.reached_qc, m.failed, m.fail_events, m.reject_pct, m.fpy_pct]));
  const exportTickets = () => downloadCsv(
    `build-quality_tickets_${(s.window_label || '').replace(/\s+/g, '-')}.csv`,
    ['Ticket', 'Title', 'Module', 'Platform', 'Backend dev', 'Frontend dev', 'Refixes', 'Fail events', 'Current status', 'QC tester', 'First failed', 'Last failed'],
    tickets.map(t => [t.ticket_id, t.title, t.module, t.platform, t.backend_developer, t.frontend_developer, t.refix_count, t.fail_events, t.current_status, t.qc_tester, (t.first_failed_on || '').slice(0, 10), (t.last_failed_on || '').slice(0, 10)]));

  const AggTable = ({ title, rows, keyLabel, sortKey, setSort, onExport }) => (
    <div className="qcq-section" style={{ marginTop: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '0.95rem', margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{rows.length} {keyLabel.toLowerCase()}s · sorted by {sortKey === 'reject_pct' ? 'reject %' : sortKey}</span>
        <button className="btn btn-sm btn-primary" onClick={onExport} disabled={rows.length === 0} style={{ marginLeft: 'auto' }}>Export CSV</button>
      </div>
      <div className="qcq-table-container">
        <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
          <thead><tr>
            <th style={{ textAlign: 'left' }}>{keyLabel}</th>
            <th onClick={() => setSort('reached_qc')} style={{ cursor: 'pointer' }}>Delivered{sortKey === 'reached_qc' ? ' ▼' : ''}</th>
            <th onClick={() => setSort('failed')} style={{ cursor: 'pointer' }}>Failed{sortKey === 'failed' ? ' ▼' : ''}</th>
            <th onClick={() => setSort('fail_events')} style={{ cursor: 'pointer' }}>Fail events{sortKey === 'fail_events' ? ' ▼' : ''}</th>
            <th onClick={() => setSort('reject_pct')} style={{ cursor: 'pointer' }}>Reject %{sortKey === 'reject_pct' ? ' ▼' : ''}</th>
            <th onClick={() => setSort('fpy_pct')} style={{ cursor: 'pointer' }}>FPY %{sortKey === 'fpy_pct' ? ' ▼' : ''}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="qcq-row">
                <td style={{ textAlign: 'left' }}>{r.name}</td>
                <td style={{ textAlign: 'center' }}>{r.reached_qc}</td>
                <td style={{ textAlign: 'center' }}>{r.failed}</td>
                <td style={{ textAlign: 'center' }}>{r.fail_events}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: rejectColor(r.reject_pct) }}>{pct(r.reject_pct)}</td>
                <td style={{ textAlign: 'center', color: 'var(--accent-green)' }}>{pct(r.fpy_pct)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '14px' }}>No data for this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Build Quality</h1>
            <p className="header-subtitle">
              How good are the builds dev hands to QA?{s.window_label ? ` — ${s.window_label}` : ''}
              {s.tracking_since ? <span style={{ color: 'var(--text-muted)' }}> · transition tracking since {s.tracking_since}</span> : null}
            </p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="qcq-platform-toggle">
              {PERIOD_KINDS.map(k => <button key={k.value} className={`btn btn-sm ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setKind(k.value); setOffset(0); }}>{k.label}</button>)}
            </div>
            {kind !== 'all' && (
              <select className="qcq-search-input" style={{ minWidth: '140px' }} value={offset} onChange={e => setOffset(Number(e.target.value))}>
                {(kind === 'quarter' ? quarterOptions() : monthOptions()).map(o => <option key={o.offset} value={o.offset}>{o.label}</option>)}
              </select>
            )}
            <div className="qcq-platform-toggle">
              {PLATFORMS.map(p => <button key={p.value} className={`btn btn-sm ${platform === p.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatform(p.value)}>{p.label}</button>)}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading build quality…</p></div>
        ) : error ? (
          <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn btn-primary">Retry</button></div>
        ) : (
          <>
            <div className="qcq-status-cards">
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
                <div className="qcq-card-value" style={{ color: 'var(--accent-green)' }}>{pct(s.first_pass_yield_pct)}</div>
                <div className="qcq-card-label">First-Pass Yield</div>
                <Delta now={s.first_pass_yield_pct} prev={ps.first_pass_yield_pct} suffix="%" />
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-red)' }}>
                <div className="qcq-card-value" style={{ color: 'var(--accent-red)' }}>{pct(s.reject_rate_pct)}</div>
                <div className="qcq-card-label">QC Reject Rate</div>
                <Delta now={s.reject_rate_pct} prev={ps.reject_rate_pct} suffix="%" goodWhenDown />
              </div>
              <div className="qcq-card qcq-card-total">
                <div className="qcq-card-value">{s.failed_tickets || 0}</div>
                <div className="qcq-card-label">Tickets failed QC</div>
                <div className="qcq-card-sub">of {s.reached_qc || 0} reaching QC</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-amber)' }}>
                <div className="qcq-card-value">{s.fail_events || 0}</div>
                <div className="qcq-card-label">Total fail events</div>
                <Delta now={s.fail_events} prev={ps.fail_events} goodWhenDown />
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
                <div className="qcq-card-value">{s.avg_refix_per_failed || 0}</div>
                <div className="qcq-card-label">Avg refixes / failed</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-red)' }}>
                <div className="qcq-card-value">{s.repeat_offenders || 0}</div>
                <div className="qcq-card-label">Repeat offenders (≥2×)</div>
              </div>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: '6px 0 10px' }}>
              A build "fails" when its ticket enters <b>QC Review Fail</b> at least once. First-Pass Yield + Reject Rate sum to 100%.
              Status-transition capture began {s.tracking_since || '~2026'} — First-Pass Yield for older periods is understated for tickets with no recorded history.
            </p>

            {/* Charts row */}
            <div className="tspd-analytics">
              <div className="tspd-chart-card">
                <h4 className="tspd-chart-title">Reject trend <span className="tspd-chart-sub">reject % (line) over fail events (bars), last 12 months</span></h4>
                <div className="tspd-chart-body"><Bar data={trendData} options={trendOpts} /></div>
              </div>
              <div className="tspd-chart-card">
                <h4 className="tspd-chart-title">Refix distribution <span className="tspd-chart-sub">how many times failed tickets bounced</span></h4>
                <div className="tspd-chart-body"><Bar data={refixData} options={chartOpts()} /></div>
              </div>
              <div className="tspd-chart-card">
                <h4 className="tspd-chart-title">Worst developers <span className="tspd-chart-sub">reject % (both devs credited)</span></h4>
                <div className="tspd-chart-body"><Bar data={devChart} options={chartOpts({ indexAxis: 'y' })} /></div>
              </div>
              <div className="tspd-chart-card">
                <h4 className="tspd-chart-title">Worst modules <span className="tspd-chart-sub">reject %</span></h4>
                <div className="tspd-chart-body"><Bar data={modChart} options={chartOpts({ indexAxis: 'y' })} /></div>
              </div>
            </div>

            {/* Filter bar */}
            <div className="filter-section" style={{ display: 'flex', gap: '8px', margin: '14px 0 6px', flexWrap: 'wrap', alignItems: 'center', position: 'sticky', top: 0, zIndex: 5 }}>
              <select className="qcq-search-input" value={moduleF} onChange={e => setModuleF(e.target.value)}><option value="">All modules</option>{moduleOptions.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <select className="qcq-search-input" value={developerF} onChange={e => setDeveloperF(e.target.value)}><option value="">All developers</option>{devOptions.map(d => <option key={d} value={d}>{d}</option>)}</select>
              <select className="qcq-search-input" value={minRefix} onChange={e => setMinRefix(Number(e.target.value))}>{MIN_REFIX_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              <input className="qcq-search-input" placeholder="Search ticket / title…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: '180px' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                <input type="checkbox" checked={hideThin} onChange={e => setHideThin(e.target.checked)} /> Hide &lt;3 delivered (noisy rates)
              </label>
            </div>

            <AggTable title="Worst developers" rows={devRows} keyLabel="Developer" sortKey={devSort} setSort={setDevSort} onExport={exportDevs} />
            <AggTable title="Worst modules" rows={modRows} keyLabel="Module" sortKey={modSort} setSort={setModSort} onExport={exportMods} />

            <div className="qcq-section" style={{ marginTop: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '0.95rem', margin: 0, color: 'var(--text-primary)' }}>Most-failed tickets</h3>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{tickets.length} tickets · click a row for its full QC bounce journey</span>
                <button className="btn btn-sm btn-primary" onClick={exportTickets} disabled={tickets.length === 0} style={{ marginLeft: 'auto' }}>Export CSV</button>
              </div>
              <div className="qcq-table-container">
                <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                  <thead><tr>
                    <th>Ticket</th>
                    <th style={{ textAlign: 'left' }}>Title</th>
                    <th>Module</th>
                    <th>Platform</th>
                    <th>Backend dev</th>
                    <th>Frontend dev</th>
                    <th>Refixes</th>
                    <th>Current status</th>
                    <th>QC tester</th>
                    <th>Last failed</th>
                  </tr></thead>
                  <tbody>
                    {tickets.map(t => <FailRow key={t.ticket_id} row={t} />)}
                    {tickets.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '14px' }}>No failed tickets match these filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
              Reject Rate = failed tickets ÷ tickets that reached QC, within the selected window (applied to the fail event's date).
              Developer totals credit BOTH backend &amp; frontend devs, so the per-developer "failed" sum can exceed the ticket count.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
