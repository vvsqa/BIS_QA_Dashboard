import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import { PerformanceExportPanel } from './PerformanceExport';
import PerformersPanel from './Performers';
import { DiscussionPanel } from './Discussion';
import './dashboard.css';

export const PERIOD_KINDS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

// Build a dropdown of recent months (offset = months back from current).
export function monthOptions(n = 24) {
  const now = new Date();
  const opts = [];
  for (let k = 0; k < n; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    opts.push({ offset: k, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return opts;
}

// Build a dropdown of recent quarters.
export function quarterOptions(n = 8) {
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

// Compact 0-100 sub-score row: short label + bar + value + weight badge (detail in tooltip).
function ScoreBar({ label, value, color, weight, detail }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr 34px 30px', alignItems: 'center', gap: 10, marginBottom: 7 }} title={detail || label}>
      <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div style={{ height: 9, borderRadius: 6, background: 'rgba(148,163,184,0.13)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', borderRadius: 6, background: color, transition: 'width .25s' }} />
      </div>
      <span style={{ fontSize: '0.8rem', fontWeight: 800, textAlign: 'right' }}>{value}</span>
      {weight != null
        ? <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textAlign: 'right' }} title="weight">×{weight}</span>
        : <span />}
    </div>
  );
}

const EMP_PM_URL = 'https://pm.bissafety.app/tickets/';
const PANEL = { background: 'var(--bg-tertiary, #0f172a)', border: '1px solid var(--border-color, #334155)', borderRadius: 12, padding: 14 };
const PLBL = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 };

// Stat widget with an accent left-edge.
function Tile({ label, value, accent, sub, icon }) {
  return (
    <div style={{ ...PANEL, padding: '10px 12px', borderLeft: `3px solid ${accent || 'var(--border-color)'}`,
      display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{icon ? icon + ' ' : ''}{label}</span>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: accent || 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
      {sub != null && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{sub}</span>}
    </div>
  );
}

function Legend({ c, t, n }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, background: c, flexShrink: 0 }} /><b>{n}</b>&nbsp;{t}</span>;
}

// Complexity donut (conic-gradient ring) + legend.
function ComplexityDonut({ cc }) {
  const h = cc?.high || 0, m = cc?.medium || 0, l = cc?.low || 0, u = cc?.unrated || 0;
  const T = h + m + l + u || 1;
  const p = (n) => (n / T) * 100;
  const a1 = p(h), a2 = a1 + p(m), a3 = a2 + p(l);
  const bg = `conic-gradient(#ef4444 0 ${a1}%, #f59e0b ${a1}% ${a2}%, #22c55e ${a2}% ${a3}%, #475569 ${a3}% 100%)`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 92, height: 92, borderRadius: '50%', background: (h + m + l + u) ? bg : 'rgba(148,163,184,0.15)', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: 13, borderRadius: '50%', background: 'var(--bg-tertiary, #0f172a)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '1.35rem', fontWeight: 800 }}>{h + m + l}</span>
          <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>rated</span>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 5, fontSize: '0.76rem' }}>
        <Legend c="#ef4444" t="High" n={h} /><Legend c="#f59e0b" t="Medium" n={m} />
        <Legend c="#22c55e" t="Low" n={l} />{u > 0 && <Legend c="#475569" t="Unrated" n={u} />}
      </div>
    </div>
  );
}

