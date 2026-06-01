import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

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
        </header>

        {loading ? (
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
