import React, { useState, useEffect, useCallback } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend);

const AXIS = 'rgba(148,163,184,0.85)';
const GRID = 'rgba(148,163,184,0.12)';
const TEAL = '#14b8a6';
const AMBER = '#f59e0b';
const BLUE = '#3b82f6';
const PURPLE = '#a78bfa';

const baseOpts = (extra = {}) => ({
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false, labels: { color: AXIS, font: { size: 11 } } },
    tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: GRID, borderWidth: 1, padding: 8 },
  },
  scales: {
    x: { ticks: { color: AXIS, font: { size: 9 } }, grid: { color: GRID }, stacked: extra.stacked },
    y: { ticks: { color: AXIS, font: { size: 10 } }, grid: { color: GRID }, beginAtZero: true, stacked: extra.stacked },
  },
});

const fmtH = (h) => (h >= 1000 ? `${(h / 1000).toFixed(1)}k` : `${h}`);

const hbarOpts = () => ({
  indexAxis: 'y', responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: GRID, borderWidth: 1, padding: 8 },
  },
  scales: {
    x: { beginAtZero: true, ticks: { color: AXIS, font: { size: 10 } }, grid: { color: GRID } },
    y: { ticks: { color: AXIS, font: { size: 11 } }, grid: { display: false } },
  },
});

