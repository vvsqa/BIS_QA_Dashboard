import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, downloadFile } from './api';
import { EmployeeBreakdown, monthOptions, quarterOptions } from './EmployeePerformance';
import './dashboard.css';

// 1-on-1 Discussion tab — show ONE employee their own performance for a period to discuss face-to-face,
// WITHOUT revealing their leaderboard position/rank. Same rich detail as the leaderboard expanded row,
// plus trend, AI talking points, a categorized per-ticket breakdown, and a rank-free PDF.

const TEAMS = [
  { key: 'qa', label: 'Web QA' },
  { key: 'mobile', label: 'Mobile QA' },
  { key: 'dev', label: 'Dev' },
];
const KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'custom', label: 'Custom range' },
];
const CAT_COLOR = { 'Delivered': '#16a34a', 'Awaiting review': '#d97706', 'In progress': '#3b82f6', 'Worked on': '#64748b' };
const CAT_ORDER = ['Delivered', 'Awaiting review', 'In progress', 'Worked on'];
const arrow = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '■');
const fmtV = (v, unit) => (v == null ? '–' : `${v}${unit || ''}`);

export function DiscussionPanel() {
  const [teamKey, setTeamKey] = useState('qa');
  const [kind, setKind] = useState('month');          // month | quarter | custom
  const [offset, setOffset] = useState(0);
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [board, setBoard] = useState(null);           // leaderboard {qa, mobile, dev, period}
  const [empId, setEmpId] = useState('');
  const [disc, setDisc] = useState(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingDisc, setLoadingDisc] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');

  const customValid = kind !== 'custom' || (cFrom && cTo && cFrom <= cTo);

  // Shared period params for both the leaderboard (picker) and the discussion endpoint.
  const periodQS = useCallback(() => {
    const qs = new URLSearchParams();
    if (kind === 'custom') {
      if (cFrom) qs.set('from', cFrom);
      if (cTo) qs.set('to', cTo);
      qs.set('period', 'month');   // ignored by the backend when from/to are present
    } else {
      qs.set('period', kind);
      qs.set('offset', String(offset));
    }
    return qs;
  }, [kind, offset, cFrom, cTo]);

  // Load the leaderboard for the team picker (and to know who's in each team this period).
  useEffect(() => {
    if (!customValid) return;
    let alive = true;
    (async () => {
      setLoadingBoard(true); setError('');
      try {
        const qs = periodQS(); qs.set('team', 'all');
        const res = await fetch(`${API_BASE}/employees/performance/leaderboard?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (alive) setBoard(d);
      } catch (e) { if (alive) setError('Could not load teams for this period.'); }
      finally { if (alive) setLoadingBoard(false); }
    })();
    return () => { alive = false; };
  }, [periodQS, customValid]);

  const teamList = (board && board[teamKey]) || [];

  // Drop the selected employee if they're not in the current team list.
  useEffect(() => {
    if (empId && !teamList.some(e => e.employee_id === empId)) setEmpId('');
  }, [teamKey, board]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Load the discussion detail for the selected employee.
  const loadDisc = useCallback(async () => {
    if (!empId || !customValid) { setDisc(null); return; }
    setLoadingDisc(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/employees/${empId}/discussion?${periodQS().toString()}`);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch { /* non-JSON */ }
        throw new Error(detail);
      }
      setDisc(await res.json());
    } catch (e) { setError(e.message); setDisc(null); }
    finally { setLoadingDisc(false); }
  }, [empId, periodQS, customValid]);

  useEffect(() => { loadDisc(); }, [loadDisc]);

  const resFrom = disc?.period?.start || cFrom;
  const resTo = disc?.period?.end || cTo;
  const pdfUrl = (empId && resFrom && resTo)
    ? `${API_BASE}/employees/${empId}/appraisal-report?from=${resFrom}&to=${resTo}&hide_rank=true`
    : null;
  const empName = (disc?.entry?.name) || (board?.[teamKey] || []).find(e => e.employee_id === empId)?.name || empId;
  const downloadPdf = useCallback(async () => {
    if (!pdfUrl) return;
    setPdfBusy(true); setPdfErr('');
    try {
      const fname = `1-on-1 ${empName} (${resFrom} to ${resTo}).pdf`;
      await downloadFile(pdfUrl, fname);
    } catch (e) {
      setPdfErr(e.message || 'Could not generate the PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  }, [pdfUrl, empName, resFrom, resTo]);
  const offsetOpts = kind === 'quarter' ? quarterOptions() : monthOptions();

  const card = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 14 };
  const H4 = { fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.4px', margin: '0 0 10px' };
  const inp = { padding: '6px 9px', borderRadius: 7, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.8rem' };
  const tp = disc?.talking_points;

  // Group tickets by category for the breakdown table.
  const grouped = {};
  for (const t of (disc?.tickets || [])) (grouped[t.category] = grouped[t.category] || []).push(t);

  return (
    <div className="qae-fade" style={{ display: 'grid', gap: 14, color: 'var(--text-primary)' }}>
      {/* CONTROLS */}
      <div style={{ ...card, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Team */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Team</span>
            <div className="qcq-platform-toggle">
              {TEAMS.map(t => (
                <button key={t.key} className={`btn btn-sm ${teamKey === t.key ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTeamKey(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>
          {/* Period kind */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Period</span>
            <div className="qcq-platform-toggle">
              {KINDS.map(k => (
                <button key={k.value} className={`btn btn-sm ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKind(k.value)}>{k.label}</button>
              ))}
            </div>
          </div>
          {/* Month/quarter offset OR custom dates */}
          {kind === 'custom' ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" style={inp} value={cFrom} max={cTo || undefined} onChange={e => setCFrom(e.target.value)} />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <input type="date" style={inp} value={cTo} min={cFrom || undefined} onChange={e => setCTo(e.target.value)} />
            </span>
          ) : (
            <select style={{ ...inp, minWidth: 150 }} value={offset} onChange={e => setOffset(Number(e.target.value))}>
              {offsetOpts.map(o => <option key={o.offset} value={o.offset}>{o.label}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Employee */}
          <select style={{ ...inp, minWidth: 240 }} value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">{loadingBoard ? 'Loading team…' : `— select from ${TEAMS.find(t => t.key === teamKey)?.label} (${teamList.length}) —`}</option>
            {teamList.map(e => <option key={e.employee_id} value={e.employee_id}>{e.name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={downloadPdf}
            disabled={!pdfUrl || pdfBusy}
            style={{ opacity: (pdfUrl && !pdfBusy) ? 1 : 0.6, cursor: (pdfUrl && !pdfBusy) ? 'pointer' : 'default' }}>
            {pdfBusy ? '⏳ Preparing PDF…' : '⬇ Download PDF'}
          </button>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 'auto', maxWidth: 280 }}>
            Discussion view — full performance detail &amp; trend, but the leaderboard position is hidden.
          </span>
        </div>
        {pdfErr && <span style={{ fontSize: '0.72rem', color: '#dc2626' }}>{pdfErr}</span>}
        {kind === 'custom' && !customValid && <span style={{ fontSize: '0.72rem', color: CAT_COLOR['Awaiting review'] }}>Pick a valid From/To range.</span>}
      </div>

      {!empId && !loadingDisc && <p style={{ color: 'var(--text-muted)' }}>Pick a team and a team member to see their performance.</p>}
      {loadingDisc && <div className="loading-container"><div className="loading-spinner"></div><p>Loading…</p></div>}
      {error && <p style={{ color: CAT_COLOR.Delivered && '#dc2626' }}>{error}</p>}

      {disc && !loadingDisc && (
        <>
          {/* HEADER */}
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{disc.employee.name}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{disc.employee.role} · {disc.period?.label}</div>
            </div>
            {disc.score != null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--accent-teal)' }}>{disc.score}<span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/100</span></div>
                <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>performance score</div>
              </div>
            )}
          </div>

          {/* TALKING POINTS */}
          {tp && (
            <div style={card}>
              <h4 style={H4}>Talking points {tp.source === 'ai' ? '· AI' : ''}</h4>
              {tp.overall && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0 }}>{tp.overall}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: CAT_COLOR.Delivered, marginBottom: 4 }}>Strengths</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {(tp.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: CAT_COLOR['Awaiting review'], marginBottom: 4 }}>Areas to improve</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {(tp.areas || []).map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TREND */}
          {disc.trend?.length > 0 && (
            <div style={card}>
              <h4 style={H4}>Trend vs previous period</h4>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {disc.trend.map(t => {
                  const flat = t.delta === 0; const up = t.delta > 0;
                  const c = flat ? 'var(--text-muted)' : (up ? CAT_COLOR.Delivered : '#dc2626');
                  return (
                    <div key={t.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{fmtV(t.current, t.unit)}</div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{t.label}</div>
                      <div style={{ fontSize: '0.66rem', color: c }}>{arrow(t.delta)} {t.delta > 0 ? '+' : ''}{t.delta}{t.unit} vs {fmtV(t.previous, t.unit)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FULL LEADERBOARD DETAIL (rank-free) */}
          {disc.entry && (
            <div style={{ ...card, padding: 4 }}>
              <EmployeeBreakdown entry={disc.entry} reload={loadDisc} apFrom={resFrom} apTo={resTo} hideRank />
            </div>
          )}

          {/* TICKETS BY CATEGORY */}
          <div style={card}>
            <h4 style={H4}>Tickets this period ({disc.tickets?.length || 0})</h4>
            {disc.tickets?.length > 0 ? (
              CAT_ORDER.filter(c => grouped[c]).map(cat => (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: CAT_COLOR[cat], marginBottom: 4 }}>
                    {cat} <span style={{ color: 'var(--text-muted)' }}>({grouped[cat].length})</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ padding: '4px 8px' }}>#</th><th style={{ padding: '4px 8px' }}>Title</th>
                          <th style={{ padding: '4px 8px' }}>Module</th><th style={{ padding: '4px 8px' }}>Status</th>
                          <th style={{ padding: '4px 8px' }}>Cmplx</th><th style={{ padding: '4px 8px', textAlign: 'right' }}>Planned</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>Actual</th><th style={{ padding: '4px 8px', textAlign: 'right' }}>Revised</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }} title="Bugs found (major)">Bugs</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }} title="Test cases executed / total">Tests</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }} title="Refix / QC-fail cycles">Refix</th>
                          <th style={{ padding: '4px 8px' }}>Closed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped[cat].map(t => (
                          <tr key={t.ticket_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '4px 8px', fontWeight: 700 }}>
                              <a href={`https://pm.bissafety.app/tickets/${t.ticket_id}`} target="_blank" rel="noreferrer"
                                style={{ color: 'var(--accent-teal)', textDecoration: 'none' }}>{t.ticket_id}</a>
                            </td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{t.title}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{t.module || '–'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{t.status || '–'}</td>
                            <td style={{ padding: '4px 8px' }}>{t.complexity || '–'}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{t.planned != null ? `${t.planned}h` : '–'}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{t.actual != null ? `${t.actual}h` : '–'}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{t.revised != null ? `${t.revised}h` : '–'}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              {t.bugs || 0}{t.bugs_major ? <span style={{ color: '#dc2626' }}> ({t.bugs_major}M)</span> : ''}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                              {t.tests_total ? `${t.tests_executed}/${t.tests_total}` : '–'}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center', color: t.refix ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{t.refix || '–'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{t.closed_on || '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            ) : <p style={{ color: 'var(--text-muted)', margin: 0 }}>No tickets touched in this period.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default DiscussionPanel;
