import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PERIOD_KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

// How many periods back the user can look.
const OFFSETS = [
  { value: 0, label: 'Current' },
  { value: 1, label: 'Previous' },
  { value: 2, label: '2 ago' },
];

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
        {isQA && <td style={{ textAlign: 'center' }}>{rm.test_results_executed}</td>}
        <td style={{ textAlign: 'center' }}>{rm.hours}</td>
        <td style={{ textAlign: 'center' }}>{rm.quality_percent}%</td>
        <td style={{ textAlign: 'center' }}>{rm.estimate_accuracy}%</td>
        <td style={{ textAlign: 'center' }}>{rm.utilization_percent}%</td>
      </tr>
      {open && (
        <tr className="qcq-expand-row">
          <td colSpan={isQA ? 12 : 11} style={{ padding: '10px 16px' }}>
            <div className="emp-breakdown">
              <h5>Score breakdown (weighted: throughput 25 · output 20 · quality 35 · efficiency 20)</h5>
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
                  {isQA && <th title="Test results executed (TestRail)">Tests</th>}
                  <th>Hours</th>
                  <th>Quality</th>
                  <th title="Estimate accuracy">Est. Acc</th>
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

export default function EmployeePerformance() {
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
          <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="qcq-platform-toggle">
              {PERIOD_KINDS.map(k => (
                <button key={k.value} className={`btn btn-sm ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKind(k.value)}>{k.label}</button>
              ))}
            </div>
            <div className="qcq-platform-toggle">
              {OFFSETS.map(o => (
                <button key={o.value} className={`btn btn-sm ${offset === o.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setOffset(o.value)}>{o.label}</button>
              ))}
            </div>
          </div>
        </header>

        {loading ? (
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
              Score = throughput (volume × ticket complexity) + output (bugs/tests) + quality + efficiency,
              over tickets delivered to live in the selected period. "Tests" reflects executed TestRail results.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