export default function AutomationDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [syncing, setSyncing] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [banner, setBanner] = useState('');
  const [planPerson, setPlanPerson] = useState('all');
  const [selectedWeek, setSelectedWeek] = useState(null); // ISO Monday; null = current week

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/automation/overview${selectedWeek ? `?week=${selectedWeek}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setMinutes(String(d.config?.manual_minutes_per_case ?? ''));
    } catch (e) {
      setError('Could not load automation data. Run a sync first.');
    } finally {
      setLoading(false);
    }
  }, [selectedWeek]);

  useEffect(() => { load(); }, [load]);

  // Shift the selected week by N weeks (relative to the server's selected_week), or reset to current.
  const shiftWeek = (n) => {
    const base = data?.selected_week ? new Date(data.selected_week + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + n * 7);
    setSelectedWeek(base.toISOString().slice(0, 10));
  };

  const triggerSync = async (full = false) => {
    setSyncing(true);
    setBanner(`Sync started — pulling latest from TestRail${full ? ' (full, incl. executions)' : ''} (~6–7 min). It will refresh automatically when done.`);
    const before = data?.last_sync?.at || '';
    try { await fetch(`${API_BASE}/automation/trigger-sync?include_executions=${full}`, { method: 'POST' }); } catch { /* */ }
    let tries = 0;
    const poll = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch(`${API_BASE}/automation/overview`);
        if (res.ok) {
          const d = await res.json();
          if ((d.last_sync?.at || '') !== before) {
            setData(d); setMinutes(String(d.config?.manual_minutes_per_case ?? ''));
            setBanner(`Sync complete — ${d.last_sync?.message || 'updated'}.`);
            setSyncing(false); clearInterval(poll); return;
          }
        }
      } catch { /* */ }
      if (tries > 45) { setSyncing(false); clearInterval(poll); setBanner('Sync is taking longer than usual — use Sync now again or refresh shortly.'); }
    }, 20000);
  };

  const saveMinutes = async () => {
    const m = parseInt(minutes, 10);
    if (!m || m < 1) return;
    await fetch(`${API_BASE}/automation/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_minutes_per_case: m }),
    });
    load();
  };

  const downloadCard = async () => {
    const res = await fetch(`${API_BASE}/automation/weekly-card`);
    if (!res.ok) { setBanner('Card generation failed.'); return; }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || 'Automation_Weekly_Card.xlsx').replace(/"/g, '');
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
    setBanner('Weekly card downloaded (also saved to your Desktop).');
  };

  if (loading) return (
    <div className="dashboard"><AppSidebar /><main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
      <div className="loading-container"><div className="loading-spinner" /><p>Loading automation…</p></div></main></div>
  );

  const ov = data?.overview || {};
  const modules = (data?.modules || []).filter(m => m.module !== 'Unmapped');
  const team = data?.team?.members || [];
  const planning = data?.planning || {};
  const growth = data?.growth || [];
  const overrideBadge = data?.override?.active ? (
    <div className="auto-banner">📋 Some figures use uploaded Excel data (imported {data.override.imported_at}) — overriding TestRail where its attribution is being corrected.</div>
  ) : null;

  const KPI = ({ label, value, accent }) => (
    <div className="auto-kpi" style={{ borderTopColor: accent }}>
      <div className="auto-kpi-val">{value}</div>
      <div className="auto-kpi-lbl">{label}</div>
    </div>
  );

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Automation</h1>
            <p className="header-subtitle">
              Coverage, utilisation & time saved across modules — TestRail Project 18
              {data?.last_sync?.at && <span className="auto-muted"> · last sync {new Date(data.last_sync.at).toLocaleString()}</span>}
            </p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Week selector — drives Team / Planning / Scripting tabs */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--border-color)', borderRadius: 6, padding: '2px 4px' }} title="Week shown in Team / Planning / Scripting tabs">
              <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px' }} onClick={() => shiftWeek(-1)} disabled={loading}>‹</button>
              <span style={{ fontSize: '0.78rem', minWidth: 96, textAlign: 'center' }}>
                {data?.selected_week ? `Week of ${data.selected_week.slice(5)}` : 'This week'}
              </span>
              <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px' }} onClick={() => shiftWeek(1)} disabled={loading}>›</button>
              {selectedWeek && <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setSelectedWeek(null)}>This week</button>}
            </div>
            <span className="auto-muted">Manual min/case</span>
            <input className="qcq-search-input" style={{ width: 70 }} value={minutes}
              onChange={e => setMinutes(e.target.value.replace(/\D/g, ''))} onBlur={saveMinutes} />
            <button className="btn btn-sm btn-secondary" onClick={triggerSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </header>

        {banner && <div className="auto-banner">{banner}</div>}
        {error && !data && <div className="error-container"><p>{error}</p><button className="btn btn-primary" onClick={load}>Retry</button></div>}

        <div className="qcq-tabs">
          {['overview', 'scripting', 'modules', 'planning', 'team'].map(t => (
            <button key={t} className={`qcq-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'overview' ? 'Overview' : t === 'scripting' ? 'Scripting / Plan' : t === 'modules' ? 'Modules' : t === 'planning' ? 'Planning & Backlog' : 'Team'}
            </button>
          ))}
        </div>

        {tab === 'scripting' && (() => {
          const s = data?.scripting || {};
          const tw = s.this_week || {}; const byp = tw.by_person || [];
          const daily = s.daily || []; const nw = s.next_week || {}; const bl = s.backlog || {};
          const team = ['Vishnu VS', 'Varsha Dcruz P', 'Vivek V Nair'];
          return (
            <>
              <div className="auto-kpis">
                <KPI label="Scripted this week" value={tw.scripted_total ?? 0} accent={TEAL} />
                <KPI label="Planned this week" value={tw.planned_known ? tw.planned_total : '—'} accent={BLUE} />
                <KPI label="Planned next week" value={nw.total ?? 0} accent={PURPLE} />
                <KPI label="Backlog (Not Automated)" value={bl.total ?? 0} accent={AMBER} />
              </div>
              {s.plan_progress && (
                <div className="qcq-card" style={{ marginTop: 12 }}>
                  <h3>Plan progress — {s.plan_progress.total_scripted} / {s.plan_progress.total_planned} of the Excel plan scripted</h3>
                  <table className="qcq-table">
                    <thead><tr><th>Person</th><th style={{ textAlign: 'center' }}>Planned</th><th style={{ textAlign: 'center' }}>Scripted</th><th style={{ textAlign: 'center' }}>%</th></tr></thead>
                    <tbody>{s.plan_progress.by_person.map(p => (
                      <tr key={p.person}><td>{p.person}</td><td style={{ textAlign: 'center' }}>{p.planned}</td>
                        <td style={{ textAlign: 'center', color: TEAL, fontWeight: 700 }}>{p.scripted}</td>
                        <td style={{ textAlign: 'center' }}>{p.planned ? Math.round(100 * p.scripted / p.planned) : 0}%</td></tr>))}</tbody>
                  </table>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 6 }}>From the planned-cases Excel; updates daily as cases flip to Automated in TestRail (sync runs 4×/day).</p>
                </div>
              )}
              <div className="auto-grid2">
                <div className="qcq-card">
                  <h3>This week — per person</h3>
                  <table className="qcq-table">
                    <thead><tr><th>Person</th><th style={{ textAlign: 'center' }}>Planned</th><th style={{ textAlign: 'center' }}>Scripted</th></tr></thead>
                    <tbody>{byp.map(p => (
                      <tr key={p.person}><td>{p.person}</td><td style={{ textAlign: 'center' }}>{p.planned ?? '—'}</td>
                        <td style={{ textAlign: 'center', color: TEAL, fontWeight: 700 }}>{p.scripted}</td></tr>))}</tbody>
                  </table>
                  {!tw.planned_known && <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 6 }}>Planned-this-week starts tracking once a week's plan is snapshotted (next-week tags are captured automatically).</p>}
                </div>
                <div className="qcq-card">
                  <h3>Daily scripted (last 14 days)</h3>
                  <div style={{ maxHeight: 280, overflow: 'auto' }}>
                    <table className="qcq-table">
                      <thead><tr><th>Date</th>{team.map(t => <th key={t} style={{ textAlign: 'center' }}>{t.split(' ')[0]}</th>)}<th style={{ textAlign: 'center' }}>Total</th></tr></thead>
                      <tbody>{[...daily].reverse().map(d => (
                        <tr key={d.date}><td>{d.date}</td>{team.map(t => <td key={t} style={{ textAlign: 'center' }}>{d[t] || '-'}</td>)}
                          <td style={{ textAlign: 'center', fontWeight: 700 }}>{d.total || '-'}</td></tr>))}</tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="qcq-card" style={{ marginTop: 12 }}>
                <h3>Planned for next week — by module ({nw.total || 0}) · {s.next_week_start} → {s.next_week_end}</h3>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 6 }}>
                  {(nw.by_person || []).filter(p => p.person !== 'Unassigned').map(p => `${p.person}: ${p.count}`).join('  ·  ') || 'No one assigned yet'}
                  {'  '}— Planned status + automated_by name (no date needed)
                </div>
                {(nw.by_module || []).length === 0
                  ? <p style={{ color: '#94a3b8' }}>No cases assigned for next week yet. Tag them in TestRail as <b>Planned</b> with the <b>automated_by</b> name; they flip to Automated as they're scripted.</p>
                  : <table className="qcq-table">
                    <thead><tr><th>Module</th><th style={{ textAlign: 'center' }}>Count</th><th>Cases</th></tr></thead>
                    <tbody>{(nw.by_module || []).map(m => (
                      <tr key={m.module}><td>{m.module}</td><td style={{ textAlign: 'center', fontWeight: 700 }}>{m.count}</td>
                        <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{(m.cases || []).slice(0, 10).map(c => `C${c.case_id}`).join(', ')}{(m.cases || []).length > 10 ? ` +${m.cases.length - 10}` : ''}</td></tr>))}</tbody>
                  </table>}
              </div>
              <div className="qcq-card" style={{ marginTop: 12 }}>
                <h3>Backlog (Not Automated) — by module ({bl.total || 0})</h3>
                <table className="qcq-table">
                  <thead><tr><th>Module</th><th style={{ textAlign: 'center' }}>Count</th></tr></thead>
                  <tbody>{(bl.by_module || []).map(m => (
                    <tr key={m.module}><td>{m.module}</td><td style={{ textAlign: 'center', fontWeight: 700 }}>{m.count}</td></tr>))}</tbody>
                </table>
              </div>
            </>
          );
        })()}

        {tab === 'overview' && (() => {
          const covMods = [...modules].sort((a, b) => b.coverage_pct - a.coverage_pct).slice(0, 12);
          return (
            <>
              <div className="auto-kpis">
                <KPI label="Coverage" value={`${ov.coverage_pct}%`} accent={TEAL} />
                <KPI label="Automated cases" value={ov.automated_cases?.toLocaleString()} accent={TEAL} />
                <KPI label="Total cases" value={ov.total_cases?.toLocaleString()} accent={BLUE} />
                <KPI label="Automated executions" value={ov.automated_executions?.toLocaleString()} accent={PURPLE} />
                <KPI label="Utilisation" value={`${ov.utilization_pct}%`} accent={PURPLE} />
                <KPI label="Time saved" value={`${fmtH(ov.time_saved_hours || 0)} h`} accent={AMBER} />
              </div>

              <div className="auto-grid2">
                <div className="qcq-card">
                  <h3>Automation supporting manual testing</h3>
                  <div style={{ position: 'relative', height: 250 }}>
                    <Doughnut
                      data={{
                        labels: ['Automated', 'Manual'],
                        datasets: [{ data: [ov.automated_executions || 0, ov.manual_executions || 0], backgroundColor: [TEAL, 'rgba(245,158,11,0.9)'], borderWidth: 0, hoverOffset: 6 }],
                      }}
                      options={{ cutout: '72%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: GRID, borderWidth: 1, padding: 8 } } }}
                    />
                    <div className="auto-donut-center">
                      <div className="auto-donut-val">{ov.utilization_pct}%</div>
                      <div className="auto-donut-lbl">utilisation</div>
                    </div>
                  </div>
                  <div className="auto-util-legend">
                    <span><i style={{ background: TEAL }} /> Automated executions <b>{(ov.automated_executions || 0).toLocaleString()}</b></span>
                    <span><i style={{ background: AMBER }} /> Manual executions <b>{(ov.manual_executions || 0).toLocaleString()}</b></span>
                  </div>
                </div>

                <div className="qcq-card">
                  <h3>Daily growth</h3>
                  <div style={{ height: 250 }}>
                    {growth.length > 1 ? (
                      <Line
                        data={{
                          labels: growth.map(g => g.date.slice(5)),
                          datasets: [
                            { label: 'Automated cases', data: growth.map(g => g.automated_cases), borderColor: TEAL, backgroundColor: 'rgba(20,184,166,0.15)', fill: true, tension: 0.35, pointRadius: 3 },
                            { label: 'Automated executions', data: growth.map(g => g.automated_executions), borderColor: PURPLE, backgroundColor: 'rgba(167,139,250,0.12)', fill: true, tension: 0.35, pointRadius: 3 },
                          ],
                        }}
                        options={{ ...baseOpts(), plugins: { ...baseOpts().plugins, legend: { display: true, position: 'bottom', labels: { color: AXIS, usePointStyle: true, pointStyle: 'circle' } } } }}
                      />
                    ) : <p className="auto-muted">Growth chart appears once there are 2+ daily snapshots (starts today).</p>}
                  </div>
                </div>
              </div>

              <div className="qcq-card">
                <h3>Coverage % by module</h3>
                <div style={{ height: Math.max(220, covMods.length * 34) }}>
                  <Bar
                    data={{ labels: covMods.map(m => m.module), datasets: [{ data: covMods.map(m => m.coverage_pct), backgroundColor: TEAL, borderRadius: 6, maxBarThickness: 22 }] }}
                    options={hbarOpts()}
                  />
                </div>
              </div>
            </>
          );
        })()}

        {tab === 'modules' && (() => {
          const byAuto = [...modules].sort((a, b) => b.automated_cases - a.automated_cases);
          const byCov = [...modules].sort((a, b) => b.coverage_pct - a.coverage_pct).slice(0, 12);
          const byUtil = [...modules].filter(m => m.total_executions > 0).sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 12);
          const execMods = [...modules].sort((a, b) => b.total_executions - a.total_executions).slice(0, 12);
          return (
            <>
              <div className="auto-grid2">
                <div className="qcq-card">
                  <h3>Coverage % by module</h3>
                  <div style={{ height: Math.max(200, byCov.length * 32) }}>
                    <Bar data={{ labels: byCov.map(m => m.module), datasets: [{ data: byCov.map(m => m.coverage_pct), backgroundColor: '#14b8a6', borderRadius: 6, maxBarThickness: 20 }] }} options={hbarOpts()} />
                  </div>
                </div>
                <div className="qcq-card">
                  <h3>Utilisation % by module</h3>
                  <div style={{ height: Math.max(200, byUtil.length * 32) }}>
                    {byUtil.length ? <Bar data={{ labels: byUtil.map(m => m.module), datasets: [{ data: byUtil.map(m => m.utilization_pct), backgroundColor: '#a78bfa', borderRadius: 6, maxBarThickness: 20 }] }} options={hbarOpts()} />
                      : <p className="auto-muted">No execution data yet.</p>}
                  </div>
                </div>
              </div>

              <div className="qcq-card">
                <h3>Automated vs manual executions by module</h3>
                <div style={{ height: 300 }}>
                  <Bar
                    data={{
                      labels: execMods.map(m => m.module),
                      datasets: [
                        { label: 'Automated', data: execMods.map(m => m.automated_executions), backgroundColor: TEAL, borderRadius: 4 },
                        { label: 'Manual', data: execMods.map(m => m.total_executions - m.automated_executions), backgroundColor: AMBER, borderRadius: 4 },
                      ],
                    }}
                    options={{ ...baseOpts({ stacked: true }), plugins: { ...baseOpts().plugins, legend: { display: true, position: 'bottom', labels: { color: AXIS, usePointStyle: true, pointStyle: 'circle' } } } }}
                  />
                </div>
              </div>

              <div className="qcq-card" style={{ overflowX: 'auto' }}>
                <h3>Module breakdown</h3>
                <table className="auto-tbl">
                  <thead><tr>
                    <th>Module</th>
                    <th className="num">Total</th><th className="num">Automated</th>
                    <th>Coverage</th>
                    <th className="num">Executions</th><th className="num">Auto exec</th>
                    <th className="num">Utilisation</th><th className="num">Reuse</th><th className="num">Time saved</th>
                  </tr></thead>
                  <tbody>
                    {byAuto.map(m => (
                      <tr key={m.module}>
                        <td className="mod">{m.module}</td>
                        <td className="num">{m.total_cases}</td>
                        <td className="num">{m.automated_cases}</td>
                        <td><div className="cov"><div className="cov-bar"><div className="cov-fill" style={{ width: `${Math.min(100, m.coverage_pct)}%` }} /></div><span className="cov-pct">{m.coverage_pct}%</span></div></td>
                        <td className="num">{m.total_executions}</td>
                        <td className="num">{m.automated_executions}</td>
                        <td className="num">{m.utilization_pct}%</td>
                        <td className="num">{m.reuse_ratio}×</td>
                        <td className="num strong">{m.time_saved_hours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}

        {tab === 'planning' && (() => {
          const MEMBER_COLORS = { 'Vishnu VS': '#14b8a6', 'Varsha Dcruz P': '#f59e0b', 'Vivek V Nair': '#a78bfa' };
          const colorFor = (name, i) => MEMBER_COLORS[name] || [TEAL, AMBER, PURPLE][i % 3];
          const initials = (n) => (n || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
          const byPerson = (planning.by_person || []).filter(p => p.person !== 'Unassigned');
          const maxScripted = Math.max(1, ...byPerson.map(p => p.automated_this_week || 0));
          const byModule = planning.by_module || [];
          const modPalette = ['#14b8a6', '#3b82f6', '#a78bfa', '#f59e0b', '#06b6d4', '#ef4444', '#22c55e'];
          const hbarOpts = {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: GRID, borderWidth: 1, padding: 8 } },
            scales: { x: { beginAtZero: true, ticks: { color: AXIS, font: { size: 10 } }, grid: { color: GRID } }, y: { ticks: { color: AXIS, font: { size: 11 } }, grid: { display: false } } },
          };
          const backlog = (planning.backlog || []).filter(c => planPerson === 'all' || c.automated_by === planPerson);
          return (
            <>
              {overrideBadge}
              <div className="auto-kpis">
                <KPI label="Planned next week" value={planning.planned_total} accent={BLUE} />
                <KPI label="Scripted this week" value={planning.automated_this_week_total} accent={TEAL} />
                <KPI label="Members planning" value={byPerson.length} accent={PURPLE} />
                <KPI label="Modules in plan" value={byModule.length} accent={AMBER} />
              </div>

              <div className="tm-mem-grid">
                {byPerson.map((p, i) => {
                  const color = colorFor(p.person, i);
                  return (
                    <div key={p.person} className="tm-mem-card" style={{ '--c': color }}>
                      <div className="tm-mem-head">
                        <span className="tm-mem-avatar" style={{ background: color }}>{initials(p.person)}</span>
                        <div>
                          <div className="tm-mem-name">{p.person}</div>
                          <div className="tm-mem-sub">{p.automated_this_week == null ? '— scripted this week' : `${p.automated_this_week} scripted this week`}</div>
                        </div>
                      </div>
                      <div className="tm-mem-big">{p.planned}<span className="tm-mem-unit">planned next week</span></div>
                      <div className="tm-plan-bar"><div className="tm-plan-fill" style={{ width: `${((p.automated_this_week || 0) / maxScripted) * 100}%`, background: color }} /></div>
                      <div className="auto-muted" style={{ fontSize: 11, marginTop: 5 }}>this-week scripting velocity</div>
                    </div>
                  );
                })}
              </div>

              <div className="auto-grid2">
                <div className="qcq-card">
                  <h3>Planned by module</h3>
                  <div style={{ height: Math.max(180, byModule.length * 38) }}>
                    <Bar
                      data={{ labels: byModule.map(m => m.module), datasets: [{ data: byModule.map(m => m.planned), backgroundColor: byModule.map((_, i) => modPalette[i % modPalette.length]), borderRadius: 6, maxBarThickness: 26 }] }}
                      options={hbarOpts}
                    />
                  </div>
                </div>
                <div className="qcq-card" style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <h3 style={{ margin: 0 }}>Backlog — planned cases ({backlog.length})</h3>
                    <select className="qcq-search-input" style={{ marginLeft: 'auto', width: 150 }} value={planPerson} onChange={e => setPlanPerson(e.target.value)}>
                      <option value="all">All members</option>
                      {byPerson.map(p => <option key={p.person} value={p.person}>{p.person}</option>)}
                    </select>
                  </div>
                  <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                    <table className="auto-table"><thead><tr><th>Case</th><th>Module</th><th>Owner</th></tr></thead>
                      <tbody>
                        {backlog.map(c => (
                          <tr key={c.case_id}>
                            <td><a href={`https://bistrainer.testrail.io/index.php?/cases/view/${c.case_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>C{c.case_id}</a></td>
                            <td><span className="tm-chip">{c.module || '—'}</span></td>
                            <td>{c.automated_by}</td>
                          </tr>
                        ))}
                      </tbody></table>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {tab === 'team' && (() => {
          const MEMBER_COLORS = { 'Vishnu VS': '#14b8a6', 'Varsha Dcruz P': '#f59e0b', 'Vivek V Nair': '#a78bfa' };
          const colorFor = (name, i) => MEMBER_COLORS[name] || [TEAL, AMBER, PURPLE][i % 3];
          const initials = (n) => (n || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
          const totalThisWeek = team.reduce((s, m) => s + (m.this_week || 0), 0);
          const allWeeks = [...new Set(team.flatMap(m => (m.weekly || []).map(w => w.week)))].sort();
          const sparkOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { point: { radius: 0 } } };
          return (
            <>
              {overrideBadge}
              <div className="auto-actions" style={{ alignItems: 'center' }}>
                <div style={{ marginRight: 'auto', color: 'var(--text-secondary)', fontSize: 14 }}>
                  <b style={{ color: 'var(--text-primary)', fontSize: 20 }}>{totalThisWeek}</b> cases scripted by the team this week
                </div>
                <button className="btn btn-primary" onClick={downloadCard}>⤓ Download weekly report card</button>
              </div>
              <div className="tm-mem-grid">
                {team.map((mem, i) => {
                  const color = colorFor(mem.name, i);
                  const series = (mem.weekly || []).map(w => w.scripted);
                  return (
                    <div key={mem.name} className="tm-mem-card" style={{ '--c': color }}>
                      <div className="tm-mem-head">
                        <span className="tm-mem-avatar" style={{ background: color }}>{initials(mem.name)}</span>
                        <div>
                          <div className="tm-mem-name">{mem.name}</div>
                          <div className="tm-mem-sub">{mem.pending ? 'pending upload' : (mem.total_scripted == null ? 'all-time: awaiting prev. count' : `${mem.total_scripted} all-time`)}</div>
                        </div>
                      </div>
                      <div className="tm-mem-big">{mem.this_week == null ? '—' : mem.this_week}<span className="tm-mem-unit">scripted this week</span></div>
                      <div className="tm-mem-spark">
                        {series.length >= 2
                          ? <Line data={{ labels: series.map((_, k) => k), datasets: [{ data: series, borderColor: color, backgroundColor: color + '33', fill: true, tension: 0.4, borderWidth: 2 }] }} options={sparkOpts} />
                          : <div className="tm-spark-empty">weekly trend builds as more weeks are added</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="qcq-card">
                <h3>Weekly scripted — by member</h3>
                <div style={{ height: 300 }}>
                  <Bar
                    data={{
                      labels: allWeeks.map(w => (w.length >= 7 ? w.slice(5) : w)),
                      datasets: team.map((mem, i) => ({
                        label: mem.name,
                        data: allWeeks.map(w => { const f = (mem.weekly || []).find(x => x.week === w); return f ? f.scripted : 0; }),
                        backgroundColor: colorFor(mem.name, i),
                        borderRadius: 6,
                        maxBarThickness: 26,
                      })),
                    }}
                    options={{ ...baseOpts(), plugins: { ...baseOpts().plugins, legend: { display: true, position: 'bottom', labels: { color: AXIS, usePointStyle: true, pointStyle: 'circle', padding: 16 } } } }}
                  />
                </div>
                <p className="auto-muted" style={{ fontSize: '0.72rem', marginTop: 6 }}>Weeks are Mon–Fri. Vishnu has full history; Varsha &amp; Vivek fill in as their weekly lists are added.</p>
              </div>
            </>
          );
        })()}
      </main>
    </div>
  );
}
