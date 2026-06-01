import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PERIOD_KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

// Build a dropdown of recent months (offset = months back from current).
function monthOptions(n = 24) {
  const now = new Date();
  const opts = [];
  for (let k = 0; k < n; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    opts.push({ offset: k, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return opts;
}

// Build a dropdown of recent quarters.
function quarterOptions(n = 8) {
  const now = new Date();
  const curIdx = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
  const opts = [];
  for (let k = 0; k < n; k++) {
    const idx = curIdx - k;
    opts.push({ offset: k, label: `Q${(idx % 4) + 1} ${Math.floor(idx / 4)}` });
  }
  return opts;
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

function num(v, d = 0) {
  if (v === null || v === undefined) return d;
  return v;
}

// Horizontal bar for a 0-100 sub-score.
function ScoreBar({ label, value, color }) {
  return (
    <div className="emp-bar-row">
      <span className="emp-bar-label">{label}</span>
      <div className="emp-bar-track">
        <div className="emp-bar-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="emp-bar-value">{value}</span>
    </div>
  );
}

function PodiumCard({ entry, isQA }) {
  const rm = entry.raw_metrics || {};
  const rankClass = entry.rank === 1 ? 'emp-rank-1' : entry.rank === 2 ? 'emp-rank-2' : 'emp-rank-3';
  return (
    <div className={`emp-podium-card ${rankClass}`}>
      <div className="emp-podium-top">
        <span className="emp-medal">{MEDAL[entry.rank] || `#${entry.rank}`}</span>
        <div className="emp-podium-name">
          <span className="emp-name">{entry.name}</span>
          <span className="emp-role">{entry.role || (isQA ? 'QA' : 'Dev')}</span>
        </div>
        <span className="emp-score">{entry.composite_score}</span>
      </div>
      <div className="emp-podium-chips">
        <span className="emp-chip emp-chip-presence" title="Days present / working days (attendance — billing)">
          📅 {rm.present_days}/{rm.working_days} present
        </span>
        {rm.leave_days > 0 && (
          <span className="emp-chip emp-chip-leave" title="Leave days taken (billing loss)">
            🔻 {rm.leave_days} leave (−{entry.leave_penalty})
          </span>
        )}
        <span className="emp-chip emp-chip-deliver" title="Tickets delivered to live in this period">
          🚀 {rm.delivered_to_live} delivered
        </span>
        {rm.awaiting_review > 0 && (
          <span className="emp-chip emp-chip-await" title="Handed off, awaiting BIS review / go-live (credited)">
            ⏳ {rm.awaiting_review} in review
          </span>
        )}
        <span className="emp-chip emp-chip-quality" title="Quality score">✓ {rm.quality_percent}% quality</span>
        <span className="emp-chip">{rm.bugs} bugs</span>
        <span className="emp-chip">{rm.hours}h</span>
      </div>
      {Array.isArray(entry.summary_lines) && entry.summary_lines.length > 0 && (
        <ul className="emp-summary-lines">
          {entry.summary_lines.map((ln, i) => <li key={i}>{ln}</li>)}
        </ul>
      )}
    </div>
  );
}

function FullRow({ entry, isQA }) {
  const [open, setOpen] = useState(false);
  const rm = entry.raw_metrics || {};
  const ss = entry.sub_scores || {};
  return (
    <React.Fragment>
      <tr className="qcq-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center', fontWeight: 700 }}>{entry.rank}</td>
        <td style={{ textAlign: 'left' }}>{entry.name} <span className="emp-expand">{open ? '▲' : '▼'}</span></td>
        <td style={{ textAlign: 'center', fontWeight: 700 }}>{entry.composite_score}</td>
        <td style={{ textAlign: 'center' }}>{rm.delivered_to_live}</td>
        <td style={{ textAlign: 'center' }}>{rm.awaiting_review ?? 0}</td>
        <td style={{ textAlign: 'center' }}>{rm.complexity_weighted_volume}</td>
        <td style={{ textAlign: 'center' }}>{rm.bugs}</td>
        <td style={{ textAlign: 'center' }} title="Days present / working days">{rm.present_days}/{rm.working_days}</td>
        <td style={{ textAlign: 'center', color: rm.avg_hours_per_day >= 8 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{rm.avg_hours_per_day}h</td>
        <td style={{ textAlign: 'center', color: rm.days_under_8 > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{rm.days_under_8 || '–'}</td>
        <td style={{ textAlign: 'center', color: rm.leave_days > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
          {rm.leave_days > 0 ? `${rm.leave_days} (−${entry.leave_penalty})` : '–'}
        </td>
        <td style={{ textAlign: 'center' }}>{rm.hours}</td>
        <td style={{ textAlign: 'center' }}>{rm.quality_percent}%</td>
        <td style={{ textAlign: 'center' }}>{rm.estimate_accuracy}%</td>
        <td style={{ textAlign: 'center', color: rm.overrun_tickets > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}
            title={rm.overrun_tickets > 0 ? `+${rm.overrun_hours}h over estimate · on-time ${rm.on_time_rate}%` : 'No overruns'}>
          {rm.overrun_tickets > 0 ? `${rm.overrun_tickets} (+${rm.overrun_hours}h)` : '–'}
        </td>
        <td style={{ textAlign: 'center' }}>{rm.utilization_percent}%</td>
      </tr>
      {open && (
        <tr className="qcq-expand-row">
          <td colSpan={16} style={{ padding: '10px 16px' }}>
            <div className="emp-breakdown">
              <h5>Score breakdown (weighted: presence 25 · throughput 20 · output 12 · quality 30 · efficiency 13{rm.leave_days > 0 ? `  ·  −${entry.leave_penalty} leave penalty` : ''})</h5>
              <ScoreBar label="Presence" value={num(ss.presence)} color="var(--accent-purple, #8b5cf6)" />
              <ScoreBar label="Throughput" value={num(ss.throughput)} color="var(--accent-teal)" />
              <ScoreBar label="Output" value={num(ss.output)} color="var(--accent-blue)" />
              <ScoreBar label="Quality" value={num(ss.quality)} color="var(--accent-green)" />
              <ScoreBar label="Efficiency" value={num(ss.efficiency)} color="var(--accent-amber)" />
              {Array.isArray(entry.summary_lines) && (
                <ul className="emp-summary-lines" style={{ marginTop: 8 }}>
                  {entry.summary_lines.map((ln, i) => <li key={i}>{ln}</li>)}
                </ul>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

function TeamSection({ title, isQA, entries, summary, periodLabel }) {
  const [showAll, setShowAll] = useState(false);
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
    <section className="qcq-section" style={{ marginBottom: '28px' }}>
      <div className="emp-section-head">
        <h2>{title}</h2>
        <div className="emp-summary-banner">
          <div className="emp-summary-stat">
            <span className="emp-summary-value">{summary?.delivered_total ?? 0}</span>
            <span className="emp-summary-label">Delivered to live</span>
          </div>
          <div className="emp-summary-stat">
            <span className="emp-summary-value">{summary?.avg_quality ?? 0}%</span>
            <span className="emp-summary-label">Avg quality</span>
          </div>
          <div className="emp-summary-stat">
            <span className="emp-summary-value">{summary?.members ?? 0}</span>
            <span className="emp-summary-label">Contributors</span>
          </div>
          <div className="emp-summary-stat">
            <span className="emp-summary-value">{summary?.bugs_total ?? 0}</span>
            <span className="emp-summary-label">{isQA ? 'Bugs reported' : 'Bugs handled'}</span>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No delivery activity recorded for {periodLabel}.</p>
      ) : (
        <>
          <div className="emp-podium">
            {top3.map(e => <PodiumCard key={e.employee_id} entry={e} isQA={isQA} />)}
          </div>

          <div className="qcq-table-container" style={{ marginTop: '16px' }}>
            <table className="qcq-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>Rank</th>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th>Score</th>
                  <th title="Tickets delivered to live in period">Delivered</th>
                  <th title="Handed off, awaiting BIS review / go-live (credited)">In Review</th>
                  <th title="Complexity-weighted volume (priority × estimate)">Complexity</th>
                  <th>{isQA ? 'Bugs found' : 'Bugs handled'}</th>
                  <th title="Days present / working days (attendance)">Present</th>
                  <th title="Average hours logged per present day">Avg/day</th>
                  <th title="Days with under 8 hours logged">&lt;8h</th>
                  <th title="Leave days taken (billing loss penalty)">Leave</th>
                  <th>Hours</th>
                  <th>Quality</th>
                  <th title="Estimate accuracy">Est. Acc</th>
                  <th title="Tickets that overran their estimate (+overrun hours)">Overrun</th>
                  <th title="Timesheet utilization">Util</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? entries : top3).map(e => <FullRow key={e.employee_id} entry={e} isQA={isQA} />)}
              </tbody>
            </table>
          </div>
          {rest.length > 0 && (
            <button className="btn btn-sm btn-secondary" style={{ marginTop: '10px' }} onClick={() => setShowAll(s => !s)}>
              {showAll ? 'Show top 3 only' : `Show all ${entries.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FlowTable({ title, rows, keyField, label }) {
  return (
    <div className="qcq-section" style={{ marginBottom: '20px' }}>
      <h2 className="qcq-section-title">{title}</h2>
      <div className="qcq-table-container">
        <table className="qcq-table">
          <thead><tr>
            <th style={{ textAlign: 'left' }}>{label}</th>
            <th title="Fresh tickets received into QA">Fresh</th>
            <th title="Handed over to BIS">To BIS</th>
            <th>Closed</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r[keyField]} className="qcq-row">
                <td style={{ textAlign: 'left' }}>{r[keyField]}</td>
                <td style={{ textAlign: 'center', color: 'var(--accent-teal)' }}>{r.fresh || '–'}</td>
                <td style={{ textAlign: 'center', color: 'var(--accent-amber)' }}>{r.bis || '–'}</td>
                <td style={{ textAlign: 'center', color: 'var(--accent-green)', fontWeight: 600 }}>{r.closed || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QAFlowTab() {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fetchFlow = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`${API_BASE}/qa-flow?offset=${offset}&trend=6`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [offset]);
  useEffect(() => { fetchFlow(); }, [fetchFlow]);

  if (loading) return <div className="loading-container"><div className="loading-spinner"></div><p>Loading QA flow…</p></div>;
  if (err) return <div className="error-container"><p>{err}</p><button onClick={fetchFlow} className="btn btn-primary">Retry</button></div>;

  const trend = data?.trend || [];
  const maxF = Math.max(1, ...trend.map(t => t.fresh_received));
  const maxB = Math.max(1, ...trend.map(t => t.handed_to_bis));
  const maxC = Math.max(1, ...trend.map(t => t.closed));

  return (
    <>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <select className="qcq-search-input" style={{ minWidth: '150px' }}
          value={offset} onChange={e => setOffset(Number(e.target.value))}>
          {monthOptions().map(o => (
            <option key={o.offset} value={o.offset}>{o.label}</option>
          ))}
        </select>
        <span style={{ fontWeight: 700 }}>{data?.period?.label}</span>
        <span className={`emp-period-badge ${data?.period?.frozen ? 'emp-final' : 'emp-live'}`}>
          {data?.period?.frozen ? 'Final' : 'Live'}
        </span>
      </div>

      <div className="qcq-status-cards">
        <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-teal)' }}>
          <div className="qcq-card-value">{data.fresh_received}</div>
          <div className="qcq-card-label">Fresh received in QA</div>
        </div>
        <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-amber)' }}>
          <div className="qcq-card-value">{data.handed_to_bis}</div>
          <div className="qcq-card-label">Handed to BIS</div>
        </div>
        <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
          <div className="qcq-card-value">{data.closed}</div>
          <div className="qcq-card-label">Closed</div>
        </div>
      </div>

      <div className="qcq-section">
        <h2 className="qcq-section-title">Monthly comparison (last {trend.length} months)</h2>
        <div className="emp-flow-chart">
          {trend.map(t => (
            <div key={t.label} className="emp-flow-col">
              <div className="emp-flow-bars">
                <div className="emp-flow-bar" style={{ height: `${(t.fresh_received / maxF) * 100}%`, background: 'var(--accent-teal)' }} title={`Fresh: ${t.fresh_received}`} />
                <div className="emp-flow-bar" style={{ height: `${(t.handed_to_bis / maxB) * 100}%`, background: 'var(--accent-amber)' }} title={`To BIS: ${t.handed_to_bis}`} />
                <div className="emp-flow-bar" style={{ height: `${(t.closed / maxC) * 100}%`, background: 'var(--accent-green)' }} title={`Closed: ${t.closed}`} />
              </div>
              <div className="emp-flow-xlabel">{t.label.replace(' 20', " '")}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.72rem' }}>
          <span><span className="emp-dot" style={{ background: 'var(--accent-teal)' }} /> Fresh received</span>
          <span><span className="emp-dot" style={{ background: 'var(--accent-amber)' }} /> Handed to BIS</span>
          <span><span className="emp-dot" style={{ background: 'var(--accent-green)' }} /> Closed</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '6px' }}>
          Each series is scaled to its own max for readability. Closed has full history; Fresh-received &amp;
          Handed-to-BIS are tracked from May 2026 onward (when status-history capture began) and fill in each month.
        </p>
      </div>

      <FlowTable title="By module" rows={data.by_module || []} keyField="module" label="Module" />
      <FlowTable title="By QC tester" rows={data.by_qc_tester || []} keyField="qc_tester" label="QC Tester" />
    </>
  );
}

export default function EmployeePerformance() {
  const [view, setView] = useState('performance');
  const [kind, setKind] = useState('month');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/employees/performance/leaderboard?period=${kind}&offset=${offset}&team=all`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kind, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Employee Performance</h1>
            <p className="header-subtitle">
              Top performers by delivery &amp; quality{data?.period?.label ? ` — ${data.period.label}` : ''}
              {data?.period && (
                <span className={`emp-period-badge ${data.period.frozen ? 'emp-final' : 'emp-live'}`}>
                  {data.period.frozen ? 'Final' : 'Live'}
                </span>
              )}
            </p>
          </div>
          {view === 'performance' && (
            <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="qcq-platform-toggle">
                {PERIOD_KINDS.map(k => (
                  <button key={k.value} className={`btn btn-sm ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setKind(k.value); setOffset(0); }}>{k.label}</button>
                ))}
              </div>
              <select className="qcq-search-input" style={{ minWidth: '150px' }}
                value={offset} onChange={e => setOffset(Number(e.target.value))}>
                {(kind === 'quarter' ? quarterOptions() : monthOptions()).map(o => (
                  <option key={o.offset} value={o.offset}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </header>

        <div className="qcq-tabs">
          <button className={`qcq-tab ${view === 'performance' ? 'active' : ''}`} onClick={() => setView('performance')}>Performance</button>
          <button className={`qcq-tab ${view === 'qaflow' ? 'active' : ''}`} onClick={() => setView('qaflow')}>QA Flow</button>
        </div>

        {view === 'qaflow' ? (
          <QAFlowTab />
        ) : loading ? (
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading performance…</p></div>
        ) : error ? (
          <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn btn-primary">Retry</button></div>
        ) : (
          <>
            <TeamSection title="QA Team" isQA={true} entries={data?.qa || []}
              summary={data?.summary?.qa} periodLabel={data?.period?.label} />
            <TeamSection title="Dev Team" isQA={false} entries={data?.dev || []}
              summary={data?.summary?.dev} periodLabel={data?.period?.label} />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '4px' }}>
              Score = presence (attendance) + throughput (delivered + awaiting-review, depth-weighted) +
              output (bugs) + quality + efficiency (on-time/estimate + utilization), minus a leave penalty.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