// Speedometer-style gauge for the composite rating (0–100), with red/amber/green zones + needle.
function Gauge({ value = 0, size = 190, label = 'Rating' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const W = size;
  const H = Math.round(size * 0.80);
  const cx = size / 2;
  const cy = Math.round(size * 0.52);   // pivot — needle/arc above it, value number below it
  const r = size * 0.40;
  const stroke = Math.max(12, size * 0.072);
  // fraction [0,1] → point on the top semicircle (f=0 → left, f=1 → right).
  const pt = (f) => {
    const th = Math.PI * (1 - f);        // 180°(left) … 0°(right)
    return [cx + r * Math.cos(th), cy - r * Math.sin(th)];
  };
  const arc = (f0, f1) => {
    const [x0, y0] = pt(f0), [x1, y1] = pt(f1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const color = v >= 70 ? '#22c55e' : v >= 40 ? '#f59e0b' : '#ef4444';
  const band = v >= 70 ? 'Strong' : v >= 40 ? 'On track' : 'Needs focus';
  const [nx, ny] = pt(v / 100);
  const zones = [[0, 0.4, '#ef4444'], [0.4, 0.7, '#f59e0b'], [0.7, 1, '#22c55e']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {/* track background */}
        <path d={arc(0, 1)} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth={stroke} strokeLinecap="round" />
        {/* colored zones */}
        {zones.map(([a, b, c], i) => (
          <path key={i} d={arc(a, b)} fill="none" stroke={c} strokeWidth={stroke}
            strokeLinecap={i === 0 || i === zones.length - 1 ? 'round' : 'butt'} opacity={0.9} />
        ))}
        {/* needle (points to value) + hub */}
        <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke={color} strokeWidth={Math.max(2.5, size * 0.02)} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={size * 0.045} fill={color} />
        {/* value number — below the pivot so the needle never covers it */}
        <text x={cx} y={cy + size * 0.22} textAnchor="middle" fontSize={size * 0.21} fontWeight="800" fill={color}>{v}</text>
      </svg>
      <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color }}>{band}</span>
        <span style={{ ...PLBL }}>{label}</span>
      </div>
    </div>
  );
}

// What pulled the score down + where to concentrate — derived from the weighted sub-scores.
const SCORE_WEIGHTS = { throughput: 31, ticket_focus: 14, quality: 20, presence: 14, efficiency: 13, output: 8 };
function scoreInsights(entry) {
  const ss = entry.sub_scores || {}, rm = entry.raw_metrics || {}, cc = rm.complexity_counts || {};
  const util = rm.utilization_percent || 0;
  // Quality (RAG) for QA = test EXECUTION COMPLETENESS + utilization. (Pass-rate / rejected-bug%
  // are NOT counted — failing a case = catching a bug = good; every reported bug is positive.)
  const comp = rm.execution_completeness || 0;
  const cases = rm.tests_total_cases || 0;
  const qWhy = cases
    ? `${rm.quality_percent || 0}% · executed ${rm.tests_executed || 0}/${cases} cases (${comp}%) · util ${util}%`
    : `${rm.quality_percent || 0}% · util ${util}% · no test cases this period`;
  const qFix = comp < 90 && cases
    ? `Finish executing open cases before handing tickets to BIS (currently ${comp}% executed).`
    : (util < 70 ? `Lift utilization (currently ${util}% — low) and keep execution complete.` : 'Keep test execution complete and utilization productive.');
  const meta = {
    throughput: { name: 'Throughput', why: `delivered ${rm.delivered_to_live || 0} (${cc.high || 0} High / ${cc.medium || 0} Med) · ${rm.tests_executed || 0} cases executed`, fix: 'Take on more tickets (High-complexity carry most weight) and execute more test cases — both lift throughput.' },
    ticket_focus: { name: 'Ticket focus', why: `${rm.ticket_focus_percent || 0}% of time on real tickets`, fix: 'Log more time on tickets vs non-ticket tasks (meetings / learning / admin).' },
    quality: { name: 'Quality', why: qWhy, fix: qFix },
    presence: { name: 'Presence', why: `${rm.present_days || 0}/${rm.working_days || 0} days · ${util}% util`, fix: 'Improve attendance and productive (billable) hours.' },
    efficiency: { name: 'Efficiency', why: `on-time ${rm.on_time_rate || 0}%, est-acc ${rm.estimate_accuracy || 0}%${rm.overrun_tickets ? `, ${rm.overrun_tickets} over` : ''}`, fix: 'Deliver within the QA target time and tighten estimates.' },
    output: { name: 'Output', why: `${rm.bugs || 0} bugs found · ${rm.tests_executed || 0} cases executed`, fix: 'Report more defects (all count — rejected/deferred too) and execute more cases.' },
  };
  const rows = Object.keys(SCORE_WEIGHTS).map(k => ({
    k, ...meta[k], value: ss[k] ?? 0,
    lost: +(SCORE_WEIGHTS[k] * (100 - (ss[k] ?? 0)) / 100).toFixed(1),
  })).sort((a, b) => b.lost - a.lost);
  return rows.filter(r => r.lost >= 0.5).slice(0, 3);
}

function FocusPanel({ entry }) {
  const top = scoreInsights(entry);
  const rm = entry.raw_metrics || {};
  const managerDown = (rm.manager_note_net || 0) < 0;
  const bisUnexec = rm.unexecuted_at_bis || 0;
  if (!top.length && !managerDown && !bisUnexec) {
    return <div style={PANEL}><div style={PLBL}>🎯 Where to improve</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>Solid across the board — no major point losses this period.</div></div>;
  }
  return (
    <div style={{ ...PANEL, borderLeft: '3px solid var(--accent-amber, #f59e0b)' }}>
      <div style={PLBL}>🎯 What pulled the score down · where to concentrate</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {top.map((r, i) => (
          <div key={i} style={{ fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b>{r.name}</b>
              <span style={{ color: 'var(--accent-amber)' }}>−{r.lost} pts left on the table ({r.why})</span>
            </div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>→ {r.fix}</div>
          </div>
        ))}
        {bisUnexec > 0 && (
          <div style={{ fontSize: '0.78rem' }}>
            <div><b>Incomplete testing at BIS</b> <span style={{ color: 'var(--accent-red)' }}>(−{rm.bis_penalty || 0} pts · {bisUnexec} ticket{bisUnexec > 1 ? 's' : ''})</span></div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>→ {(rm.unexecuted_bis_tickets || []).slice(0, 6).map(t => '#' + t).join(', ')} moved to BIS with unexecuted cases — execute all cases before handoff.</div>
          </div>
        )}
        {managerDown && (
          <div style={{ fontSize: '0.78rem' }}>
            <div><b>Manager-flagged conduct</b> <span style={{ color: 'var(--accent-red)' }}>({rm.manager_note_net} diligence)</span></div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>→ Address the flagged incident(s) — see manager comments below.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Top modules delivered, as horizontal mini-bars.
function ModuleBars({ rows }) {
  const top = (rows || []).slice(0, 6);
  if (!top.length) return <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>No delivered tickets this period</span>;
  const max = Math.max(1, ...top.map(r => r.count));
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {top.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 26px', alignItems: 'center', gap: 8, fontSize: '0.74rem' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.module}>{r.module}</span>
          <div style={{ height: 8, borderRadius: 5, background: 'rgba(148,163,184,0.15)' }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', borderRadius: 5, background: 'var(--accent-teal, #14b8a6)' }} />
          </div>
          <span style={{ fontWeight: 700, textAlign: 'right' }}>{r.count}</span>
        </div>
      ))}
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
        {rm.complexity_counts && (
          <span className="emp-chip" title="Delivered tickets by complexity (High weighted most)">
            🧩 <b style={{ color: 'var(--accent-red)' }}>{rm.complexity_counts.high || 0}H</b>
            {' · '}<b style={{ color: 'var(--accent-amber)' }}>{rm.complexity_counts.medium || 0}M</b>
            {' · '}<b style={{ color: 'var(--accent-green)' }}>{rm.complexity_counts.low || 0}L</b>
          </span>
        )}
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

function ManagerNotes({ entry, reload }) {
  const rm = entry.raw_metrics || {};
  const notes = rm.manager_notes || [];
  const [sentiment, setSentiment] = useState('negative');
  const [severity, setSeverity] = useState('major');
  const [points, setPoints] = useState('');   // manual magnitude when severity === 'custom'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inp = { padding: '5px 7px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.78rem' };
  const custom = severity === 'custom';

  const add = async () => {
    if (!text.trim()) return;
    if (custom && !(parseInt(points) > 0)) return;   // manual mode needs a points value
    setBusy(true);
    try {
      const payload = { text, sentiment, employee_name: entry.name };
      if (custom) payload.points = parseInt(points);   // manual magnitude (sign from sentiment)
      else payload.severity = severity;
      await fetch(`${API_BASE}/employees/${entry.employee_id}/performance/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setText(''); setPoints(''); if (reload) await reload();
    } catch { /* ignore */ }
    setBusy(false);
  };
  const del = async (id) => {
    setBusy(true);
    try { await fetch(`${API_BASE}/employees/performance/notes/${id}`, { method: 'DELETE' }); if (reload) await reload(); }
    catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>
        🗨 Manager notes (fold into Diligence{rm.manager_note_net ? ` · net ${rm.manager_note_net > 0 ? '+' : ''}${rm.manager_note_net}` : ''})
      </div>
      {notes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {notes.map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '4px 0' }}>
              <span style={{ fontWeight: 700, minWidth: 34, color: n.points >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{n.points > 0 ? '+' : ''}{n.points}</span>
              <span style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--text-muted)', minWidth: 100 }}>{n.severity} · {n.sentiment}</span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{n.text}</span>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{n.date}</span>
              <button onClick={() => del(n.id)} disabled={busy} title="Remove note" style={{ ...inp, cursor: 'pointer', padding: '2px 7px', color: 'var(--accent-red)' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={sentiment} onChange={e => setSentiment(e.target.value)} style={inp}>
          <option value="negative">Negative</option><option value="positive">Positive</option>
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)} style={inp}>
          <option value="minor">Minor (±5)</option><option value="major">Major (±12)</option><option value="critical">Critical (±25)</option><option value="custom">Custom points…</option>
        </select>
        {custom && (
          <input type="number" min="1" max="1000" value={points} onChange={e => setPoints(e.target.value)} placeholder="points"
            title="Manual magnitude; the sign follows the sentiment (positive = +, negative = −)"
            style={{ ...inp, width: 80 }} />
        )}
        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="e.g. missed bug caused a Live crash / great handling of the urgent fix"
          style={{ ...inp, flex: 1, minWidth: 240 }} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button onClick={add} disabled={busy} style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: 'var(--accent-teal)', borderColor: 'var(--accent-teal)' }}>+ Add note</button>
      </div>
    </div>
  );
}

function FullRow({ entry, isQA, reload, apFrom, apTo }) {
  const [open, setOpen] = useState(false);
  const rm = entry.raw_metrics || {};
  return (
    <React.Fragment>
      <tr className="qcq-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td style={{ textAlign: 'center', fontWeight: 700 }}>{entry.rank}</td>
        <td style={{ textAlign: 'left' }}>{entry.name} <span className="emp-expand">{open ? '▲' : '▼'}</span></td>
        <td style={{ textAlign: 'center', fontWeight: 700 }}>{entry.composite_score}</td>
        <td style={{ textAlign: 'center' }}>{rm.delivered_to_live}</td>
        <td style={{ textAlign: 'center' }}>{rm.awaiting_review ?? 0}</td>
        <td style={{ textAlign: 'center' }} title="Complexity-weighted volume · delivered by complexity (High weighted most)">
          {rm.complexity_weighted_volume}
          {rm.complexity_counts && (
            <div style={{ fontSize: '0.62rem', marginTop: 2 }}>
              <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{rm.complexity_counts.high || 0}H</span>
              <span style={{ color: 'var(--text-muted)' }}> · {rm.complexity_counts.medium || 0}M · {rm.complexity_counts.low || 0}L</span>
            </div>
          )}
        </td>
        <td style={{ textAlign: 'center' }}>{rm.bugs}</td>
        <td style={{ textAlign: 'center' }} title="Days present / working days">{rm.present_days}/{rm.working_days}</td>
        <td style={{ textAlign: 'center', color: rm.avg_hours_per_day >= 8 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{rm.avg_hours_per_day}h</td>
        <td style={{ textAlign: 'center', color: rm.days_under_8 > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{rm.days_under_8 || '–'}</td>
        <td style={{ textAlign: 'center', color: rm.leave_days > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
          {rm.leave_days > 0 ? `${rm.leave_days} (−${entry.leave_penalty})` : '–'}
        </td>
        <td style={{ textAlign: 'center' }}>{rm.hours}</td>
        <td style={{ textAlign: 'center' }}>{rm.quality_percent}%</td>
        {isQA && <td style={{ textAlign: 'center', fontWeight: 700,
          color: !rm.diligence_score ? 'var(--text-muted)'
            : rm.diligence_score > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
          title={(rm.diligence_flags || []).join('; ') || 'No manager comments'}>
          {rm.diligence_score ? `${rm.diligence_score > 0 ? '+' : ''}${rm.diligence_score}` : '0'}
        </td>}
        <td style={{ textAlign: 'center' }} title={rm.revised_estimate_used ? `Uses manager-revised QA time on ${rm.revised_estimate_used} ticket(s)` : ''}>
          {rm.estimate_accuracy}%{rm.revised_estimate_used > 0 ? <span style={{ color: 'var(--accent-teal)', fontSize: '0.7rem' }}> ✎{rm.revised_estimate_used}</span> : null}
        </td>
        <td style={{ textAlign: 'center', color: rm.overrun_tickets > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}
            title={rm.overrun_tickets > 0 ? `+${rm.overrun_hours}h over estimate · on-time ${rm.on_time_rate}%` : 'No overruns'}>
          {rm.overrun_tickets > 0 ? `${rm.overrun_tickets} (+${rm.overrun_hours}h)` : '–'}
        </td>
        <td style={{ textAlign: 'center' }}>{rm.utilization_percent}%</td>
      </tr>
      {open && (
        <tr className="qcq-expand-row">
          <td colSpan={17} style={{ padding: '10px 16px' }}>
            <EmployeeBreakdown entry={entry} reload={reload} apFrom={apFrom} apTo={apTo} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

export function EmployeeBreakdown({ entry, reload, apFrom, apTo, hideRank = false }) {
  const rm = entry.raw_metrics || {};
  const ss = entry.sub_scores || {};
  const appraisalUrl = `${API_BASE}/employees/${entry.employee_id}/appraisal-report?from=${apFrom}&to=${apTo}${hideRank ? '&hide_rank=true' : ''}`;
  return (
            <div className="emp-breakdown">
              {/* Stat widgets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
                <Tile label="Delivered to live" value={rm.delivered_to_live ?? 0} accent="#14b8a6"
                  sub={rm.complexity_counts ? `${rm.complexity_counts.high || 0}H · ${rm.complexity_counts.medium || 0}M · ${rm.complexity_counts.low || 0}L` : null} />
                <Tile label="In progress (current)" value={rm.in_progress ?? 0} accent="#3b82f6" sub="live status" />
                <Tile label="Awaiting BIS (current)" value={rm.awaiting_review ?? 0} accent="#f59e0b" sub="live status" />
                <Tile label="Bugs reported" value={rm.bugs ?? 0} sub="all count · incl. rejected/deferred" />
                {(rm.tests_total_cases ?? 0) > 0
                  ? <Tile label="Execution completeness" value={`${rm.execution_completeness ?? 0}%`} accent="#14b8a6" sub={`${rm.tests_executed ?? 0}/${rm.tests_total_cases} cases · ${rm.tests_untested ?? 0} untested`} />
                  : <Tile label="Test cases executed" value={rm.tests_executed ?? 0} sub="no plan cases this period" />}
                {(rm.unexecuted_at_bis ?? 0) > 0
                  ? <Tile label="⚠ Unexecuted at BIS" value={rm.unexecuted_at_bis} accent="#ef4444" sub={`−${rm.bis_penalty ?? 0} penalty`} /> : null}
                <Tile label="Quality" value={`${rm.quality_percent}%`} accent="#22c55e" />
                <Tile label="Estimate accuracy" value={`${rm.estimate_accuracy}%`} sub={rm.revised_estimate_used ? `revised on ${rm.revised_estimate_used}` : null} />
                <Tile label="On-time vs target" value={`${rm.on_time_rate}%`} accent={rm.overrun_tickets > 0 ? '#f59e0b' : undefined} sub={rm.overrun_tickets > 0 ? `${rm.overrun_tickets} over (+${rm.overrun_hours}h)` : 'no overruns'} />
                <Tile label="Present" value={`${rm.present_days}/${rm.working_days}`} sub={`avg ${rm.avg_hours_per_day}h/day`} />
                <Tile label="Utilization" value={`${rm.utilization_percent}%`} sub={`${rm.hours}h logged`} />
                {rm.manager_note_net ? <Tile label="Diligence (comments)" value={`${rm.manager_note_net > 0 ? '+' : ''}${rm.manager_note_net}`} accent={rm.manager_note_net > 0 ? '#22c55e' : '#ef4444'} sub={`${(rm.manager_notes || []).length} note(s)`} /> : null}
                {rm.leave_days > 0 ? <Tile label="Leave" value={rm.leave_days} accent="#ef4444" sub={`−${entry.leave_penalty} penalty`} /> : null}
              </div>

              {/* Complexity donut + module breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div style={PANEL}>
                  <div style={{ ...PLBL, marginBottom: 10 }}>🧩 Delivered complexity mix</div>
                  <ComplexityDonut cc={rm.complexity_counts || {}} />
                </div>
                <div style={PANEL}>
                  <div style={{ ...PLBL, marginBottom: 10 }}>📦 Delivered by module</div>
                  <ModuleBars rows={rm.module_breakdown} />
                </div>
              </div>

              {/* Possible Live leakage (informational — review, not scored) */}
              {Array.isArray(rm.leakage_tickets) && rm.leakage_tickets.length > 0 && (
                <div style={{ ...PANEL, borderLeft: '3px solid var(--accent-amber, #f59e0b)', marginBottom: 12 }}>
                  <div style={PLBL}>⚠ Possible Live leakage this period — review (not auto-scored)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 4px' }}>
                    {rm.leakage_tickets.map(id => (
                      <a key={id} href={`${EMP_PM_URL}${id}`} target="_blank" rel="noreferrer"
                        style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 9px', borderRadius: 8,
                          background: 'rgba(245,158,11,0.13)', color: 'var(--accent-amber)', textDecoration: 'none' }}>#{id} ↗</a>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>If any is a genuine QA miss, add a manager comment below — that's what affects the score.</span>
                </div>
              )}

              {/* Score breakdown + how the composite was earned */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={PANEL}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
                    <span style={PLBL}>Score breakdown (0–100 × weight)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                    <Gauge value={entry.composite_score} size={190} label="Composite rating" />
                  </div>
                  <ScoreBar label="Throughput" value={num(ss.throughput)} weight={31} color="var(--accent-teal)" detail="Tickets × testing complexity (delivered + awaiting) + test-execution volume" />
                  <ScoreBar label="Ticket focus" value={num(ss.ticket_focus)} weight={14} color="var(--accent-cyan, #22d3ee)" detail="Ticket time vs non-ticket time" />
                  <ScoreBar label="Quality" value={num(ss.quality)} weight={20} color="var(--accent-green)" detail="Test execution completeness + utilization" />
                  <ScoreBar label="Presence" value={num(ss.presence)} weight={14} color="var(--accent-purple, #8b5cf6)" detail="Attendance + productive hours" />
                  <ScoreBar label="Efficiency" value={num(ss.efficiency)} weight={13} color="var(--accent-amber)" detail="On-time vs target + estimate accuracy + utilization" />
                  <ScoreBar label="Output" value={num(ss.output)} weight={8} color="var(--accent-blue)" detail="Bugs / tests — small capped bonus" />
                  {(rm.manager_note_net || rm.leave_days > 0) && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)', fontSize: '0.72rem', display: 'flex', gap: 14 }}>
                      {rm.manager_note_net ? <span>Diligence (comments): <b style={{ color: rm.manager_note_net > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{rm.manager_note_net > 0 ? '+' : ''}{rm.manager_note_net}</b></span> : null}
                      {rm.leave_days > 0 ? <span>Leave penalty: <b style={{ color: 'var(--accent-red)' }}>−{entry.leave_penalty}</b></span> : null}
                    </div>
                  )}
                </div>
                <div style={PANEL}>
                  <div style={{ ...PLBL, marginBottom: 8 }}>How it was earned</div>
                  {Array.isArray(entry.summary_lines) && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {entry.summary_lines.map((ln, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                          <span style={{ color: 'var(--accent-teal)', flexShrink: 0 }}>›</span>
                          <span>{ln}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}><FocusPanel entry={entry} /></div>

              <ManagerNotes entry={entry} reload={reload} />

              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <a href={appraisalUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: '0.8rem', fontWeight: 600, padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
                    color: '#fff', background: 'var(--accent-teal, #14b8a6)' }}>📄 Generate appraisal PDF</a>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>for {apFrom} → {apTo}</span>
              </div>
            </div>
  );
}

function TeamSection({ title, isQA, entries, summary, periodLabel, winnerOnly, periodKind, reload, apFrom, apTo }) {
  const [showAll, setShowAll] = useState(false);
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const winner = entries[0];
  return (
    <section className="qcq-section" style={{ marginBottom: '28px' }}>
      <div className="emp-section-head">
        <h2>{title}{winnerOnly ? <span className="emp-mobile-tag" style={{ marginLeft: 8, fontSize: '0.6em', fontWeight: 600, color: 'var(--accent-cyan, #22d3ee)', border: '1px solid var(--accent-cyan, #22d3ee)', borderRadius: 6, padding: '2px 6px', verticalAlign: 'middle' }}>SEPARATE BOARD</span> : null}</h2>
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

      {winnerOnly && winner && (
        <div className="emp-winner-banner" style={{
          display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 14px',
          padding: '12px 16px', borderRadius: 10,
          background: 'linear-gradient(90deg, rgba(245,158,11,0.16), rgba(245,158,11,0.02))',
          border: '1px solid rgba(245,158,11,0.45)'
        }}>
          <span style={{ fontSize: '1.4rem' }} role="img" aria-label="trophy">🏆</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {periodKind === 'quarter' ? 'Quarter' : 'Monthly'} performer (Mobile QA):{' '}
            <strong style={{ color: 'var(--text-primary)', fontSize: '1.05rem' }}>{winner.name}</strong>
            {' '}· {winner.composite_score} pts
          </span>
        </div>
      )}
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
                  {isQA && <th title="Diligence — escaped Live defects / idle holds / trivial fails (legit parking is fine)">Diligence</th>}
                  <th title="Estimate accuracy (uses manager-revised QA time where reviewed)">Est. Acc</th>
                  <th title="Tickets that overran their estimate (+overrun hours)">Overrun</th>
                  <th title="Timesheet utilization">Util</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? entries : top3).map(e => <FullRow key={e.employee_id} entry={e} isQA={isQA} reload={reload} apFrom={apFrom} apTo={apTo} />)}
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
  // Appraisal report period (default: start of this month → today)
  const _today = new Date();
  const [apFrom, setApFrom] = useState(`${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-01`);
  const [apTo, setApTo] = useState(_today.toISOString().slice(0, 10));

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
              <span style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Appraisal:</span>
                <input type="date" value={apFrom} onChange={e => setApFrom(e.target.value)} title="Appraisal period from"
                  style={{ padding: '5px 7px', borderRadius: 7, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.75rem' }} />
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <input type="date" value={apTo} onChange={e => setApTo(e.target.value)} title="Appraisal period to"
                  style={{ padding: '5px 7px', borderRadius: 7, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.75rem' }} />
              </span>
            </div>
          )}
        </header>

        <div className="qcq-tabs">
          <button className={`qcq-tab ${view === 'performance' ? 'active' : ''}`} onClick={() => setView('performance')}>Performance</button>
          <button className={`qcq-tab ${view === 'qaflow' ? 'active' : ''}`} onClick={() => setView('qaflow')}>QA Flow</button>
          <button className={`qcq-tab ${view === 'export' ? 'active' : ''}`} onClick={() => setView('export')}>Performance Export</button>
          <button className={`qcq-tab ${view === 'discussion' ? 'active' : ''}`} onClick={() => setView('discussion')}>1-on-1 Discussion</button>
          <button className={`qcq-tab ${view === 'performers' ? 'active' : ''}`} onClick={() => setView('performers')}>Performers</button>
        </div>

        {view === 'qaflow' ? (
          <QAFlowTab />
        ) : view === 'performers' ? (
          <PerformersPanel />
        ) : view === 'discussion' ? (
          <DiscussionPanel />
        ) : view === 'export' ? (
          <PerformanceExportPanel />
        ) : loading ? (
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading performance…</p></div>
        ) : error ? (
          <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn btn-primary">Retry</button></div>
        ) : (
          <>
            <TeamSection title="QA Team" isQA={true} entries={data?.qa || []}
              summary={data?.summary?.qa} periodLabel={data?.period?.label} reload={fetchData} apFrom={apFrom} apTo={apTo} />
            <TeamSection title="Mobile QA Team" isQA={true} entries={data?.mobile || []}
              summary={data?.summary?.mobile} periodLabel={data?.period?.label}
              winnerOnly periodKind={data?.period?.kind} reload={fetchData} apFrom={apFrom} apTo={apTo} />
            <TeamSection title="Dev Team" isQA={false} entries={data?.dev || []}
              summary={data?.summary?.dev} periodLabel={data?.period?.label} reload={fetchData} apFrom={apFrom} apTo={apTo} />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '4px' }}>
              Score = throughput (tickets taken × complexity, delivered + awaiting-review) + ticket-focus
              (share of logged time on real tickets vs non-ticket tasks) + quality (pass-rate/rejections,
              not bug count) + presence (attendance) + efficiency (on-time/estimate + utilization) + a small
              capped output bonus (bugs/tests), minus a leave penalty. Bug count no longer drives the ranking.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
