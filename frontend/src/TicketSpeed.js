import React, { useState, useEffect, useCallback } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

// Shared dark-theme-friendly chart styling
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
const avgOf = (arr) => { const v = arr.filter(x => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0; };
// green → amber → red intensity for the performance heatmap (invert for "higher is better" metrics)
const heatBg = (v, max, invert = false) => {
  if (v == null || max <= 0) return 'transparent';
  let t = Math.min(1, v / max); if (invert) t = 1 - t;
  const hue = (1 - t) * 130; // 130=green, 0=red
  return `hsla(${hue}, 68%, 45%, ${0.18 + 0.55 * t})`;
};

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

const PERIOD_KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'all', label: 'All time' },
];
const SCOPES = [
  { value: 'closed', label: 'Closed in period' },
  { value: 'active', label: 'Currently open' },
  { value: 'all', label: 'All' },
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

const PHASE_COLORS = {
  Dev: '#3b82f6', 'Code Review': '#a855f7', QC: '#f59e0b', BIS: '#06b6d4', Approved: '#22c55e', Closed: '#64748b', Other: '#94a3b8',
};
const dayColor = (d) => (d >= 7 ? 'var(--accent-red)' : d >= 3 ? 'var(--accent-amber)' : 'var(--accent-green)');
const fmt = (v, suffix = '') => (v === null || v === undefined ? '–' : `${v}${suffix}`);

// Expanded per-ticket journey (lazy-loaded)
function TicketJourney({ ticketId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/tickets/${ticketId}/movement`).then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ticketId]);
  if (loading) return <div style={{ padding: '10px', color: 'var(--text-muted)' }}>Loading journey…</div>;
  if (!data) return <div style={{ padding: '10px', color: 'var(--text-muted)' }}>No movement data.</div>;
  const s = data.summary || {};
  const legs = data.journey || [];
  const phaseDays = data.phase_days || {};
  const phaseMax = Math.max(1, ...Object.values(phaseDays));
  return (
    <div className="tspd-journey">
      <div className="tspd-metrics">
        <span>Lead time: <b>{fmt(s.lead_time_days, 'd')}</b></span>
        <span>Dev→QC: <b>{fmt(s.dev_to_qc_days, 'd')}</b></span>
        <span>QC→BIS: <b>{fmt(s.qc_to_bis_days, 'd')}</b></span>
        <span>QC days: <b>{fmt(s.qc_days, 'd')}</b></span>
        <span>Hold: <b>{fmt(s.hold_days, 'd')}</b></span>
        <span>QC cycles: <b>{s.cycles}</b>{s.first_pass ? ' (first-pass ✓)' : ''}</span>
        <span>In current stage: <b>{fmt(s.current_stage_age, 'd')}</b></span>
      </div>

      {Object.keys(phaseDays).length > 0 && (
        <div className="tspd-phases">
          {['Dev', 'Code Review', 'QC', 'BIS', 'Approved'].filter(p => phaseDays[p] != null).map(p => (
            <div key={p} className="tspd-phase-row">
              <span className="tspd-phase-label">{p}</span>
              <div className="tspd-phase-track"><div className="tspd-phase-fill" style={{ width: `${(phaseDays[p] / phaseMax) * 100}%`, background: PHASE_COLORS[p] }} /></div>
              <span className="tspd-phase-val">{phaseDays[p]}d</span>
            </div>
          ))}
        </div>
      )}

      <h5 style={{ margin: '12px 0 6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status journey ({legs.length} steps)</h5>
      <div className="tspd-timeline">
        {legs.map((leg, i) => (
          <div key={i} className={`tspd-leg ${leg.is_current ? 'tspd-leg-current' : ''}`}>
            <span className="tspd-leg-dot" style={{ background: PHASE_COLORS[leg.phase] || '#94a3b8' }} />
            <span className="tspd-leg-status">{leg.status}</span>
            <span className="tspd-leg-days" style={{ color: dayColor(leg.days) }}>{leg.days}d{leg.hours != null && leg.days < 1 ? ` (${leg.hours}h)` : ''}</span>
            <span className="tspd-leg-dates">
              {(leg.entered_on || '').slice(0, 10)}{leg.exited_on ? ` → ${leg.exited_on.slice(0, 10)}` : ' → now'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeedRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <React.Fragment>
      <tr className="qcq-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center' }}><a href={`${PM_TICKET_URL}${row.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link" onClick={e => e.stopPropagation()}>#{row.ticket_id}</a></td>
        <td style={{ maxWidth: '240px', whiteSpace: 'normal', textAlign: 'left' }}>{row.title} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{open ? '▲' : '▼'}</span></td>
        <td style={{ textAlign: 'center' }}>{row.module}</td>
        <td style={{ textAlign: 'center' }}>{row.qc_tester}</td>
        <td style={{ textAlign: 'center' }}>{row.current_status}</td>
        <td style={{ textAlign: 'center', fontWeight: 700, color: dayColor((row.lead_time_days || 0) / 5) }}>{fmt(row.lead_time_days)}</td>
        <td style={{ textAlign: 'center' }}>{fmt(row.qc_days)}</td>
        <td style={{ textAlign: 'center', color: row.cycles > 1 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>{row.cycles || '–'}</td>
        <td style={{ textAlign: 'center' }}>{row.first_pass ? '✓' : (row.cycles > 0 ? '✗' : '–')}</td>
        <td style={{ textAlign: 'center', color: dayColor(row.current_stage_age || 0) }}>{fmt(row.current_stage_age)}</td>
      </tr>
      {open && (
        <tr className="qcq-expand-row"><td colSpan={10} style={{ padding: '8px 14px' }}><TicketJourney ticketId={row.ticket_id} /></td></tr>
      )}
    </React.Fragment>
  );
}

// Pictorial status flow for a single ticket (the "Ticket Flow" tab)
const DELAY_DAYS = 5;
function TicketFlow({ ticketId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true; setLoading(true); setErr(null); setData(null);
    fetch(`${API_BASE}/tickets/${ticketId}/movement`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Ticket not found' : `Error ${r.status}`)))
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(e => { if (alive) { setErr(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [ticketId]);

  if (loading) return <div className="loading-container"><div className="loading-spinner"></div><p>Loading flow…</p></div>;
  if (err) return <div className="error-container"><p>{err}</p></div>;
  if (!data) return null;
  const s = data.summary || {};
  const legs = data.journey || [];
  const phaseDays = data.phase_days || {};
  const phaseMax = Math.max(1, ...Object.values(phaseDays));
  const totalDays = Math.max(1, legs.reduce((a, l) => a + (l.days || 0), 0));
  const slowest = legs.reduce((m, l) => Math.max(m, l.days || 0), 0);

  return (
    <div className="tspd-flow">
      <div className="tspd-flow-head">
        <a href={`${PM_TICKET_URL}${ticketId}`} target="_blank" rel="noreferrer" className="qcq-ticket-link tspd-flow-id">#{ticketId}</a>
        <span className="tspd-flow-title">{s.title || ''}</span>
        {s.current_status && <span className="qcq-status-badge tspd-flow-cur">{s.current_status}</span>}
      </div>

      <div className="tspd-metrics" style={{ marginTop: '8px' }}>
        <span>Lead time: <b>{fmt(s.lead_time_days, 'd')}</b></span>
        <span>Dev→QC: <b>{fmt(s.dev_to_qc_days, 'd')}</b></span>
        <span>QC→BIS: <b>{fmt(s.qc_to_bis_days, 'd')}</b></span>
        <span>QC days: <b>{fmt(s.qc_days, 'd')}</b></span>
        <span>Hold: <b>{fmt(s.hold_days, 'd')}</b></span>
        <span>QC cycles: <b>{s.cycles}</b>{s.first_pass ? ' (first-pass ✓)' : ''}</span>
        <span>In current stage: <b>{fmt(s.current_stage_age, 'd')}</b></span>
      </div>

      {!s.history_complete && legs.length > 0 && (
        <div className="tspd-flow-notice">
          ⚠ Earlier history for this ticket isn't recorded — status-transition tracking began {(s.tracking_start || '').slice(0, 10)}.
          Only stages from then on are shown; the Dev/QC steps that happened before aren't captured.
          Tickets moving through the pipeline from now on show the complete flow.
        </div>
      )}

      {legs.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginTop: '12px' }}>
          No transition history recorded for this ticket yet (movement tracking began ~May 2026).
        </p>
      ) : (
        <>
          <h4 className="tspd-chart-title" style={{ marginTop: '16px' }}>
            Status flow <span className="tspd-chart-sub">each step = days spent · red = delay (≥{DELAY_DAYS}d) · ◆ = slowest stage</span>
          </h4>
          <div className="tspd-flow-nodes">
            {legs.map((leg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="tspd-flow-arrow">→</span>}
                <div className={`tspd-flow-node ${!leg.before_tracking && leg.days >= DELAY_DAYS ? 'tspd-flow-delay' : ''} ${leg.before_tracking ? 'tspd-flow-untracked' : ''} ${leg.is_current ? 'tspd-flow-current' : ''}`}
                  style={{ borderColor: PHASE_COLORS[leg.phase] || '#94a3b8' }}
                  title={leg.before_tracking
                    ? `${leg.status} — entered before tracking began (duration unknown)\n… → ${leg.exited_on ? leg.exited_on.slice(0, 10) : 'now'}`
                    : `${leg.status} — ${leg.days}d${leg.hours != null && leg.days < 1 ? ` (${leg.hours}h)` : ''}\n${(leg.entered_on || '').slice(0, 10)} → ${leg.exited_on ? leg.exited_on.slice(0, 10) : 'now'}`}>
                  <span className="tspd-flow-dot" style={{ background: PHASE_COLORS[leg.phase] || '#94a3b8' }} />
                  <span className="tspd-flow-status">{leg.status}</span>
                  {leg.before_tracking ? (
                    <span className="tspd-flow-days" style={{ color: 'var(--text-muted)' }}>⏳ pre-tracking</span>
                  ) : (
                    <span className="tspd-flow-days" style={{ color: dayColor(leg.days) }}>
                      {leg.days}d{leg.hours != null && leg.days < 1 ? ` (${leg.hours}h)` : ''}
                      {leg.days >= DELAY_DAYS ? ' ⚠' : ''}{leg.days === slowest && slowest > 0 ? ' ◆' : ''}
                    </span>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>

          <h4 className="tspd-chart-title" style={{ marginTop: '18px' }}>
            Time distribution <span className="tspd-chart-sub">segment width ∝ days in that status</span>
          </h4>
          <div className="tspd-flow-gantt">
            {legs.filter(l => !l.before_tracking && l.days != null).map((leg, i) => (
              <div key={i} className="tspd-flow-seg"
                title={`${leg.status}: ${leg.days}d (${(leg.entered_on || '').slice(0, 10)} → ${leg.exited_on ? leg.exited_on.slice(0, 10) : 'now'})`}
                style={{ width: `${Math.max(1.5, (leg.days / totalDays) * 100)}%`, background: PHASE_COLORS[leg.phase] || '#94a3b8' }}>
                {(leg.days / totalDays) > 0.07 && <span className="tspd-flow-seg-lbl">{leg.days}d</span>}
              </div>
            ))}
          </div>

          {Object.keys(phaseDays).length > 0 && (
            <>
              <h4 className="tspd-chart-title" style={{ marginTop: '18px' }}>Days per phase</h4>
              <div className="tspd-phases">
                {['Dev', 'Code Review', 'QC', 'BIS', 'Approved'].filter(p => phaseDays[p] != null).map(p => (
                  <div key={p} className="tspd-phase-row">
                    <span className="tspd-phase-label">{p}</span>
                    <div className="tspd-phase-track"><div className="tspd-phase-fill" style={{ width: `${(phaseDays[p] / phaseMax) * 100}%`, background: PHASE_COLORS[p] }} /></div>
                    <span className="tspd-phase-val">{phaseDays[p]}d</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h4 className="tspd-chart-title" style={{ marginTop: '18px' }}>Detailed journey ({legs.length} steps)</h4>
          <div className="tspd-timeline">
            {legs.map((leg, i) => (
              <div key={i} className={`tspd-leg ${leg.is_current ? 'tspd-leg-current' : ''}`}>
                <span className="tspd-leg-dot" style={{ background: PHASE_COLORS[leg.phase] || '#94a3b8' }} />
                <span className="tspd-leg-status">{leg.status}</span>
                {leg.before_tracking ? (
                  <span className="tspd-leg-days" style={{ color: 'var(--text-muted)' }}>pre-tracking</span>
                ) : (
                  <span className="tspd-leg-days" style={{ color: dayColor(leg.days) }}>{leg.days}d{leg.hours != null && leg.days < 1 ? ` (${leg.hours}h)` : ''}</span>
                )}
                <span className="tspd-leg-dates">
                  {leg.before_tracking ? '… (before tracking)' : (leg.entered_on || '').slice(0, 10)}{leg.exited_on ? ` → ${leg.exited_on.slice(0, 10)}` : ' → now'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function TicketSpeed() {
  const [kind, setKind] = useState('month');
  const [offset, setOffset] = useState(1);   // default previous month (has data)
  const [scope, setScope] = useState('closed');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modFilter, setModFilter] = useState('');
  const [qcFilter, setQcFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('lead_time_days');
  const [sortDir, setSortDir] = useState('desc');
  const [view, setView] = useState('overview');   // 'overview' | 'flow'
  const [flowInput, setFlowInput] = useState('');
  const [flowId, setFlowId] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = kind === 'all' ? `period=all&scope=${scope}` : `period=${kind}&offset=${offset}&scope=${scope}`;
      const res = await fetch(`${API_BASE}/ticket-speed?${q}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [kind, offset, scope]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const rowsAll = data?.rows || [];
  const modules = [...new Set(rowsAll.map(r => r.module))].sort();
  const testers = [...new Set(rowsAll.map(r => r.qc_tester))].sort();
  let rows = rowsAll.filter(r =>
    (!modFilter || r.module === modFilter) && (!qcFilter || r.qc_tester === qcFilter) &&
    (!search || String(r.ticket_id).includes(search) || (r.title || '').toLowerCase().includes(search.toLowerCase()))
  );
  rows = [...rows].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    else { av = av == null ? -1 : av; bv = bv == null ? -1 : bv; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const toggleSort = (k) => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc'); } };
  const Th = ({ k, children, left }) => <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', textAlign: left ? 'left' : 'center' }}>{children}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>;

  // ---------- Analytics (computed from the currently filtered rows) ----------
  const LEAD_BUCKETS = [['0–3d', 0, 3], ['4–7d', 4, 7], ['8–14d', 8, 14], ['15–30d', 15, 30], ['30d+', 31, 1e9]];
  const leadDist = LEAD_BUCKETS.map(([, lo, hi]) => rows.filter(r => r.lead_time_days != null && r.lead_time_days >= lo && r.lead_time_days <= hi).length);
  const phaseAvg = {
    'Dev → QC': avgOf(rows.map(r => r.dev_to_qc_days)),
    'In QC': avgOf(rows.map(r => r.qc_days)),
    'QC → BIS': avgOf(rows.map(r => r.qc_to_bis_days)),
    'On Hold': avgOf(rows.map(r => r.hold_days)),
  };
  const groupAgg = (key) => {
    const g = {};
    rows.forEach(r => { (g[r[key]] = g[r[key]] || []).push(r); });
    return Object.entries(g).map(([k, rs]) => {
      const cyc = rs.filter(r => r.cycles > 0);
      return {
        name: k, n: rs.length,
        lead: avgOf(rs.map(r => r.lead_time_days)), qc: avgOf(rs.map(r => r.qc_days)),
        cycles: avgOf(cyc.map(r => r.cycles)),
        fp: cyc.length ? Math.round(100 * cyc.filter(r => r.first_pass).length / cyc.length) : null,
      };
    }).sort((a, b) => b.n - a.n);
  };
  const modAgg = groupAgg('module');
  const topMod = modAgg.slice(0, 8);
  const testerAgg = groupAgg('qc_tester').filter(t => t.name && t.name !== 'Unassigned').slice(0, 8);
  const heatMods = modAgg.slice(0, 10);
  const maxLead = Math.max(1, ...heatMods.map(m => m.lead));
  const maxQc = Math.max(1, ...heatMods.map(m => m.qc));
  const maxCyc = Math.max(1, ...heatMods.map(m => m.cycles));

  const leadDistData = {
    labels: LEAD_BUCKETS.map(b => b[0]),
    datasets: [{ label: 'Tickets', data: leadDist, backgroundColor: ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444'], borderRadius: 6 }],
  };
  const phaseData = {
    labels: Object.keys(phaseAvg),
    datasets: [{ data: Object.values(phaseAvg), backgroundColor: ['#3b82f6', '#f59e0b', '#06b6d4', '#a855f7'], borderColor: 'rgba(15,23,42,0.6)', borderWidth: 2 }],
  };
  const modData = {
    labels: topMod.map(m => m.name),
    datasets: [
      { label: 'Avg Lead (d)', data: topMod.map(m => m.lead), backgroundColor: '#3b82f6', borderRadius: 4 },
      { label: 'Avg QC (d)', data: topMod.map(m => m.qc), backgroundColor: '#f59e0b', borderRadius: 4 },
    ],
  };
  const testerData = {
    labels: testerAgg.map(t => t.name),
    datasets: [
      { label: 'Avg QC days', data: testerAgg.map(t => t.qc), backgroundColor: '#06b6d4', borderRadius: 4, yAxisID: 'y' },
      { label: 'First-pass %', data: testerAgg.map(t => t.fp || 0), backgroundColor: '#22c55e', borderRadius: 4, yAxisID: 'y1' },
    ],
  };
  // Average days per stage (accurate, from live transition tracking), Dev vs QA separately
  const stageDur = data?.stage_durations || { dev: [], qa: [] };
  const stageBar = (list, color) => ({
    labels: list.map(x => x.status),
    datasets: [{ label: 'Avg days in stage', data: list.map(x => x.avg_days), backgroundColor: color, borderRadius: 4 }],
  });
  const devStageData = stageBar(stageDur.dev, '#6366f1');
  const qaStageData = stageBar(stageDur.qa, '#f59e0b');

  const exportExcel = () => {
    const headers = ['Ticket', 'Title', 'Module', 'QC Tester', 'Developer', 'Priority', 'Current Status', 'Lead Time (d)', 'QC Days', 'Hold Days', 'Cycles', 'First Pass', 'Stage Age (d)', 'Created', 'Closed'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push([r.ticket_id, r.title, r.module, r.qc_tester, r.developer, r.priority, r.current_status, r.lead_time_days, r.qc_days, r.hold_days, r.cycles, r.first_pass ? 'Yes' : '', r.current_stage_age, (r.created_on || '').slice(0, 10), (r.closed_on || '').slice(0, 10)].map(esc).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `ticket-speed_${data?.summary?.period?.label?.replace(/\s+/g, '-') || scope}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const s = data?.summary || {};
  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Ticket Speed &amp; Movement</h1>
            <p className="header-subtitle">How fast each ticket flows through the pipeline{s.period?.label ? ` — ${s.period.label}` : ''}</p>
          </div>
          {view === 'overview' && (
            <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="qcq-platform-toggle">
                {PERIOD_KINDS.map(k => <button key={k.value} className={`btn btn-sm ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setKind(k.value); setOffset(k.value === 'month' ? 1 : 0); }}>{k.label}</button>)}
              </div>
              {kind !== 'all' && (
                <select className="qcq-search-input" style={{ minWidth: '140px' }} value={offset} onChange={e => setOffset(Number(e.target.value))}>
                  {(kind === 'quarter' ? quarterOptions() : monthOptions()).map(o => <option key={o.offset} value={o.offset}>{o.label}</option>)}
                </select>
              )}
              <div className="qcq-platform-toggle">
                {SCOPES.map(sc => <button key={sc.value} className={`btn btn-sm ${scope === sc.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope(sc.value)}>{sc.label}</button>)}
              </div>
            </div>
          )}
        </header>

        <div className="qcq-tabs" style={{ marginBottom: '12px' }}>
          <button className={`qcq-tab ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview &amp; Stage Analytics</button>
          <button className={`qcq-tab ${view === 'flow' ? 'active' : ''}`} onClick={() => setView('flow')}>Ticket Flow (by ID)</button>
        </div>

        {view === 'flow' ? (
          <div className="qcq-section">
            <form onSubmit={e => { e.preventDefault(); const v = flowInput.trim(); setFlowId(v ? v.replace(/[^0-9]/g, '') : null); }}
              style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
              <input className="qcq-search-input" style={{ minWidth: '220px' }} placeholder="Enter ticket ID (e.g. 20468)…"
                value={flowInput} onChange={e => setFlowInput(e.target.value)} />
              <button type="submit" className="btn btn-sm btn-primary" disabled={!flowInput.trim()}>Show flow</button>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Visualises the status journey, delays and time per stage for one ticket.</span>
            </form>
            {flowId ? <TicketFlow ticketId={flowId} /> : <p style={{ color: 'var(--text-muted)' }}>Search a ticket ID to see its pictorial status flow.</p>}
          </div>
        ) : loading ? (
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading ticket speed…</p></div>
        ) : error ? (
          <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn btn-primary">Retry</button></div>
        ) : (
          <>
            <div className="qcq-status-cards">
              <div className="qcq-card qcq-card-total"><div className="qcq-card-value">{s.tickets || 0}</div><div className="qcq-card-label">Tickets</div></div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}><div className="qcq-card-value">{s.avg_lead_time_days}d</div><div className="qcq-card-label">Avg Lead Time</div><div className="qcq-card-sub">median {s.median_lead_time_days}d</div></div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-amber)' }}><div className="qcq-card-value">{s.avg_qc_days}d</div><div className="qcq-card-label">Avg QC Days</div></div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}><div className="qcq-card-value">{s.first_pass_rate}%</div><div className="qcq-card-label">First-pass Rate</div></div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-red)' }}><div className="qcq-card-value">{s.avg_cycles}</div><div className="qcq-card-label">Avg QC Cycles</div></div>
            </div>
            {s.truncated && <p style={{ color: 'var(--accent-amber)', fontSize: '0.72rem' }}>Showing first 2000 tickets — narrow the scope/period for the full set.</p>}

            {rows.length > 0 && (
              <>
                <div className="tspd-analytics">
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">Lead-time distribution</h4>
                    <div className="tspd-chart-body"><Bar data={leadDistData} options={chartOpts()} /></div>
                  </div>
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">Where time goes <span className="tspd-chart-sub">avg days / phase</span></h4>
                    <div className="tspd-chart-body"><Doughnut data={phaseData} options={{ responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: AXIS, font: { size: 11 }, padding: 10, boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed}d` } } } }} /></div>
                  </div>
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">Top modules <span className="tspd-chart-sub">lead vs QC days</span></h4>
                    <div className="tspd-chart-body"><Bar data={modData} options={chartOpts({ indexAxis: 'y', plugins: { legend: { display: true, position: 'top', labels: { color: AXIS, font: { size: 10 }, boxWidth: 12 } }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)' } } })} /></div>
                  </div>
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">QC testers <span className="tspd-chart-sub">speed &amp; first-pass quality</span></h4>
                    <div className="tspd-chart-body"><Bar data={testerData} options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: true, position: 'top', labels: { color: AXIS, font: { size: 10 }, boxWidth: 12 } }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)' } },
                      scales: {
                        x: { ticks: { color: AXIS, font: { size: 9 } }, grid: { color: GRID } },
                        y: { position: 'left', beginAtZero: true, ticks: { color: AXIS, font: { size: 9 } }, grid: { color: GRID }, title: { display: true, text: 'QC days', color: AXIS, font: { size: 9 } } },
                        y1: { position: 'right', beginAtZero: true, max: 100, ticks: { color: AXIS, font: { size: 9 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'First-pass %', color: AXIS, font: { size: 9 } } },
                      },
                    }} /></div>
                  </div>
                </div>

                {heatMods.length > 0 && (
                  <div className="tspd-heatmap-wrap">
                    <h4 className="tspd-chart-title">Module performance map <span className="tspd-chart-sub">green = fast / good · red = slow / many cycles</span></h4>
                    <div className="tspd-heatmap">
                      <div className="tspd-hm-head tspd-hm-left">Module</div>
                      <div className="tspd-hm-head">Tickets</div>
                      <div className="tspd-hm-head">Avg Lead</div>
                      <div className="tspd-hm-head">Avg QC</div>
                      <div className="tspd-hm-head">Avg Cycles</div>
                      <div className="tspd-hm-head">First-pass</div>
                      {heatMods.map(m => (
                        <React.Fragment key={m.name}>
                          <div className="tspd-hm-label" title={m.name}>{m.name}</div>
                          <div className="tspd-hm-cell">{m.n}</div>
                          <div className="tspd-hm-cell" style={{ background: heatBg(m.lead, maxLead) }}>{m.lead}d</div>
                          <div className="tspd-hm-cell" style={{ background: heatBg(m.qc, maxQc) }}>{m.qc}d</div>
                          <div className="tspd-hm-cell" style={{ background: heatBg(m.cycles, maxCyc) }}>{m.cycles || '–'}</div>
                          <div className="tspd-hm-cell" style={{ background: m.fp == null ? 'transparent' : heatBg(m.fp, 100, true) }}>{m.fp == null ? '–' : m.fp + '%'}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {(stageDur.dev.length > 0 || stageDur.qa.length > 0) && (
              <>
                <h3 style={{ fontSize: '0.95rem', margin: '14px 0 4px', color: 'var(--text-primary)' }}>
                  Average time per stage <span className="tspd-chart-sub">how long tickets sit in each Dev / QA status — accurate, from live transition tracking</span>
                </h3>
                <div className="tspd-analytics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">🛠 Dev stages</h4>
                    <div className="tspd-chart-body" style={{ height: `${Math.max(170, stageDur.dev.length * 36)}px` }}>
                      <Bar data={devStageData} options={chartOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x}d avg` } } } })} />
                    </div>
                  </div>
                  <div className="tspd-chart-card">
                    <h4 className="tspd-chart-title">🔍 QA stages</h4>
                    <div className="tspd-chart-body" style={{ height: `${Math.max(170, stageDur.qa.length * 36)}px` }}>
                      <Bar data={qaStageData} options={chartOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x}d avg` } } } })} />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '8px', margin: '12px 0 10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="qcq-search-input" placeholder="Search ticket / title…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: '180px' }} />
              <select className="qcq-search-input" value={modFilter} onChange={e => setModFilter(e.target.value)}><option value="">All modules</option>{modules.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <select className="qcq-search-input" value={qcFilter} onChange={e => setQcFilter(e.target.value)}><option value="">All QC testers</option>{testers.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{rows.length} of {rowsAll.length}</span>
              <button className="btn btn-sm btn-primary" onClick={exportExcel} disabled={rows.length === 0} style={{ marginLeft: 'auto' }}>Export to Excel</button>
            </div>

            <div className="qcq-table-container">
              <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                <thead><tr>
                  <Th k="ticket_id">Ticket</Th>
                  <th style={{ textAlign: 'left' }}>Title</th>
                  <Th k="module">Module</Th>
                  <Th k="qc_tester">QC Tester</Th>
                  <Th k="current_status">Status</Th>
                  <Th k="lead_time_days">Lead Time</Th>
                  <Th k="qc_days">QC Days</Th>
                  <Th k="cycles">Cycles</Th>
                  <Th k="first_pass">First-pass</Th>
                  <Th k="current_stage_age">Stage Age</Th>
                </tr></thead>
                <tbody>{rows.map(r => <SpeedRow key={r.ticket_id} row={r} />)}</tbody>
              </table>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
              Lead time uses real create→close dates (accurate now). Per-stage durations, QC days &amp; cycles come
              from status-transition history, which began ~May 2026 — so they're partial for older tickets and
              complete going forward. Click any ticket to see its full status journey.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
