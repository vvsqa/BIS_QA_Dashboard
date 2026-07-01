import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import { TicketFlow } from './TicketSpeed';
import TicketEstimatePanel from './TicketEstimatePanel';
import './dashboard.css';

const SCORE_COLORS = {
  high: 'var(--accent-red, #ef4444)',
  medium: 'var(--accent-amber, #f59e0b)',
  low: 'var(--accent-green, #22c55e)',
};

function getScoreLevel(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function ScoreBar({ score, breakdown }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const level = getScoreLevel(score);
  return (
    <div className="qcq-score-wrapper" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <div className="qcq-score-bar-bg">
        <div className="qcq-score-bar-fill" style={{ width: `${score}%`, background: SCORE_COLORS[level] }} />
      </div>
      <span className="qcq-score-val" style={{ color: SCORE_COLORS[level] }}>{score}</span>
      {showTooltip && breakdown && (
        <div className="qcq-score-tooltip">
          {Object.entries(breakdown).map(([key, v]) => (
            <div key={key} className="qcq-tooltip-row">
              <span className="qcq-tooltip-label">{key}</span>
              <span className="qcq-tooltip-pts">{v.points}/{v.max}</span>
              <span className="qcq-tooltip-detail">{v.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgeingBadge({ days }) {
  let cls = 'qcq-age-fresh';
  if (days >= 15) cls = 'qcq-age-critical';
  else if (days >= 7) cls = 'qcq-age-stale';
  else if (days >= 3) cls = 'qcq-age-aging';
  return <span className={`qcq-age-badge ${cls}`}>{days}d</span>;
}

// Complexity (how hard a ticket is to TEST) — High / Medium / Low.
const CX_STYLE = {
  High:   ['var(--accent-red, #ef4444)',   'rgba(239,68,68,0.13)'],
  Medium: ['var(--accent-amber, #f59e0b)', 'rgba(245,158,11,0.13)'],
  Low:    ['var(--accent-green, #22c55e)', 'rgba(34,197,94,0.13)'],
};
function ComplexityBadge({ level, overridden, title }) {
  if (!level || level === 'Unknown') return <span style={{ color: 'var(--text-muted)' }} title={title || 'Not rated yet — warming…'}>—</span>;
  const [color, bg] = CX_STYLE[level] || ['var(--text-muted)', 'transparent'];
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 11,
      fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.4, background: bg, color }}>
      {level}{overridden ? <span title="Manually set" style={{ fontSize: '0.62rem' }}>✎</span> : null}
    </span>
  );
}
// 0-3 score as filled/empty pips.
function CxPips({ score }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%',
          background: i < (score || 0) ? 'var(--accent-blue, #3b82f6)' : 'var(--border-color, #334155)' }} />
      ))}
    </span>
  );
}

const DONUT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#f97316', '#06b6d4', '#84cc16', '#a855f7', '#6366f1'];

function DistributionDonut({ title, counts, total, activeKey, onSlice }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length || !total) return null;
  const R = 60, r = 38, cx = 70, cy = 70;
  let angle = 0;
  const arcs = entries.map(([k, c], i) => {
    const pct = c / total, sa = angle; angle += pct * 360; const ea = angle;
    const s = sa * Math.PI / 180, e = ea * Math.PI / 180, large = pct > 0.5 ? 1 : 0;
    const x1 = cx + R * Math.sin(s), y1 = cy - R * Math.cos(s), x2 = cx + R * Math.sin(e), y2 = cy - R * Math.cos(e);
    const ix1 = cx + r * Math.sin(s), iy1 = cy - r * Math.cos(s), ix2 = cx + r * Math.sin(e), iy2 = cy - r * Math.cos(e);
    // full-circle guard when a single slice is 100%
    const d = pct >= 0.999
      ? `M${cx},${cy - R} A${R},${R} 0 1 1 ${cx - 0.01},${cy - R} M${cx},${cy - r} A${r},${r} 0 1 0 ${cx - 0.01},${cy - r}`
      : `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${large} 0 ${ix1},${iy1} Z`;
    return { k, c, pct, color: DONUT_COLORS[i % DONUT_COLORS.length], d };
  });
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{title}</span>
        <svg width="140" height="140" viewBox="0 0 140 140">
          {arcs.map(a => (
            <path key={a.k} d={a.d} fill={a.color} stroke="var(--bg-primary)" strokeWidth="1.5" style={{ cursor: 'pointer' }} onClick={() => onSlice(a.k)}>
              <title>{a.k}: {a.c} ({Math.round(a.pct * 100)}%)</title>
            </path>
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize="16" fontWeight="bold">{total}</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text-muted)" fontSize="8">tickets</text>
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: 150, overflowY: 'auto' }}>
        {entries.map(([k, c], i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', cursor: 'pointer', opacity: activeKey && activeKey !== k ? 0.4 : 1 }}
            onClick={() => onSlice(k)}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: DONUT_COLORS[i % DONUT_COLORS.length], flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{c}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({Math.round(c / total * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PM_TICKET_URL = 'https://pm.bissafety.app/tickets/';

function lkChip(label, color, bg, title) {
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 11,
    fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.4, background: bg, color }}>{label}</span>;
}

// Download a ticket's test-plan Excel (built on demand from TestRail if no pre-built file exists).
function downloadTestPlanExcel(ticketId) {
  fetch(`${API_BASE}/live/test-plan-excel/${ticketId}`)
    .then(res => { if (!res.ok) throw new Error('no excel'); return res.blob(); })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `TestPlan_${ticketId}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    })
    .catch(() => window.open(`${API_BASE}/live/test-plan-excel/${ticketId}`, '_blank'));
}

// Remove the Excel attachment from the ticket's TestRail plan (cleanup).
function detachPlanExcel(ticketId) {
  if (!window.confirm(`Remove the Excel attachment from ticket ${ticketId}'s TestRail plan?`)) return;
  fetch(`${API_BASE}/live/test-plan-queue/${ticketId}/detach-excel`, { method: 'POST' })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (ok && d.removed) window.alert(`Removed ${d.removed} Excel attachment(s) from ${ticketId}'s TestRail plan.`);
      else if (ok) window.alert(`Nothing to remove for ${ticketId}: ${d.reason || 'no Excel attached.'}`);
      else window.alert(`Could not edit the TestRail plan for ${ticketId}: ${d.detail || 'error'}`);
    })
    .catch(() => window.alert(`Could not reach the server for ${ticketId}.`));
}

// Apply lifecycle of an uploaded reviewed Excel: queued (runner not yet) → applied (runner reported
// done, with timestamp) → failed (runner reported an error). Null when nothing was uploaded.
function reviewApplyState(t) {
  const loops = t?.review_loops || 0;
  if (!loops) return null;
  const RED = 'var(--accent-red, #ef4444)', AMBER = 'var(--accent-amber, #f59e0b)', GREEN = 'var(--accent-green, #22c55e)';
  const rel = (s) => {
    if (!s) return '';
    const d = (Date.now() - new Date(s).getTime()) / 1000;
    if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
    if (d < 86400) return `${Math.round(d / 3600)}h ago`;
    return `${Math.round(d / 86400)}d ago`;
  };
  if (t.review_error) return { text: `✗ apply failed (r${loops})`, color: RED, title: `Runner reported: ${t.review_error}` };
  if (t.review_action === 'apply') return { text: `⏳ queued (r${loops})`, color: AMBER, title: 'Uploaded — waiting for the runner to apply it to TestRail' };
  if (t.review_applied_loop != null && t.review_applied_loop >= loops && t.review_applied_on)
    return { text: `✓ applied (r${loops}) · ${rel(t.review_applied_on)}`, color: GREEN, title: `Applied to TestRail on ${new Date(t.review_applied_on).toLocaleString()}` };
  return { text: `r${loops} uploaded`, color: AMBER, title: 'Reviewed Excel uploaded; apply not yet confirmed (no runner callback recorded)' };
}

const CASE_REASON = { initial: 'created', review: 'review comments', regen: 'RN / scope change',
  rn: 'release note', scope: 'scope change', manual: 'manual' };

// Test-case count history: initial → current with the cause of each add/remove. Regeneration rows
// can be relabelled to 'release note' or 'scope change'.
function CaseHistory({ ticket, onRelabel }) {
  const log = ticket.case_log || [];
  const sm = ticket.case_summary;
  if (!sm) return null;
  const GREEN = 'var(--accent-green, #22c55e)', RED = 'var(--accent-red, #ef4444)', MUTED = 'var(--text-muted, #94a3b8)';
  const selSty = { fontSize: '0.7rem', padding: '1px 5px', borderRadius: 6, background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border-color, #334155)', color: 'var(--text-secondary, #cbd5e1)', cursor: 'pointer' };
  return (
    <div style={{ padding: '8px 0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.66rem', color: MUTED, textTransform: 'uppercase' }}>Test cases</span>
        <span style={{ fontWeight: 700 }}>{sm.initial} → {sm.current}</span>
        {sm.added > 0 && <span style={{ color: GREEN, fontSize: '0.78rem' }}>+{sm.added} added</span>}
        {sm.removed > 0 && <span style={{ color: RED, fontSize: '0.78rem' }}>−{sm.removed} removed</span>}
        {sm.changes === 0 && <span style={{ color: MUTED, fontSize: '0.74rem' }}>no change since initial</span>}
      </div>
      {log.length > 1 && (
        <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
          {log.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.74rem' }}>
              <span style={{ minWidth: 30, fontWeight: 700, textAlign: 'right' }}>{r.total}</span>
              <span style={{ minWidth: 40, color: r.delta > 0 ? GREEN : r.delta < 0 ? RED : MUTED }}>
                {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `${r.delta}` : '—'}</span>
              {r.reason === 'regen' && onRelabel
                ? <select value="regen" style={selSty} onChange={e => onRelabel(ticket.ticket_id, r.id, e.target.value)}>
                    <option value="regen">RN / scope change</option>
                    <option value="rn">→ release note</option>
                    <option value="scope">→ scope change</option>
                  </select>
                : <span style={{ color: 'var(--text-secondary)' }}>{CASE_REASON[r.reason] || r.reason}{r.loop ? ` · r${r.loop}` : ''}</span>}
              <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: MUTED }}>{(r.recorded_on || '').slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared status strip — test-plan / review / PR (+ optional refix badge). Reads the same fields
// from a ticket whether it's the lookup payload or a queue row. Used by the lookup card and the
// expandable table rows.
function TicketStatusStrip({ t, showRefix = false }) {
  if (!t) return null;
  const GREEN = 'var(--accent-green, #22c55e)', AMBER = 'var(--accent-amber, #f59e0b)', BLUE = 'var(--accent-blue, #3b82f6)', RED = 'var(--accent-red, #ef4444)', MUTED = 'var(--text-muted, #94a3b8)';
  const isRefix = t.is_retesting || (t.retest_cycle_count || 0) > 0;
  const planChip = () => {
    // Prefer the unique case count (manual+automated) when available — matches the downloaded Excel;
    // fall back to test_cases (config-summed) for rows that don't carry the split.
    const planCount = (t.test_cases_manual != null)
      ? ((t.test_cases_manual || 0) + (t.test_cases_automated || 0))
      : (t.test_cases || 0);
    if (t.has_test_plan) return (
      <span onClick={e => { e.stopPropagation(); downloadTestPlanExcel(t.ticket_id); }} style={{ cursor: 'pointer' }} title="Download test plan (Excel)">
        {lkChip(<>✓ {planCount} cases ⬇</>, GREEN, 'rgba(34,197,94,0.13)')}
      </span>
    );
    const g = t.test_plan_request;
    if (g === 'generating') return lkChip('⏳ Generating', BLUE, 'rgba(59,130,246,0.13)', 'Test plan generating');
    if (g === 'pending') return lkChip('🕓 Queued', AMBER, 'rgba(245,158,11,0.13)', 'Queued for generation');
    if (g === 'error') return lkChip('⚠ Gen error', RED, 'rgba(239,68,68,0.13)', 'Generation failed');
    if (t.pr_status === 'pre_release') return lkChip('⚠ Waiting on PR', AMBER, 'rgba(245,158,11,0.10)', 'No PR/release note yet');
    return lkChip('No plan', MUTED, 'rgba(148,163,184,0.13)', 'No test plan yet');
  };
  const reviewChip = () => {
    if (!t.review_status) return null;
    const c = t.review_status === 'Reviewed' ? GREEN : t.review_status === 'Obsolete' ? MUTED : AMBER;
    const ap = reviewApplyState(t);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {lkChip(<><span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} /> {t.review_status}</>, c, 'rgba(148,163,184,0.10)', 'Test-case review status (manual)')}
        {ap && lkChip(ap.text, ap.color, 'rgba(148,163,184,0.10)', ap.title)}
      </span>
    );
  };
  const prChip = () => {
    if (t.pr_status === 'ready') return lkChip('✓ PR / release note', GREEN, 'rgba(34,197,94,0.10)', 'PR / release note present');
    if (t.pr_status === 'pre_release') return lkChip('⚠ Pre-release (no PR)', AMBER, 'rgba(245,158,11,0.10)', 'No PR / release note yet');
    return null;
  };
  const docChip = () => {
    const f = t.doc_confidence;
    if (!f || f === 'UNKNOWN' || f === 'ALIGNED') return null;  // only surface risk
    const DOC = {
      THIN_RN:     ['📝 Thin release note', RED,   'rgba(239,68,68,0.13)',  'PR changed functional areas the release note never mentions (>30%). PR-delta cases needed.'],
      NO_PR_NO_RN: ['🚩 No PR / release note', RED, 'rgba(239,68,68,0.13)',  'No PR link and no release note — nothing to verify the build against.'],
      RN_NO_PR:    ['⚠ RN, no PR link', AMBER, 'rgba(245,158,11,0.10)', 'Release note present but no extractable PR link.'],
      PR_NO_RN:    ['⚠ PR, no release note', AMBER, 'rgba(245,158,11,0.10)', 'PR present but no release note.'],
      RN_REVIEW:   ['🔍 RN incomplete', AMBER, 'rgba(245,158,11,0.10)', 'Release note omits ≥1 functional PR file. Review the PR delta.'],
    }[f];
    if (!DOC) return null;
    const n = (t.doc_unexplained || []).length;
    const [label, color, bg, tip] = DOC;
    return lkChip(<>{label}{n ? ` · ${n}` : ''}</>, color, bg, tip);
  };
  const caseChip = () => {
    const sm = t.case_summary;
    if (!sm || !sm.changes) return null;  // only surface when cases were added/removed
    return lkChip(<>TC {sm.initial}→{sm.current}{sm.added ? ` +${sm.added}` : ''}{sm.removed ? ` −${sm.removed}` : ''}</>,
      (sm.added || sm.removed) ? AMBER : GREEN, 'rgba(148,163,184,0.10)',
      `Test cases: started ${sm.initial}, now ${sm.current} (+${sm.added} / −${sm.removed} over ${sm.changes} change(s))`);
  };
  const Lbl = ({ children }) => <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{children}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {showRefix && isRefix && lkChip(<>⟳ Refix{t.retest_cycle_count > 0 ? ` · r${t.retest_cycle_count}` : ''}</>, AMBER, 'rgba(245,158,11,0.15)', 'Returned to QC after a fail — retest')}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Lbl>Test plan</Lbl>{planChip()}
        {t.testrail_plan_url && <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>TR↗</a>}
        {t.has_test_plan && <button type="button" onClick={e => { e.stopPropagation(); detachPlanExcel(t.ticket_id); }}
          title="Remove the Excel attachment from this ticket's TestRail plan (cleanup)"
          style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 7, cursor: 'pointer', color: 'var(--text-secondary, #cbd5e1)', background: 'transparent', border: '1px solid var(--border-color, #334155)' }}>✕ Excel from plan</button>}
      </span>
      {(t.test_cases_manual != null || t.test_cases_automated != null) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Cases in the run by execution method">
          {lkChip(<>✋ {t.test_cases_manual || 0} manual</>, 'var(--accent-blue, #3b82f6)', 'rgba(59,130,246,0.12)')}
          {lkChip(<>🤖 {t.test_cases_automated || 0} automated</>, 'var(--accent-purple, #a855f7)', 'rgba(168,85,247,0.12)')}
        </span>
      )}
      {caseChip() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Lbl>Cases</Lbl>{caseChip()}</span>}
      {reviewChip() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Lbl>Review</Lbl>{reviewChip()}</span>}
      {prChip() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Lbl>PR</Lbl>{prChip()}</span>}
      {docChip() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Lbl>Docs</Lbl>{docChip()}</span>}
    </div>
  );
}

function TicketLookupCard({ result, error, onClose, reviewState, setReviewStatus, uploadReviewed, relabelCaseReason }) {
  const [showFlow, setShowFlow] = useState(true);
  const fmt = (s) => (s ? new Date(s).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '–');
  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{value ?? '–'}</span>
    </div>
  );
  const AMBER = 'var(--accent-amber, #f59e0b)';
  const isRefix = result && (result.is_retesting || (result.retest_cycle_count || 0) > 0);

  return (
    <div className="qcq-section" style={{ margin: '12px 0', padding: '16px 18px', borderLeft: '3px solid var(--accent-teal, #14b8a6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: error ? 0 : 12 }}>
        <strong style={{ fontSize: '0.95rem' }}>Ticket lookup</strong>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>✕ Close</button>
      </div>
      {error ? (
        <div style={{ color: 'var(--accent-red, #ef4444)', fontSize: '0.88rem' }}>{error}</div>
      ) : result ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>#{result.ticket_id}</span>
            <span className="qcq-status-badge" style={{ padding: '3px 10px', borderRadius: 12, background: 'var(--accent-teal-soft, rgba(20,184,166,0.15))',
              color: 'var(--accent-teal, #14b8a6)', fontSize: '0.78rem', fontWeight: 700 }}>{result.status || 'Unknown'}</span>
            {isRefix && lkChip(<>⟳ Refix{result.retest_cycle_count > 0 ? ` · r${result.retest_cycle_count}` : ''}</>, AMBER, 'rgba(245,158,11,0.15)', 'Returned to QC after a fail — retest')}
            {result.complexity && <ComplexityBadge level={result.complexity} overridden={result.complexity_overridden}
              title={(result.complexity_escalations && result.complexity_escalations.length) ? result.complexity_escalations.join(' · ') : (result.complexity_rationale || `Complexity ${result.complexity}`)} />}
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1, minWidth: 200 }}>{result.title}</span>
            <a href={`${PM_TICKET_URL}${result.ticket_id}`} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm btn-primary" style={{ textDecoration: 'none' }}>Open in PM ↗</a>
          </div>

          {/* Status strip — test plan / generation / review / PR at a glance */}
          <div style={{ padding: '10px 0', marginBottom: 6, borderTop: '1px solid var(--border-color, #334155)', borderBottom: '1px solid var(--border-color, #334155)' }}>
            <TicketStatusStrip t={result} />
          </div>

          {/* Test-case review: status + reviewed-Excel upload (same control as the queue rows, so a
              ticket found via search can be reviewed without locating it in the list). */}
          {result.has_test_plan && setReviewStatus && (() => {
            const rs = (reviewState && reviewState[result.ticket_id]) || {};
            const status = rs.review_status || result.review_status || 'Draft';
            const loops = rs.review_loops ?? result.review_loops ?? 0;
            const action = rs.review_action ?? result.review_action;
            const dot = status === 'Reviewed' ? 'var(--accent-green, #22c55e)' : status === 'Obsolete' ? 'var(--text-muted, #94a3b8)' : 'var(--accent-amber, #f59e0b)';
            const ap = reviewApplyState({ ...result, review_status: status, review_loops: loops, review_action: action });
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0 2px' }}>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Test-case review</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <select value={status} disabled={rs.busy} onChange={e => setReviewStatus(result.ticket_id, e.target.value)}
                    style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 6px', borderRadius: 7, cursor: 'pointer',
                      color: dot, background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border-color, #334155)' }}
                    title="Test-case review status (syncs to TestRail)">
                    <option value="Draft">Draft</option>
                    <option value="Reviewed">Reviewed</option>
                    <option value="Obsolete">Obsolete</option>
                  </select>
                </span>
                <label title="Upload reviewed Excel — comments applied to TestRail (repeatable)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', fontWeight: 600, padding: '4px 10px', borderRadius: 7,
                    cursor: 'pointer', color: 'var(--text-secondary, #cbd5e1)', border: '1px solid var(--border-color, #334155)', background: 'transparent' }}>
                  ⬆ Upload reviewed Excel{loops > 0 ? ` · r${loops}` : ''}
                  <input type="file" accept=".xlsx" style={{ display: 'none' }}
                    onChange={e => { uploadReviewed(result.ticket_id, e.target.files[0]); e.target.value = ''; }} />
                </label>
                {ap && <span title={ap.title} style={{ fontSize: '0.72rem', fontWeight: 700, color: ap.color, cursor: 'help' }}>{ap.text}</span>}
                {action === 'sync_status' && <span title="Syncing review status to TestRail" style={{ fontSize: '0.7rem' }}>⏳</span>}
              </div>
            );
          })()}
          {!result.has_test_plan && (
            <div style={{ padding: '8px 0 2px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              No test plan yet — the reviewed-Excel upload appears once a test plan exists for this ticket.
            </div>
          )}
          {result.case_summary && (
            <div style={{ borderTop: '1px solid var(--border-color, #334155)', marginTop: 6 }}>
              <CaseHistory ticket={result} onRelabel={relabelCaseReason} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginTop: 12 }}>
            <Row label="Priority" value={result.priority} />
            <Row label="Complexity" value={result.complexity ? `${result.complexity}${result.complexity_score != null ? ` (${result.complexity_score}/100)` : ''}` : '–'} />
            <Row label="Module" value={result.module} />
            <Row label="QC Tester" value={result.qc_tester} />
            <Row label="Backend Dev" value={result.backend_developer} />
            <Row label="Frontend Dev" value={result.frontend_developer} />
            <Row label="Current Assignee" value={result.current_assignee} />
            <Row label="Created" value={fmt(result.created_on)} />
            <Row label="ETA" value={fmt(result.eta)} />
            <Row label="Closed" value={fmt(result.closed_on)} />
            <Row label="No action for" value={result.days_since_last_action != null ? `${result.days_since_last_action} day(s)` : '–'} />
            <Row label="QA Est / Actual" value={`${result.qa_estimate_hours ?? '–'} / ${result.qa_actual_hours ?? '–'} h`} />
            <Row label="Dev Est / Actual" value={`${result.dev_estimate_hours ?? '–'} / ${result.dev_actual_hours ?? '–'} h`} />
            <Row label="Bugs (open / total)" value={`${result.bugs_open} open · ${result.bugs_total} total`} />
            {result.test_cases != null && (
              <Row label="Test cases (P/F)" value={`${result.test_cases} cases · ${result.test_passed ?? 0}P / ${result.test_failed ?? 0}F`} />
            )}
          </div>

          {/* Status flow — reuses the Ticket Speed "Ticket Flow" visual */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color, #334155)', paddingTop: 10 }}>
            <button className="btn btn-sm btn-secondary" style={{ marginBottom: showFlow ? 8 : 0 }} onClick={() => setShowFlow(s => !s)}>
              {showFlow ? '▾' : '▸'} Status flow
            </button>
            {showFlow && <TicketFlow ticketId={result.ticket_id} />}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function QCQueueDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState(null);
  const [qcFailed, setQcFailed] = useState(null);
  const [bisTesting, setBisTesting] = useState(null);
  const [approvedForLive, setApprovedForLive] = useState(null);
  const [noQaEstimate, setNoQaEstimate] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState(null);
    const [cardFilter, setCardFilter] = useState(null); // null or 'unassigned'|'assigned_not_started'|'in_progress'|'on_hold'|'qc_failed'
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [estimatePopup, setEstimatePopup] = useState(null);   // ticket object for the QA-estimate modal
  const [searchFilter, setSearchFilter] = useState('');
  const [listPriorityFilter, setListPriorityFilter] = useState('');
  const [listModuleFilter, setListModuleFilter] = useState('');
  const [listTesterFilter, setListTesterFilter] = useState('');
  const [listDeveloperFilter, setListDeveloperFilter] = useState(''); // '', a developer name, or 'Not Assigned'
  const [listPlanFilter, setListPlanFilter] = useState(''); // '', 'created', 'pending'
  const [listPrFilter, setListPrFilter] = useState(''); // '', 'ready', 'pre_release'
  const [listDocFilter, setListDocFilter] = useState(''); // '', 'weak' (NO_PR_NO_RN/THIN_RN/...), 'thin'
  const [cxLevelFilter, setCxLevelFilter] = useState(''); // '', 'High', 'Medium', 'Low'
  const [ageingDays, setAgeingDays] = useState(0); // 0 = off; else min days with no status change
  const [queuedPlans, setQueuedPlans] = useState({}); // ticket_id -> status, for immediate Generate feedback
  const [cxState, setCxState] = useState({}); // ticket_id -> {level, score, factors, escalations, rationale, mode, overridden, busy}
  const [cxWarming, setCxWarming] = useState(false);

  // Effective complexity for a ticket = optimistic local state, else the server-attached fields.
  const cxOf = (t) => {
    const s = cxState[t.ticket_id] || {};
    return {
      level: s.level ?? t.complexity,
      score: s.score ?? t.complexity_score,
      factors: s.factors ?? t.complexity_factors,
      escalations: s.escalations ?? t.complexity_escalations,
      rationale: s.rationale ?? t.complexity_rationale,
      mode: s.mode ?? t.complexity_mode,
      overridden: s.overridden ?? t.complexity_overridden,
      busy: s.busy,
    };
  };

  const refreshComplexity = async (ticketId) => {
    setCxState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: true } }));
    try {
      const res = await fetch(`${API_BASE}/live/complexity/${ticketId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ use_llm: true }) });
      const d = await res.json();
      setCxState(p => ({ ...p, [ticketId]: { level: d.level, score: d.score, factors: d.factors,
        escalations: d.escalations, rationale: d.rationale, mode: d.engine_mode, overridden: !!d.complexity_overridden, busy: false } }));
    } catch {
      setCxState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: false } }));
    }
  };

  const overrideComplexity = async (ticketId, level, note) => {
    setCxState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: true } }));
    try {
      if (!level) { // clear override → fall back to computed
        await fetch(`${API_BASE}/live/complexity/${ticketId}/override`, { method: 'DELETE' });
        await refreshComplexity(ticketId);
        return;
      }
      await fetch(`${API_BASE}/live/complexity/${ticketId}/override`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, note: note || null }) });
      setCxState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), level, overridden: true, busy: false } }));
    } catch {
      setCxState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: false } }));
    }
  };

  const warmComplexity = async () => {
    setCxWarming(true);
    try {
      await fetch(`${API_BASE}/live/complexity/warm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ use_llm: true, background: true, limit: 80 }) });
    } catch { /* ignore */ }
    setTimeout(() => setCxWarming(false), 4000);
  };

  const generateTestPlan = async (ticketId) => {
    setQueuedPlans(p => ({ ...p, [ticketId]: 'pending' }));
    try {
      const res = await fetch(`${API_BASE}/live/test-plan-queue/${ticketId}`, { method: 'POST' });
      if (!res.ok) throw new Error('enqueue failed');
      const d = await res.json();
      setQueuedPlans(p => ({ ...p, [ticketId]: d.status || 'pending' }));
    } catch {
      setQueuedPlans(p => ({ ...p, [ticketId]: 'error' }));
    }
  };

  const downloadExcel = async (ticketId) => {
    try {
      const res = await fetch(`${API_BASE}/live/test-plan-excel/${ticketId}`);
      if (!res.ok) throw new Error('no excel');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TestPlan_${ticketId}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_BASE}/live/test-plan-excel/${ticketId}`, '_blank');
    }
  };

  // Review loop: status dropdown (Draft/Reviewed/Obsolete) + reviewed-Excel upload (per ticket)
  const [reviewState, setReviewState] = useState({}); // ticket_id -> {review_status, review_loops, review_action, busy}

  const setReviewStatus = async (ticketId, status) => {
    setReviewState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), review_status: status, busy: true } }));
    try {
      const res = await fetch(`${API_BASE}/live/test-plan-queue/${ticketId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: status, review_action: 'sync_status' }) });
      const d = await res.json();
      setReviewState(p => ({ ...p, [ticketId]: { review_status: d.review_status, review_loops: d.review_loops, review_action: d.review_action, busy: false } }));
    } catch {
      setReviewState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: false } }));
    }
  };

  const uploadReviewed = async (ticketId, file) => {
    if (!file) return;
    setReviewState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: true } }));
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`${API_BASE}/live/test-plan-queue/${ticketId}/review-upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
      const d = await res.json();
      setReviewState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), review_loops: d.review_loop, review_action: 'apply', busy: false } }));
    } catch {
      setReviewState(p => ({ ...p, [ticketId]: { ...(p[ticketId] || {}), busy: false } }));
    }
  };
  const [platformFilter, setPlatformFilter] = useState('all'); // 'all', 'Web', 'Mobile'
  // Global ticket lookup (any status, anywhere in the app)
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const relabelCaseReason = async (ticketId, logId, reason) => {
    try {
      const res = await fetch(`${API_BASE}/live/test-plan-queue/${ticketId}/case-log/${logId}/reason`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      if (res.ok) {
        const d = await res.json();
        setLookupResult(prev => prev && prev.ticket_id === ticketId
          ? { ...prev, case_log: d.case_log, case_summary: d.case_summary } : prev);
        try { await fetchAll(true); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };

  const lookupTicket = async () => {
    const id = String(lookupId).trim().replace(/^#/, '');
    if (!id) return;
    setLookupLoading(true); setLookupError(''); setLookupResult(null);
    try {
      const res = await fetch(`${API_BASE}/live/ticket-lookup?ticket_id=${encodeURIComponent(id)}`);
      if (res.status === 404) { setLookupError(`Ticket ${id} not found in the app.`); return; }
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `Lookup failed (${res.status})`); }
      setLookupResult(await res.json());
    } catch (e) {
      setLookupError(e?.message || 'Lookup failed');
    } finally {
      setLookupLoading(false);
    }
  };
  const [sortField, setSortField] = useState('days_in_qc'); // plain queue ordering (longest-waiting first)
  const [sortDir, setSortDir] = useState('desc');
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' or 'module_workload'
  const [moduleWorkload, setModuleWorkload] = useState([]);
  const [modulePipeline, setModulePipeline] = useState([]);
  const [selectedModuleBar, setSelectedModuleBar] = useState(null); // {module, status} for clicked bar segment
  const [pipelineDetail, setPipelineDetail] = useState(null); // stage id for expanded detail
  const [selectedPipelineBar, setSelectedPipelineBar] = useState(null); // {module, type} for clicked pipeline bar
  const moduleListRef = useRef(null);
  const pipelineListRef = useRef(null);

  const exportToExcel = async (tickets, filename) => {
    if (!tickets || tickets.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/live/export-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets, filename }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || `${filename}.xlsx`).replace(/"/g, '');
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const safeFetch = async (url) => {
    try {
      return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`);
    } catch (err) {
      console.error(`[QCQueue] Failed to fetch ${url}:`, err.message);
      return null;
    }
  };

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const queueRes = await safeFetch('/live/qc-queue');
      if (queueRes?.ok) {
        const data = await queueRes.json();
        setQueue(data);
        // Reconcile optimistic review state with server truth: once the runner finishes an
        // apply/sync, the server reports review_action=null — clear our local flag so the ⏳ stops.
        const qsec = data.queue;
        const qts = Array.isArray(qsec) ? qsec : (qsec?.tickets || []);
        setReviewState(prev => {
          let changed = false;
          const next = { ...prev };
          qts.forEach(t => {
            const local = next[t.ticket_id];
            if (local && local.review_action && !t.review_action) {
              next[t.ticket_id] = { ...local, review_action: undefined, busy: false };
              changed = true;
            }
          });
          return changed ? next : prev;
        });
        // QC failed is included in the live response
        if (data.qc_failed) setQcFailed(data.qc_failed);
        if (data.bis_testing) setBisTesting(data.bis_testing);
        if (data.approved_for_live) setApprovedForLive(data.approved_for_live);
        if (data.no_qa_estimate) setNoQaEstimate(data.no_qa_estimate);
        if (data.monthly_summary) setMonthlySummary(data.monthly_summary);
        if (data.module_workload) setModuleWorkload(data.module_workload);
        if (data.module_pipeline) setModulePipeline(data.module_pipeline);
      }
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Warm the Documentation-Confidence cache for the queue once on load. DEEP so the real flags
  // (THIN_RN vs ALIGNED) are computed — a shallow pass can't tell them apart and must not run here.
  // background=true returns immediately and computes in a server thread; results appear on the next
  // silent refresh. Already-fresh deep entries are skipped, so steady-state cost is near zero.
  useEffect(() => {
    fetch(`${API_BASE}/live/doc-confidence/warm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deep: true, background: true, limit: 80 }),
    }).catch(() => {});
  }, []);

  // Silent auto-refresh so test-plan generation status (Queued → Generating → ✓) updates on its
  // own without a manual reload. Pauses while the tab is hidden. ~15s.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) fetchAll(true);
    }, 15000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const [syncing, setSyncing] = useState(false);
  const forceRefresh = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
      setCardFilter(null); setSelectedModuleBar(null); setSelectedPipelineBar(null);
      setSearchFilter(''); setListPriorityFilter(''); setListModuleFilter(''); setListTesterFilter(''); setListDeveloperFilter('');
      await fetchAll();
    } finally { setSyncing(false); }
  };

  const toggleExpand = (ticketId) => {
    if (expandedTicket === ticketId) {
      setExpandedTicket(null);
    } else {
      setExpandedTicket(ticketId);
    }
  };

  const filterTickets = (tickets) => {
    if (!searchFilter) return tickets;
    const s = searchFilter.toLowerCase();
    return tickets.filter(t =>
      String(t.ticket_id).includes(s) ||
      (t.title || '').toLowerCase().includes(s) ||
      (t.qc_tester || '').toLowerCase().includes(s) ||
      (t.module || '').toLowerCase().includes(s) ||
      (t.priority || '').toLowerCase().includes(s)
    );
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading QC Queue...</p></div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="error-container"><p>{error}</p><button onClick={fetchAll} className="btn btn-primary">Retry</button></div>
        </main>
      </div>
    );
  }

  const statusCards = queue?.status_cards || {};
  const rawQueue = queue?.queue || [];
  const rawDevTested = queue?.dev_tested || [];
  const rawQcFailed = qcFailed?.tickets || [];
  const rawBisTesting = bisTesting?.tickets || [];
  const rawApprovedForLive = approvedForLive?.tickets || [];
  const rawNoEstimate = noQaEstimate?.tickets || [];

  // Platform filter applied to all data
  const pf = (tickets) => platformFilter === 'all' ? tickets : tickets.filter(t => (t.platform || 'Web') === platformFilter);
  const allQueue = pf(rawQueue);
  const allDevTested = pf(rawDevTested);
  const qcFailedTickets = pf(rawQcFailed);
  const qcFailedCount = qcFailedTickets.length;
  const bisTestingTickets = pf(rawBisTesting);
  const approvedTickets = pf(rawApprovedForLive);
  const noEstimateTickets = pf(rawNoEstimate);

  // Web/Mobile counts for display
  const webCount = rawQueue.filter(t => (t.platform || 'Web') === 'Web').length;
  const mobileCount = rawQueue.filter(t => (t.platform || 'Web') === 'Mobile').length;

  // Computed breakdowns — a clean, NON-OVERLAPPING partition of the waiting ('QC Testing') tickets
  // (In Progress / Hold have their own cards). Assignment decides the bucket; only the *unassigned*
  // tickets split by new-vs-refix, so the three cards sum exactly to the waiting count:
  //   First-time (new, no tester) + Retest-needs-tester (refix, no tester) + Assigned (has tester).
  // Refix/retest = a GENUINE re-entry (failed QC, went back to dev, returned), from the QC cycle
  // tracker only. NOTE: we deliberately do NOT use qa_actual_hours>0 — that just means "QA logged
  // time" (true of almost any ticket being tested) and produced ~34 false-positive refixes.
  const isRetest = (t) => !!(t.is_retesting || (t.retest_cycle_count || 0) > 0);
  // Statuses where a ticket has bounced back to dev — PM then shows the current assignee (the fixer),
  // not the original developer. Surface that inline so "Developer" matches what PM displays.
  const REFIX_DEV_STATUSES = ['QC Review Fail', 'Code Review Failed', 'Re-opened', 'Tested - Awaiting Fixes'];
  const devCell = (t) => {
    const dev = t.developers_str || '-';
    const back = (REFIX_DEV_STATUSES.includes(t.status) && t.current_assignee && t.current_assignee !== t.developers_str)
      ? t.current_assignee : null;
    return (<span style={{ whiteSpace: 'nowrap' }}>{dev}{back && (
      <span title={`Bounced back to dev (${t.status}) — now with ${back}. Original developer: ${t.developers_str || '?'}`}
            style={{ color: '#f59e0b', fontWeight: 600 }}> ↩ {back}</span>
    )}</span>);
  };
  const unassignedTickets = allQueue.filter(t => t.status === 'QC Testing' && !t.qc_tester);
  const firstTimeTickets = allQueue.filter(t => t.status === 'QC Testing' && !t.qc_tester && !isRetest(t));
  const retestingTickets = allQueue.filter(t => t.status === 'QC Testing' && !t.qc_tester && isRetest(t));
  const assignedNotStarted = allQueue.filter(t => t.status === 'QC Testing' && t.qc_tester);
  const inProgressTickets = allQueue.filter(t => t.status === 'QC Testing in Progress');
  const onHoldTickets = allQueue.filter(t => t.status === 'QC Testing Hold');

  // Get the visible list based on card filter
  const getCardFilteredList = () => {
    if (!cardFilter) return null;
    switch (cardFilter) {
      case 'unassigned': return unassignedTickets;
      case 'first_time': return firstTimeTickets;
      case 'retesting': return retestingTickets;
      case 'assigned_not_started': return assignedNotStarted;
      case 'in_progress': return inProgressTickets;
      case 'on_hold': return onHoldTickets;
      case 'qc_failed': return qcFailedTickets;
      case 'bis_testing': return bisTestingTickets;
      case 'approved_for_live': return approvedTickets;
      case 'no_qa_estimate': return noEstimateTickets;
      default: return null;
    }
  };

  const cardFilteredList = getCardFilteredList();
  const cardFilterLabels = {
    unassigned: 'QA Unassigned',
    first_time: 'First-time QC — new, needs test plan',
    retesting: 'Retest — needs tester (cases ready)',
    assigned_not_started: 'Assigned, Not Started (new + refix)',
    in_progress: 'QC Testing in Progress',
    on_hold: 'QC Testing Hold',
    qc_failed: 'QC Review Failed',
    bis_testing: 'BIS Testing',
    approved_for_live: 'Approved for Live',
    no_qa_estimate: 'No QA Estimate (Need Planning)',
  };

  // Apply search + dropdown filters to ticket lists
  const applyFilters = (tickets) => {
    let result = tickets;
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      result = result.filter(t =>
        String(t.ticket_id).includes(s) ||
        (t.title || '').toLowerCase().includes(s) ||
        (t.qc_tester || '').toLowerCase().includes(s) ||
        (t.developers_str || '').toLowerCase().includes(s) ||
        (t.module || '').toLowerCase().includes(s) ||
        (t.priority || '').toLowerCase().includes(s)
      );
    }
    if (listPriorityFilter) {
      result = result.filter(t => t.priority === listPriorityFilter);
    }
    if (listModuleFilter) {
      result = result.filter(t => t.module === listModuleFilter);
    }
    if (listTesterFilter) {
      result = result.filter(t => listTesterFilter === 'Unassigned' ? !t.qc_tester : (t.qc_tester || '') === listTesterFilter);
    }
    if (listDeveloperFilter) {
      result = result.filter(t => {
        const raw = (t.developers_str || '').trim();
        if (listDeveloperFilter === 'Not Assigned') return !raw || raw === 'Not Assigned';
        return raw.split(',').map(x => x.trim()).includes(listDeveloperFilter);
      });
    }
    if (listPlanFilter === 'created') {
      result = result.filter(t => t.has_test_plan);
    } else if (listPlanFilter === 'pending') {
      result = result.filter(t => !t.has_test_plan);
    }
    if (listPrFilter) {
      // PR presence — prefer the runner's pr_status; fall back to the doc-confidence reconciliation,
      // which reliably knows whether a PR exists even when the runner hasn't stamped the ticket.
      const hasPR = (t) => t.pr_status === 'ready' || t.doc_pr_present === true
        || ['THIN_RN', 'RN_REVIEW', 'ALIGNED', 'PR_NO_RN'].includes(t.doc_confidence);
      const noPR = (t) => t.pr_status === 'pre_release' || t.doc_pr_present === false
        || ['NO_PR_NO_RN', 'RN_NO_PR'].includes(t.doc_confidence);
      result = result.filter(listPrFilter === 'ready' ? hasPR : noPR);
    }
    if (listDocFilter === 'weak') {
      // Aggregate: anything flagged risky by the Scope/Release-Note/PR reconciliation.
      result = result.filter(t => ['NO_PR_NO_RN', 'THIN_RN', 'RN_REVIEW', 'PR_NO_RN', 'RN_NO_PR'].includes(t.doc_confidence));
    } else if (listDocFilter) {
      // A specific documentation-confidence flag (exact match).
      result = result.filter(t => t.doc_confidence === listDocFilter);
    }
    if (ageingDays) {
      // "No action" = days since the ticket's last status change (falls back to QC dwell server-side).
      result = result.filter(t => (t.days_since_last_action ?? t.days_in_qc ?? 0) >= ageingDays);
    }
    if (cxLevelFilter) {
      result = result.filter(t => (t.complexity || '') === cxLevelFilter);
    }
    return result;
  };

  const queueList = applyFilters(filterTickets(allQueue));
  const devTested = applyFilters(filterTickets(allDevTested));

  // Unique values for filter dropdowns
  const allTicketsForFilters = [...allQueue, ...allDevTested];
  const uniquePriorities = [...new Set(allTicketsForFilters.map(t => t.priority).filter(Boolean))].sort();
  const uniqueModules = [...new Set(allTicketsForFilters.map(t => t.module).filter(Boolean))].sort();
  const uniqueTesters = [...new Set(allTicketsForFilters.map(t => t.qc_tester).filter(Boolean))].sort();
  const uniqueDevelopers = [...new Set(allTicketsForFilters
    .flatMap(t => (t.developers_str || '').split(','))
    .map(x => x.trim())
    .filter(d => d && d !== 'Not Assigned'))].sort();

  const handleCardClick = (filter) => {
    if (cardFilter === filter) {
      setCardFilter(null);
    } else {
      setCardFilter(filter);
    }
  };

  // Sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortTickets = (tickets) => {
    return [...tickets].sort((a, b) => {
      let aVal = a[sortField] ?? '';
      let bVal = b[sortField] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const SortHeader = ({ field, children }) => (
    <th className="qcq-sortable-th" onClick={() => handleSort(field)}>
      {children}
      {sortField === field && <span className="qcq-sort-arrow">{sortDir === 'desc' ? ' \u25BC' : ' \u25B2'}</span>}
    </th>
  );

  const COL_COUNT = 23;

  const exportQueueCSV = (rows, label) => {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['Ticket', 'Title', 'Status', 'Priority', 'Complexity', 'Platform', 'QC Tester', 'Developer', 'Planning', 'Planner',
      'Module', 'Days in QC', 'Days No Action', 'Activity', 'Retest Cycles', 'QA Est', 'QA Actual', 'Test Plan', 'Test Cases',
      'TC Initial', 'TC Current', 'TC Added', 'TC Removed',
      'PR / Release Note', 'Bugs Total', 'Bugs Open', 'Bugs Closed', 'Released to QA', 'Current Assignee', 'ETA'];
    const prText = (t) => t.pr_status === 'pre_release' ? 'No PR / release note' : t.pr_status === 'ready' ? 'Has PR' : '';
    const lines = [headers.join(',')];
    rows.forEach(t => {
      const planning = t.qc_tester ? 'Assigned' : (t.planning_status === 'in_planning' ? 'Plan Initiated' : 'Unplanned');
      lines.push([t.ticket_id, t.title, t.status, t.priority, cxOf(t).level || '', t.platform || 'Web', t.qc_tester || '', t.developers_str || '', planning,
        t.planner || '', t.module, t.days_in_qc, t.days_since_last_action ?? '', t.activity_label, t.retest_cycle_count || 0,
        t.qa_estimate_hours || 0, t.qa_actual_hours || 0, t.has_test_plan ? 'Created' : 'No plan', t.test_cases || 0,
        t.case_summary?.initial ?? '', t.case_summary?.current ?? '', t.case_summary?.added ?? '', t.case_summary?.removed ?? '',
        prText(t), t.bugs_total || 0, t.bugs_open || 0, t.bugs_closed || 0, t.bugs_released_to_qa || 0, t.current_assignee || '',
        t.eta ? new Date(t.eta).toLocaleDateString('en-US') : ''].map(esc).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qc-queue_${(label || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderQueueTable = (tickets, label) => {
    const sorted = sortTickets(tickets);
    return (
    <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginBottom: '6px' }}>
      <button className="btn btn-sm btn-secondary" onClick={warmComplexity} disabled={cxWarming}
        title="Compute/refresh complexity ratings for this queue in the background">
        {cxWarming ? 'Warming…' : '⚙ Warm complexity'}
      </button>
      <button className="btn btn-sm btn-primary" onClick={() => exportQueueCSV(sorted, label)} disabled={!sorted.length}>
        Export to Excel ({sorted.length})
      </button>
    </div>
    <div className="qcq-table-container">
      <table className="qcq-table">
        <thead>
          <tr>
            <SortHeader field="ticket_id">Ticket</SortHeader>
            <th>Title</th>
            <SortHeader field="status">Status</SortHeader>
            <th>Type</th>
            <SortHeader field="priority">Priority</SortHeader>
            <SortHeader field="complexity_score"><span title="How complex this ticket is to TEST — scope, cross-module integration, impact, testing types, test-data effort, retest history & docs">Complexity</span></SortHeader>
            <SortHeader field="platform">Platform</SortHeader>
            <SortHeader field="qc_tester">QC Tester</SortHeader>
            <SortHeader field="test_cases">Test Plan</SortHeader>
            <th>Review</th>
            <th title="Documentation confidence — ticket scope vs release note vs PR">Docs</th>
            <SortHeader field="developers_str">Developer</SortHeader>
            <SortHeader field="current_assignee">Assign To</SortHeader>
            <SortHeader field="module">Module</SortHeader>
            <SortHeader field="days_in_qc">Age</SortHeader>
            <th>Activity</th>
            <SortHeader field="retest_cycle_count">Cycles</SortHeader>
            <SortHeader field="qa_estimate_hours">Est Hrs</SortHeader>
            <SortHeader field="qa_actual_hours">Actual Hrs</SortHeader>
            <th>Pass/Fail</th>
            <SortHeader field="bugs_total">Bugs</SortHeader>
            <th>Open/Closed</th>
            <SortHeader field="bugs_released_to_qa">Released to QA</SortHeader>
            <SortHeader field="eta">ETA</SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={COL_COUNT} className="qcq-empty">No tickets in {label}</td></tr>
          ) : sorted.map(t => (
            <React.Fragment key={t.ticket_id}>
              <tr
                className={`qcq-row ${expandedTicket === t.ticket_id ? 'qcq-row-expanded' : ''}`}
                onClick={() => toggleExpand(t.ticket_id)}
              >
                <td className="qcq-ticket-id"><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>#{t.ticket_id}</a></td>
                <td className="qcq-title">
                  {t.title}
                </td>
                <td>
                  <span className={`qcq-status qcq-status-${(t.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                    {t.status}
                  </span>
                </td>
                <td style={{textAlign:'center'}}>{isRetest(t) ? <span className="qcq-fail" style={{fontSize:'0.7rem'}}>Refix</span> : <span style={{color:'var(--accent-green)',fontSize:'0.7rem',fontWeight:600}}>New</span>}</td>
                <td className="qcq-priority">{t.priority}</td>
                <td style={{ textAlign: 'center' }}>{(() => {
                  const cx = cxOf(t);
                  const tip = cx.escalations && cx.escalations.length ? cx.escalations.join(' · ')
                    : (cx.rationale || (cx.score != null ? `Complexity score ${cx.score}/100` : 'Not rated yet'));
                  return <ComplexityBadge level={cx.level} overridden={cx.overridden} title={tip} />;
                })()}</td>
                <td><span className={`qcq-platform-badge qcq-platform-${(t.platform || 'Web').toLowerCase()}`}>{t.platform || 'Web'}</span></td>
                <td>{t.qc_tester ? t.qc_tester : <span className="qcq-unassigned">Unassigned</span>}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>{(() => {
                  const chip = (label, color, bg, extra) => (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 11, fontSize: '0.72rem', fontWeight: 600, lineHeight: 1, background: bg, color, ...(extra || {}) }}>{label}</span>
                  );
                  if (t.has_test_plan || t.has_excel) {
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <span onClick={e => { e.stopPropagation(); downloadExcel(t.ticket_id); }} style={{ cursor: 'pointer' }} title="Download test plan (Excel)">
                          {chip(<>✓ {t.test_cases ? `${t.test_cases} ` : ''}⬇</>, 'var(--accent-green, #22c55e)', 'rgba(34,197,94,0.13)')}
                        </span>
                        {t.testrail_plan_url && <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="Open TestRail plan" style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 600 }}>TR↗</a>}
                      </span>
                    );
                  }
                  if ((t.status || '').startsWith('QC Testing')) {
                    const qs = queuedPlans[t.ticket_id] || t.test_plan_request;
                    if (qs === 'generating') return chip('⏳ Generating', 'var(--accent-blue, #3b82f6)', 'rgba(59,130,246,0.13)');
                    if (t.pr_status === 'pre_release') {
                      const lq = queuedPlans[t.ticket_id];
                      return (
                        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="No PR / release note yet — auto-generation stays blocked and the runner re-checks every cycle. 'Generate anyway' forces a pre-release plan now from the description (manual override).">
                          {chip('⚠ Waiting on PR', 'var(--accent-amber, #f59e0b)', 'rgba(245,158,11,0.10)')}
                          {(lq === 'pending' || lq === 'generating')
                            ? <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>forced 🕓</span>
                            : <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 9 }}
                                title="Force-generate now, overriding the PR wait (manual)"
                                onClick={e => { e.stopPropagation(); generateTestPlan(t.ticket_id); }}>Generate anyway</button>}
                        </span>
                      );
                    }
                    if (qs === 'pending') return chip('🕓 Queued', 'var(--accent-amber, #f59e0b)', 'rgba(245,158,11,0.13)');
                    if (qs === 'error') return <span onClick={e => { e.stopPropagation(); generateTestPlan(t.ticket_id); }} style={{ cursor: 'pointer' }} title="Generation failed — click to retry">{chip('⚠ Retry', 'var(--accent-red, #ef4444)', 'rgba(239,68,68,0.13)')}</span>;
                    return <button className="btn btn-sm btn-primary" style={{ fontSize: '0.68rem', padding: '3px 11px', borderRadius: 11 }}
                      title="Queue this ticket for test-plan generation" onClick={e => { e.stopPropagation(); generateTestPlan(t.ticket_id); }}>Generate</button>;
                  }
                  return <span style={{ color: 'var(--text-muted)' }}>–</span>;
                })()}{(t.has_test_plan || t.has_excel) && (
                  <button title="Generate QA estimate with Claude — activity/time split-up + PM comment (available once the test plan is created)"
                    onClick={e => { e.stopPropagation(); setEstimatePopup(t); }}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 22, borderRadius: 7, cursor: 'pointer', fontSize: '0.82rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>⏱</button>
                )}</span></td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>{t.has_test_plan ? (() => {
                  const rs = reviewState[t.ticket_id] || {};
                  const status = rs.review_status || t.review_status || 'Draft';
                  const loops = rs.review_loops ?? t.review_loops ?? 0;
                  const action = rs.review_action ?? t.review_action;
                  const dot = status === 'Reviewed' ? 'var(--accent-green, #22c55e)' : status === 'Obsolete' ? 'var(--text-muted, #94a3b8)' : 'var(--accent-amber, #f59e0b)';
                  const ap = reviewApplyState({ ...t, review_status: status, review_loops: loops, review_action: action });
                  return (
                    <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                        <select value={status} disabled={rs.busy} onChange={e => setReviewStatus(t.ticket_id, e.target.value)}
                          style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 6px', borderRadius: 7, cursor: 'pointer',
                            color: dot, background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border-color, #334155)' }}
                          title="Test-case review status (syncs to TestRail)">
                          <option value="Draft">Draft</option>
                          <option value="Reviewed">Reviewed</option>
                          <option value="Obsolete">Obsolete</option>
                        </select>
                      </span>
                      <label title="Upload reviewed Excel — comments applied to TestRail (repeatable)"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.66rem', fontWeight: 600, padding: '3px 8px', borderRadius: 7,
                          cursor: 'pointer', color: 'var(--text-secondary, #cbd5e1)', border: '1px solid var(--border-color, #334155)', background: 'transparent' }}>
                        ⬆ Review{loops > 0 ? ` · r${loops}` : ''}
                        <input type="file" accept=".xlsx" style={{ display: 'none' }}
                          onChange={e => { uploadReviewed(t.ticket_id, e.target.files[0]); e.target.value = ''; }} />
                      </label>
                      {ap && <span title={ap.title} style={{ fontSize: '0.66rem', fontWeight: 700, color: ap.color, whiteSpace: 'nowrap', cursor: 'help' }}>{ap.text}</span>}
                      {action === 'sync_status' && <span title="Syncing review status to TestRail" style={{ fontSize: '0.7rem' }}>⏳</span>}
                    </span>
                  );
                })() : <span style={{ color: 'var(--text-muted)' }}>–</span>}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{(() => {
                  const M = {
                    THIN_RN:     ['📝', 'Thin RN',  'var(--accent-red, #ef4444)',   'PR changed functional areas the release note never mentions (>30%).'],
                    NO_PR_NO_RN: ['🚩', 'No PR/RN', 'var(--accent-red, #ef4444)',   'No PR link and no release note — nothing to verify the build against.'],
                    RN_REVIEW:   ['🔍', 'RN gap',   'var(--accent-amber, #f59e0b)', 'Release note omits ≥1 functional PR file.'],
                    PR_NO_RN:    ['⚠', 'No RN',     'var(--accent-amber, #f59e0b)', 'PR present but no release note.'],
                    RN_NO_PR:    ['⚠', 'No PR',     'var(--accent-amber, #f59e0b)', 'Release note present but no PR link.'],
                    ALIGNED:     ['✓', 'Aligned',   'var(--accent-green, #22c55e)', 'Release note covers every functional file the PR changed.'],
                  }[t.doc_confidence];
                  if (!M) return <span style={{ color: 'var(--text-muted)' }}>–</span>;
                  const [icon, lbl, color, tip] = M;
                  return <span title={tip} style={{ color, fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{icon} {lbl}</span>;
                })()}</td>
                <td className="qcq-secondary">{devCell(t)}</td>
                <td className="qcq-secondary">{t.current_assignee || '-'}</td>
                <td>{t.module}</td>
                <td><AgeingBadge days={t.days_in_qc} /></td>
                <td><span className={`qcq-activity qcq-activity-${t.activity_type}`}>{t.activity_label}</span></td>
                <td>{t.retest_cycle_count > 0 ? <span className="qcq-cycle-count">{t.retest_cycle_count}</span> : '-'}</td>
                <td className="qcq-hours">{t.qa_estimate_hours || '-'}</td>
                <td className="qcq-hours">{t.qa_actual_hours || '-'}</td>
                <td>{t.test_cases > 0 ? <span><span className="qcq-pass">{t.test_passed}</span>/<span className="qcq-fail">{t.test_failed}</span></span> : '-'}</td>
                <td>{t.bugs_total > 0 ? <span className={t.bugs_open > 0 ? 'qcq-bugs-count' : ''}>{t.bugs_total}</span> : '-'}</td>
                <td>{t.bugs_total > 0 ? <span><span className={t.bugs_open > 0 ? 'qcq-fail' : ''}>{t.bugs_open}</span>/<span className="qcq-pass">{t.bugs_closed}</span></span> : '-'}</td>
                <td>{t.bugs_released_to_qa > 0 ? <span className="qcq-pass">{t.bugs_released_to_qa}</span> : '-'}</td>
                <td className="qcq-eta">{t.eta ? new Date(t.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
              </tr>
              {expandedTicket === t.ticket_id && (
                <tr className="qcq-expand-row">
                  <td colSpan={COL_COUNT}>
                    <div className="qcq-expand-content">
                      <div className="qcq-expand-section">
                        <h4>Ticket Details</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">Full Title</span> {t.title}</div>
                          <div><span className="qcq-detail-label">Platform</span> {t.platform}</div>
                          <div><span className="qcq-detail-label">Developers</span> {t.developers_str || '-'}</div>
                          <div><span className="qcq-detail-label">QC Tester</span> {t.qc_tester || 'Unassigned'}</div>
                          <div><span className="qcq-detail-label">Type</span> {t.ticket_type || '-'}</div>
                          <div><span className="qcq-detail-label">Ticket Created</span> {t.created_on ? new Date(t.created_on).toLocaleDateString() : '-'}</div>
                          <div><span className="qcq-detail-label">First Seen in Status</span> {t.moved_to_qc_on ? new Date(t.moved_to_qc_on).toLocaleDateString() : '-'}</div>
                          <div><span className="qcq-detail-label">Current Assignee</span> {t.current_assignee || '-'}</div>
                          <div><span className="qcq-detail-label">Planning</span> {t.planning_status === 'in_planning' ? `In planning — ${t.planner}` : t.planning_status === 'assigned' ? 'Assigned to tester' : t.planning_status === 'unassigned' ? 'Needs planner' : '-'}</div>
                          <div><span className="qcq-detail-label">QA Test Plan</span> {t.has_test_plan ? (t.testrail_plan_url ? <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer" className="qcq-tc-link">Created — {t.test_cases} cases</a> : `Created — ${t.test_cases} cases`) : 'Not created'}</div>
                        </div>
                      </div>
                      <div className="qcq-expand-section">
                        <h4>Hours</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">QA Estimate</span> {t.qa_estimate_hours ? `${t.qa_estimate_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">QA Actual</span> {t.qa_actual_hours ? `${t.qa_actual_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">Dev Estimate</span> {t.dev_estimate_hours ? `${t.dev_estimate_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">Dev Actual</span> {t.actual_dev_hours ? `${t.actual_dev_hours}h` : '-'}</div>
                        </div>
                      </div>
                      <div className="qcq-expand-section" style={{ flexBasis: '100%' }}>
                        {(() => {
                          const cx = cxOf(t);
                          const factors = cx.factors || {};
                          const order = ['scope', 'release_note', 'pr_breadth', 'cross_module', 'impact',
                            'testing_types', 'test_data_effort', 'retest_history', 'test_case_volume', 'effort_hours'];
                          const rows = order.filter(k => factors[k]);
                          return (
                            <>
                              <h4 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                Complexity
                                <ComplexityBadge level={cx.level} overridden={cx.overridden} />
                                {cx.score != null && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{cx.score}/100</span>}
                                {cx.mode && <span style={{ fontSize: '0.64rem', fontWeight: 600, padding: '2px 7px', borderRadius: 8,
                                  background: cx.mode === 'llm' ? 'rgba(139,92,246,0.13)' : 'var(--bg-tertiary, #0f172a)',
                                  color: cx.mode === 'llm' ? 'var(--accent-purple, #8b5cf6)' : 'var(--text-muted)' }}>
                                  {cx.mode === 'llm' ? 'AI-assessed' : 'rule-based'}</span>}
                                <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.62rem', padding: '2px 8px' }}
                                  disabled={cx.busy} onClick={e => { e.stopPropagation(); refreshComplexity(t.ticket_id); }}>
                                  {cx.busy ? '…' : '↻ Refresh'}</button>
                              </h4>
                              {cx.rationale && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{cx.rationale}</div>}
                              {cx.escalations && cx.escalations.length > 0 && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                  {cx.escalations.map((e, i) => (
                                    <span key={i} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                                      background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red, #ef4444)' }}>⚑ {e}</span>
                                  ))}
                                </div>
                              )}
                              {rows.length > 0 ? (
                                <table className="qcq-cx-table">
                                  <tbody>
                                    {rows.map(k => (
                                      <tr key={k}>
                                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap', paddingRight: 12 }}>{factors[k].label || k}</td>
                                        <td style={{ paddingRight: 10 }}><CxPips score={factors[k].score} /></td>
                                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.76rem' }}>{factors[k].reason}</td>
                                        <td style={{ textAlign: 'right' }}>
                                          {factors[k].source && factors[k].source !== 'rule' && (
                                            <span style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--accent-purple, #8b5cf6)' }}>{factors[k].source}</span>)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Not rated yet — warming in the background.</div>}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Override:</span>
                                <select value={cx.overridden ? (cx.level || '') : ''} disabled={cx.busy}
                                  onChange={e => overrideComplexity(t.ticket_id, e.target.value || null)}
                                  style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 6px', borderRadius: 7, cursor: 'pointer',
                                    background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border-color, #334155)', color: 'var(--text-primary)' }}>
                                  <option value="">{cx.overridden ? 'Clear override' : 'Auto (computed)'}</option>
                                  <option value="High">High</option>
                                  <option value="Medium">Medium</option>
                                  <option value="Low">Low</option>
                                </select>
                                {cx.overridden && <span style={{ fontSize: '0.66rem', color: 'var(--accent-amber, #f59e0b)' }}>✎ manually set</span>}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="qcq-expand-section">
                        <h4>Testing & Bugs</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">Test Cases</span> {t.test_cases > 0 ? (t.testrail_plan_url ? <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer">{t.test_cases} cases</a> : `${t.test_cases} cases`) : 'No test plan'}</div>
                          <div><span className="qcq-detail-label">TC Passed</span> <span className="qcq-pass">{t.test_passed || 0}</span></div>
                          <div><span className="qcq-detail-label">TC Failed</span> <span className="qcq-fail">{t.test_failed || 0}</span></div>
                          <div><span className="qcq-detail-label">TC Untested</span> {t.test_untested || 0}</div>
                          <div><span className="qcq-detail-label">Bugs Total</span> {t.bugs_total || 0}</div>
                          <div><span className="qcq-detail-label">Bugs Open</span> <span className={t.bugs_open > 0 ? 'qcq-fail' : ''}>{t.bugs_open || 0}</span></div>
                          <div><span className="qcq-detail-label">Bugs Closed</span> <span className="qcq-pass">{t.bugs_closed || 0}</span></div>
                          <div><span className="qcq-detail-label">Released to QA</span> <span className="qcq-pass">{t.bugs_released_to_qa || 0}</span></div>
                        </div>
                      </div>
                      <div className="qcq-expand-section" style={{ flexBasis: '100%' }}>
                        <h4>Test Plan &amp; Review</h4>
                        <TicketStatusStrip t={t} showRefix />
                        {t.case_summary && <CaseHistory ticket={t} onRelabel={relabelCaseReason} />}
                      </div>
                      <div className="qcq-expand-section" style={{ flexBasis: '100%' }}>
                        <h4>Status Flow</h4>
                        <TicketFlow ticketId={t.ticket_id} />
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
    </>
    );
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>QC Queue & Ageing</h1>
            <p className="header-subtitle">QC testing queue with ageing analytics</p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* Global ticket lookup — find any ticket by id, any status */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input type="text" inputMode="numeric" placeholder="Find any ticket #" value={lookupId}
                  onChange={e => setLookupId(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') lookupTicket(); }}
                  className="qcq-search-input" style={{ width: '150px', paddingRight: lookupId ? '22px' : undefined }} />
                {lookupId && <button type="button" title="Clear" aria-label="Clear search"
                  onClick={() => { setLookupId(''); setLookupResult(null); setLookupError(''); }}
                  style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>✕</button>}
              </span>
              <button className="btn btn-sm btn-primary" onClick={lookupTicket} disabled={lookupLoading}>
                {lookupLoading ? '…' : 'Search'}
              </button>
            </div>
          </div>
        </header>

        {(lookupResult || lookupError) && (
          <TicketLookupCard result={lookupResult} error={lookupError}
            reviewState={reviewState} setReviewStatus={setReviewStatus} uploadReviewed={uploadReviewed}
            relabelCaseReason={relabelCaseReason}
            onClose={() => { setLookupResult(null); setLookupError(''); setLookupId(''); }} />
        )}


        {/* Animated Pipeline Visualization */}
        {queue && (() => {
          const devPipe = queue.dev_pipeline_summary || {};
          const sc = queue.status_cards || {};
          const bis = bisTesting?.tickets?.length || 0;
          const approved = approvedForLive?.tickets?.length || 0;
          const qcFail = qcFailed?.tickets?.length || 0;

          const mv = queue.movement_24h || {};
          const detail = devPipe.detail || {};
          const stages = [
            { id: 'dev', label: 'Dev Work', count: (devPipe.in_progress || 0), color: '#f59e0b', sub: 'In Progress + Hold', moved: mv.dev || 0,
              breakdown: [['In Progress', detail['In Progress']||0], ['Hold/Pending', detail['Hold/Pending']||0]].filter(x=>x[1]>0) },
            { id: 'cr', label: 'Code Review', count: (devPipe.code_review || 0), color: '#60a5fa', sub: 'Start CR + CR Failed', moved: mv.cr || 0,
              breakdown: [['Start Code Review', detail['Start Code Review']||0], ['Code Review Failed', detail['Code Review Failed']||0], ['Express Lane Review', detail['Express Lane Review']||0]].filter(x=>x[1]>0) },
            { id: 'crp', label: 'CR Passed', count: (devPipe.cr_passed || 0), color: '#2dd4bf', sub: 'Coming to QA!', pulse: true, moved: mv.crp || 0,
              breakdown: [['Code Review Passed', detail['Code Review Passed']||0]].filter(x=>x[1]>0) },
            { id: 'qa', label: 'QA Queue', count: (sc['QC Testing'] || 0) + (sc['QC Testing Hold'] || 0), color: '#22c55e', sub: `${sc['QC Testing'] || 0} waiting, ${sc['QC Testing Hold'] || 0} hold`, moved: mv.qa || 0,
              breakdown: [['QC Testing', sc['QC Testing']||0], ['QC Testing Hold', sc['QC Testing Hold']||0]].filter(x=>x[1]>0) },
            { id: 'testing', label: 'QA Testing', count: (sc['QC Testing in Progress'] || 0), color: '#a78bfa', sub: 'In Progress', moved: mv.testing || 0,
              breakdown: [['QC Testing in Progress', sc['QC Testing in Progress']||0]].filter(x=>x[1]>0) },
            { id: 'bis', label: 'BIS Testing', count: bis, color: '#f472b6', sub: 'Client sign-off', moved: mv.bis || 0,
              breakdown: [['BIS Testing', bis]].filter(x=>x[1]>0) },
            { id: 'live', label: 'Live', count: approved, color: '#34d399', sub: 'Prod deploy', moved: mv.live || 0,
              breakdown: [['Approved for Live', approved]].filter(x=>x[1]>0) },
          ];

          const totalFlow = stages.reduce((s, st) => s + st.count, 0);
          return (
          <div style={{ padding: '20px 12px', marginBottom: '8px', background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '1px', textTransform: 'uppercase' }}>Live Ticket Pipeline</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '8px' }}>{totalFlow} tickets in flow</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: '0', justifyContent: 'safe center', padding: '0 8px', flexWrap: 'nowrap' }}>
              {stages.map((s, i) => (
                <React.Fragment key={s.id}>
                  <div className="pipeline-stage" onClick={() => {
                    setPipelineDetail(pipelineDetail === s.id ? null : s.id);
                  }} style={{
                    background: `linear-gradient(135deg, ${s.color}18 0%, ${s.color}08 100%)`,
                    border: `2px solid ${s.color}60`, borderRadius: '14px',
                    padding: '12px 6px', flex: '1 1 0', minWidth: '92px', maxWidth: '150px', minHeight: '112px', boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    textAlign: 'center', cursor: 'pointer', position: 'relative',
                    transition: 'all 0.3s ease',
                    animation: s.pulse ? 'pipeline-pulse 2s ease-in-out infinite' : 'none',
                  }}>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, color: s.color, lineHeight: 1, textShadow: `0 0 20px ${s.color}30` }}>{s.count}</div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>{s.label}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.2 }}>{s.sub}</div>
                    {s.pulse && s.count > 0 && (
                      <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '12px', height: '12px', borderRadius: '50%', background: s.color, animation: 'pipeline-dot-pulse 1.5s ease-in-out infinite' }} />
                    )}
                  </div>
                  {i < stages.length - 1 && (
                    <div style={{ width: '30px', height: '36px', flexShrink: 0, alignSelf: 'center' }}>
                      <svg width="30" height="36" viewBox="0 0 44 36">
                        <line x1="2" y1="18" x2="32" y2="18" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
                        <polygon points="30,12 42,18 30,24" fill={`${stages[i+1].color}80`} />
                        {[0, 0.5, 1].map((d, pi) => (
                          <circle key={pi} r="3.5" fill={stages[i+1].color}>
                            <animate attributeName="cx" from="-2" to="36" dur={`${2 + i * 0.2}s`} begin={`${d}s`} repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0;0.9;0.9;0" dur={`${2 + i * 0.2}s`} begin={`${d}s`} repeatCount="indefinite" />
                          </circle>
                        ))}
                        <circle r="6" fill={stages[i+1].color} opacity="0.15">
                          <animate attributeName="cx" from="-2" to="36" dur={`${2 + i * 0.2}s`} repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0;0.2;0" dur={`${2 + i * 0.2}s`} repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* 24h movement — common row */}
            {stages.some(s => s.moved > 0) && (
              <div style={{ display: 'flex', justifyContent: 'safe center', gap: '0', marginTop: '8px', padding: '0 8px' }}>
                {stages.map((s, i) => (
                  <React.Fragment key={s.id}>
                    <div style={{ flex: '1 1 0', minWidth: '92px', maxWidth: '150px', textAlign: 'center', fontSize: '0.62rem', fontWeight: 700,
                      color: s.moved >= 5 ? s.color : 'var(--text-muted)' }}>
                      {s.moved > 0 ? `${s.moved >= 5 ? '\u26A1' : '\u2191'}+${s.moved}` : ''}
                    </div>
                    {i < stages.length - 1 && <div style={{ width: '30px', flexShrink: 0 }} />}
                  </React.Fragment>
                ))}
              </div>
            )}
            <div style={{ textAlign: 'center', fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {stages.some(s => s.moved > 0) ? 'tickets moved in last 24 hours' : ''}
            </div>

            {qcFail > 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
                <span onClick={() => setPipelineDetail(pipelineDetail === 'fail' ? null : 'fail')}
                  style={{ padding: '6px 16px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                    background: pipelineDetail === 'fail' ? '#ef4444' : 'rgba(239,68,68,0.12)',
                    color: pipelineDetail === 'fail' ? '#fff' : '#ef4444', border: '1px solid rgba(239,68,68,0.4)',
                    animation: 'pipeline-fail-glow 3s ease-in-out infinite' }}>
                  {'\u21A9'} QC Fail: {qcFail} returned to dev
                </span>
              </div>
            )}

            {/* Pipeline detail — shows breakdown + ticket list when a stage card is clicked */}
            {pipelineDetail && (() => {
              const stage = stages.find(s => s.id === pipelineDetail) || (pipelineDetail === 'fail' ? { id: 'fail', label: 'QC Review Fail', color: '#ef4444', breakdown: [['QC Review Fail', qcFail]] } : null);
              if (!stage) return null;
              const statusList = (stage.breakdown || []).map(b => b[0]);
              // Get tickets from available data
              const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
              // For dev statuses, tickets aren't in QC queue — fetch from module_pipeline
              const pipeTickets = (queue?.module_pipeline || []).flatMap(m => m.tickets || []);
              const combined = [...allQ, ...pipeTickets];
              const tickets = combined.filter(t => statusList.includes(t.status));
              // Deduplicate
              const seen = new Set();
              const unique = tickets.filter(t => { if (seen.has(t.ticket_id)) return false; seen.add(t.ticket_id); return true; });

              return (
                <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', border: `1px solid ${stage.color}40` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: stage.color }}>{stage.label} ({unique.length})</span>
                    {stage.breakdown?.length > 1 && stage.breakdown.map(([s, c]) => (
                      <span key={s} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: `${stage.color}15`, color: stage.color, fontWeight: 600 }}>{s}: {c}</span>
                    ))}
                    <button className="btn btn-sm btn-secondary" onClick={() => setPipelineDetail(null)} style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>Close</button>
                  </div>
                  {unique.length > 0 ? (
                    <div className="qcq-table-container">
                      <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                        <thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Module</th><th>Assign To</th><th>Developer</th><th>QC Tester</th></tr></thead>
                        <tbody>
                          {unique.map(t => (
                            <tr key={t.ticket_id} className="qcq-row">
                              <td style={{textAlign:'center'}}><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                              <td style={{ maxWidth: '250px', wordBreak: 'break-word', whiteSpace: 'normal', textAlign: 'left' }}>{t.title}</td>
                              <td style={{textAlign:'center'}}><span className="qcq-status-badge">{t.status}</span></td>
                              <td style={{textAlign:'center'}}>{t.priority}</td>
                              <td style={{textAlign:'center'}}>{t.module || '-'}</td>
                              <td style={{textAlign:'center'}}>{t.current_assignee || '-'}</td>
                              <td style={{textAlign:'center', fontSize:'0.72rem'}}>{devCell(t)}</td>
                              <td style={{textAlign:'center'}}>{t.qc_tester || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Ticket details available in Dev Dashboard</p>}
                </div>
              );
            })()}
          </div>);
        })()}

        {/* Platform filter (All / Web / Mobile) — placed below the live ticket pipeline */}
        <div className="qcq-platform-toggle" style={{ display: 'flex', gap: '6px', margin: '4px 0 12px' }}>
          <button className={`btn btn-sm ${platformFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('all')}>All ({rawQueue.length})</button>
          <button className={`btn btn-sm ${platformFilter === 'Web' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Web')}>Web ({webCount})</button>
          <button className={`btn btn-sm ${platformFilter === 'Mobile' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Mobile')}>Mobile ({mobileCount})</button>
        </div>

        {/* Status Cards - Clickable */}
        <div className="qcq-status-cards">
          <div className={`qcq-card qcq-card-clickable qcq-card-unassigned ${cardFilter === 'first_time' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('first_time')}>
            <div className="qcq-card-value">{firstTimeTickets.length}</div>
            <div className="qcq-card-label">First-time QC</div>
            <div className="qcq-card-sub">QC Testing · no tester · needs test plan</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-hold ${cardFilter === 'retesting' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('retesting')}>
            <div className="qcq-card-value">{retestingTickets.length}</div>
            <div className="qcq-card-label">Retest — Needs Tester</div>
            <div className="qcq-card-sub">QC Testing · refix · no tester · cases ready</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-testing ${cardFilter === 'assigned_not_started' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('assigned_not_started')}>
            <div className="qcq-card-value">{assignedNotStarted.length}</div>
            <div className="qcq-card-label">Assigned, Not Started</div>
            <div className="qcq-card-sub">Tester assigned · {assignedNotStarted.filter(isRetest).length} refix, {assignedNotStarted.filter(t => !isRetest(t)).length} new</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-progress ${cardFilter === 'in_progress' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('in_progress')}>
            <div className="qcq-card-value">{inProgressTickets.length}</div>
            <div className="qcq-card-label">In Progress</div>
            <div className="qcq-card-sub">Being tested</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-hold ${cardFilter === 'on_hold' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('on_hold')}>
            <div className="qcq-card-value">{onHoldTickets.length}</div>
            <div className="qcq-card-label">On Hold</div>
            <div className="qcq-card-sub">Blocked</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-failed ${cardFilter === 'qc_failed' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('qc_failed')}>
            <div className="qcq-card-value">{qcFailedCount}</div>
            <div className="qcq-card-label">QC Review Fail</div>
            <div className="qcq-card-sub">Failed QC review</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-progress ${cardFilter === 'bis_testing' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('bis_testing')}>
            <div className="qcq-card-value">{bisTestingTickets.length}</div>
            <div className="qcq-card-label">BIS Testing</div>
            <div className="qcq-card-sub">Passed QC, in BIS</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-fpr ${cardFilter === 'approved_for_live' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('approved_for_live')}>
            <div className="qcq-card-value">{approvedTickets.length}</div>
            <div className="qcq-card-label">Approved for Live</div>
            <div className="qcq-card-sub">Ready for prod verification</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-unassigned ${cardFilter === 'no_qa_estimate' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('no_qa_estimate')}>
            <div className="qcq-card-value">{noEstimateTickets.length}</div>
            <div className="qcq-card-label">No QA Estimate</div>
            <div className="qcq-card-sub">Need planning</div>
          </div>
          <div className="qcq-card qcq-card-total">
            <div className="qcq-card-value">{queue?.total || 0}</div>
            <div className="qcq-card-label">Total Queue</div>
            <div className="qcq-card-sub">{queue?.dev_tested_count || 0} dev-tested</div>
          </div>
        </div>

        {/* Card filter result list */}
        {cardFilter && cardFilteredList && (
          <div className="qcq-section qcq-card-filter-section">
            <div className="qcq-section-title">
              {cardFilterLabels[cardFilter]} ({applyFilters(cardFilteredList).length}{applyFilters(cardFilteredList).length !== cardFilteredList.length ? ` of ${cardFilteredList.length}` : ''})
              {(() => {
                const filtered = applyFilters(cardFilteredList);
                const firstTime = filtered.filter(t => !isRetest(t)).length;
                const refix = filtered.length - firstTime;
                return (
                  <span style={{ display: 'flex', gap: '6px', marginLeft: '10px' }}>
                    {firstTime > 0 && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(34,197,94,0.12)', color: 'var(--accent-green)', fontWeight: 600 }}>First Time: {firstTime}</span>}
                    {refix > 0 && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red)', fontWeight: 600 }}>Refix: {refix}</span>}
                  </span>
                );
              })()}
              <button className="btn btn-sm btn-secondary" onClick={() => setCardFilter(null)} style={{ marginLeft: 'auto' }}>Clear Filter</button>
            </div>

            {/* Distribution donuts: module always; QC-tester for tester-relevant cards */}
            {(() => {
              const list = cardFilteredList;
              const total = list.length;
              const modCounts = {};
              list.forEach(t => { const m = t.module || 'Unassigned'; modCounts[m] = (modCounts[m] || 0) + 1; });
              const TESTER_CARDS = ['assigned_not_started', 'in_progress', 'on_hold', 'approved_for_live'];
              const showTester = TESTER_CARDS.includes(cardFilter);
              const testerCounts = {};
              if (showTester) list.forEach(t => { const n = t.qc_tester || 'Unassigned'; testerCounts[n] = (testerCounts[n] || 0) + 1; });
              return (
                <div style={{ display: 'flex', gap: '32px', marginBottom: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <DistributionDonut title="By module" counts={modCounts} total={total}
                    activeKey={listModuleFilter} onSlice={(k) => setListModuleFilter(listModuleFilter === k ? '' : k)} />
                  {showTester && (
                    <DistributionDonut title="By QC tester" counts={testerCounts} total={total}
                      activeKey={listTesterFilter} onSlice={(k) => setListTesterFilter(listTesterFilter === k ? '' : k)} />
                  )}
                </div>
              );
            })()}
            <div className="qcq-section-title" style={{ fontSize: '0.85rem', marginBottom: '4px' }}>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input type="text" placeholder="Search tickets..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                  className="qcq-search-input" style={{ width: '180px', paddingRight: searchFilter ? '22px' : undefined }} />
                {searchFilter && <button type="button" title="Clear" aria-label="Clear search" onClick={() => setSearchFilter('')}
                  style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>✕</button>}
              </span>
              <select className="qcq-search-input" value={listPriorityFilter} onChange={e => setListPriorityFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Priorities</option>
                {[...new Set(cardFilteredList.map(t => t.priority).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="qcq-search-input" value={listModuleFilter} onChange={e => setListModuleFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Modules</option>
                {[...new Set(cardFilteredList.map(t => t.module).filter(Boolean))].sort().map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="qcq-search-input" value={listTesterFilter} onChange={e => setListTesterFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Testers</option>
                {[...new Set(cardFilteredList.map(t => t.qc_tester).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="qcq-search-input" value={listDeveloperFilter} onChange={e => setListDeveloperFilter(e.target.value)} style={{ width: '150px' }} title="Filter by developer on the ticket">
                <option value="">All Developers</option>
                <option value="Not Assigned">— Not Assigned —</option>
                {[...new Set(cardFilteredList.flatMap(t => (t.developers_str || '').split(',')).map(x => x.trim()).filter(d => d && d !== 'Not Assigned'))].sort().map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="qcq-search-input" value={listPlanFilter} onChange={e => setListPlanFilter(e.target.value)} style={{ width: '150px' }} title="TestRail plan (project BIS)">
                <option value="">All Test Plans</option>
                <option value="created">✓ Plan created</option>
                <option value="pending">✗ No plan yet</option>
              </select>
              <select className="qcq-search-input" value={listPrFilter} onChange={e => setListPrFilter(e.target.value)} style={{ width: '160px' }} title="PR / release note status (from the test-plan runner)">
                <option value="">All PR status</option>
                <option value="ready">✓ Has PR / release note</option>
                <option value="pre_release">⚠ No PR (pre-release)</option>
              </select>
              <select className={`qcq-search-input ${listDocFilter ? 'qcq-filter-active' : ''}`} value={listDocFilter}
                onChange={e => setListDocFilter(e.target.value)} style={{ width: '190px' }}
                title="Documentation confidence — reconciliation of ticket scope vs release note vs PR">
                <option value="">All Docs</option>
                <option value="weak">🚩 Weak (any gap)</option>
                <option value="NO_PR_NO_RN">🚩 No PR / Release Note</option>
                <option value="THIN_RN">📝 Thin Release Note</option>
                <option value="RN_REVIEW">🔍 RN Incomplete</option>
                <option value="PR_NO_RN">⚠ PR, No Release Note</option>
                <option value="RN_NO_PR">⚠ RN, No PR Link</option>
                <option value="ALIGNED">✓ Aligned</option>
              </select>
              <select className={`qcq-search-input ${ageingDays ? 'qcq-filter-active' : ''}`} value={ageingDays}
                onChange={e => setAgeingDays(Number(e.target.value))} style={{ width: '170px' }}
                title="Show tickets with no status change for at least N days (stale / no action taken)">
                <option value={0}>Ageing: Off</option>
                <option value={3}>⚠ No action &gt; 3d</option>
                <option value={5}>⚠ No action &gt; 5d</option>
                <option value={7}>⚠ No action &gt; 7d</option>
                <option value={10}>⚠ No action &gt; 10d</option>
              </select>
              <select className={`qcq-search-input ${cxLevelFilter ? 'qcq-filter-active' : ''}`} value={cxLevelFilter}
                onChange={e => setCxLevelFilter(e.target.value)} style={{ width: '160px' }}
                title="Filter by test complexity (High / Medium / Low)">
                <option value="">All Complexity</option>
                <option value="High">🔴 High</option>
                <option value="Medium">🟡 Medium</option>
                <option value="Low">🟢 Low</option>
              </select>
              {(searchFilter || listPriorityFilter || listModuleFilter || listTesterFilter || listDeveloperFilter || listPlanFilter || listPrFilter || listDocFilter || ageingDays || cxLevelFilter) && (
                <button className="btn btn-sm btn-secondary" onClick={() => { setSearchFilter(''); setListPriorityFilter(''); setListModuleFilter(''); setListTesterFilter(''); setListDeveloperFilter(''); setListPlanFilter(''); setListPrFilter(''); setListDocFilter(''); setAgeingDays(0); setCxLevelFilter(''); }}>
                  Clear Filters
                </button>
              )}
            </div>
            {(() => {
              const _shown = applyFilters(cardFilteredList);
              return (<>
                {ageingDays > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-amber, #f59e0b)', marginBottom: '6px' }}>
                    {_shown.length} ticket(s) with no status change for ≥ {ageingDays} day(s).
                  </div>
                )}
                {renderQueueTable(_shown, cardFilterLabels[cardFilter])}
              </>);
            })()}
          </div>
        )}

        {/* Tabs */}
        <div className="qcq-tabs">
          <button className={`qcq-tab ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => { setActiveTab('queue'); setCardFilter(null); }}>
            Queue ({queue?.total || 0})
          </button>
          <button className={`qcq-tab ${activeTab === 'module_workload' ? 'active' : ''}`} onClick={() => { setActiveTab('module_workload'); setCardFilter(null); setSelectedModuleBar(null); }}>
            Module Workload ({moduleWorkload.length})
          </button>
          <button className={`qcq-tab ${activeTab === 'dev_pipeline' ? 'active' : ''}`} onClick={() => { setActiveTab('dev_pipeline'); setCardFilter(null); setSelectedPipelineBar(null); }}>
            Incoming Pipeline ({modulePipeline.reduce((s, m) => s + m.total, 0)})
          </button>
          {activeTab === 'queue' && (
            <div className="qcq-search" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="qcq-search-input"
                  style={{ paddingRight: searchFilter ? '22px' : undefined }}
                />
                {searchFilter && <button type="button" title="Clear" aria-label="Clear search" onClick={() => setSearchFilter('')}
                  style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>✕</button>}
              </span>
              <select className="qcq-search-input" value={listPriorityFilter} onChange={e => setListPriorityFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Priorities</option>
                {uniquePriorities.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="qcq-search-input" value={listModuleFilter} onChange={e => setListModuleFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Modules</option>
                {uniqueModules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="qcq-search-input" value={listTesterFilter} onChange={e => setListTesterFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Testers</option>
                {uniqueTesters.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="qcq-search-input" value={listDeveloperFilter} onChange={e => setListDeveloperFilter(e.target.value)} style={{ width: '150px' }} title="Filter by developer on the ticket">
                <option value="">All Developers</option>
                <option value="Not Assigned">— Not Assigned —</option>
                {uniqueDevelopers.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="qcq-search-input" value={listPlanFilter} onChange={e => setListPlanFilter(e.target.value)} style={{ width: '150px' }} title="TestRail plan (project BIS)">
                <option value="">All Test Plans</option>
                <option value="created">✓ Plan created</option>
                <option value="pending">✗ No plan yet</option>
              </select>
            </div>
          )}
        </div>

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              QC Queue
              <span className="qcq-section-hint">Tickets in QC. Click a column to sort, or a row for details.</span>
            </h2>
            {renderQueueTable(queueList, 'queue')}

            {devTested.length > 0 && (
              <>
                <h3 className="qcq-subsection-title">Dev-Tested ({devTested.length})</h3>
                {renderQueueTable(devTested, 'dev-tested')}
              </>
            )}
          </div>
        )}

        {/* Module Workload Tab */}
        {activeTab === 'module_workload' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Module Workload
              <span className="qcq-section-hint">QC pending tickets by module and status. Click any bar segment to see tickets.</span>
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', fontSize: '0.72rem' }}
                onClick={() => {
                  const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                  exportToExcel(allQ, 'QC_Module_Workload_All');
                }}>Export All</button>
            </h2>
            {(() => {
              const maxTotal = Math.max(...moduleWorkload.map(m => m.total), 1);
              const statusDefs = [
                { key: 'qc_testing', label: 'QC Testing', color: '#3b82f6' },
                { key: 'in_progress', label: 'In Progress', color: '#22c55e' },
                { key: 'hold', label: 'Hold', color: '#f59e0b' },
                { key: 'qc_failed', label: 'QC Failed', color: '#ef4444' },
                { key: 'bis', label: 'BIS Testing', color: '#8b5cf6' },
                { key: 'approved', label: 'Approved', color: '#06b6d4' },
              ];
              const statusToQueueStatus = {
                qc_testing: 'QC Testing', in_progress: 'QC Testing in Progress',
                hold: 'QC Testing Hold', qc_failed: 'QC Review Fail',
                bis: 'BIS Testing', approved: 'Approved for Live'
              };

              const getModuleTickets = (mod, statusKey) => {
                const queueStatus = statusToQueueStatus[statusKey];
                const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                return allQ.filter(t => (t.module || 'Unassigned') === mod && t.status === queueStatus);
              };

              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {statusDefs.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                        {s.label}
                      </div>
                    ))}
                  </div>

                  {/* Stacked horizontal bars */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {moduleWorkload.map(m => (
                      <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '160px', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={m.module}>
                          {m.module}
                        </div>
                        <div style={{ flex: 1, display: 'flex', height: '28px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)', cursor: 'pointer' }}>
                          {statusDefs.map(s => {
                            const count = m[s.key] || 0;
                            if (count === 0) return null;
                            const widthPct = (count / maxTotal) * 100;
                            const isActive = selectedModuleBar?.module === m.module && selectedModuleBar?.status === s.key;
                            return (
                              <div
                                key={s.key}
                                style={{
                                  width: `${widthPct}%`, minWidth: count > 0 ? '18px' : 0,
                                  background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '0.7rem', color: '#fff', fontWeight: 600, transition: 'all 0.2s',
                                  opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                }}
                                title={`${m.module} — ${s.label}: ${count}`}
                                onClick={() => {
                                  const val = isActive ? null : { module: m.module, status: s.key, label: s.label };
                                  setSelectedModuleBar(val);
                                  if (val) setTimeout(() => moduleListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                }}
                              >
                                {count}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ width: '60px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: m.total >= 10 ? 'var(--accent-red, #ef4444)' : m.total >= 5 ? 'var(--accent-amber, #f59e0b)' : 'var(--text-secondary)' }}>{m.total}</span>
                          <span style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '0.68rem' }}
                            title={`Export all ${m.total} ${m.module} tickets`}
                            onClick={() => {
                              const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                              const modTickets = allQ.filter(t => (t.module || 'Unassigned') === m.module);
                              exportToExcel(modTickets, `QC_${m.module}`);
                            }}>CSV</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Clicked bar segment — show ticket list */}
                  {selectedModuleBar && (() => {
                    const tickets = getModuleTickets(selectedModuleBar.module, selectedModuleBar.status);
                    return (
                      <div ref={moduleListRef} style={{ marginTop: '16px' }}>
                        <div className="qcq-section-title" style={{ fontSize: '0.9rem' }}>
                          {selectedModuleBar.module} — {selectedModuleBar.label} ({tickets.length})
                          <button className="btn btn-sm btn-primary" onClick={() => exportToExcel(tickets, `${selectedModuleBar.module}_${selectedModuleBar.label}`)} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>Export</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setSelectedModuleBar(null)} style={{ marginLeft: 'auto' }}>Close</button>
                        </div>
                        {tickets.length > 0 ? renderQueueTable(tickets, 'module-workload') : <p style={{color:'var(--text-muted)',padding:'8px'}}>No tickets</p>}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        )}

        {/* Incoming Pipeline Tab */}
        {activeTab === 'dev_pipeline' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Incoming Pipeline
              <span className="qcq-section-hint">Dev tickets expected to reach QA — first-time (new) vs refix (returned from QA failure). Click a bar to see tickets.</span>
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', fontSize: '0.72rem' }}
                onClick={() => {
                  const allPipelineTickets = modulePipeline.flatMap(m => m.tickets || []);
                  exportToExcel(allPipelineTickets, 'Incoming_Pipeline_All');
                }}>Export All</button>
            </h2>
            {(() => {
              const maxTotal = Math.max(...modulePipeline.map(m => m.total), 1);
              const segmentDefs = [
                { key: 'cr_passed', label: 'CR Passed (Imminent)', color: '#22c55e', filter: t => t.status === 'Code Review Passed' },
                { key: 'code_review', label: 'Code Review', color: '#3b82f6', filter: t => ['Start Code Review','Code Review Failed','Express Lane Review'].includes(t.status) },
                { key: 'in_progress', label: 'In Progress', color: '#f59e0b', filter: t => ['In Progress','Hold/Pending'].includes(t.status) },
              ];
              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: 'linear-gradient(90deg, #22c55e, #3b82f6, #f59e0b)', display: 'inline-block' }} />
                      First Time
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
                      Refix (returned from QA)
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '8px' }}>|</span>
                    {segmentDefs.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 1, background: s.color, display: 'inline-block' }} />
                        {s.label}
                      </div>
                    ))}
                  </div>

                  {/* Bars per module */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {modulePipeline.map(m => {
                      const firstTime = m.first_time || 0;
                      const refix = m.refix || 0;
                      return (
                        <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '160px', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={m.module}>{m.module}</div>
                          <div style={{ flex: 1, display: 'flex', height: '28px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)' }}>
                            {/* First-time segments */}
                            {segmentDefs.map(s => {
                              const tickets = (m.tickets || []).filter(t => !t.is_refix && s.filter(t));
                              if (tickets.length === 0) return null;
                              const isActive = selectedPipelineBar?.module === m.module && selectedPipelineBar?.type === s.key;
                              return (
                                <div key={s.key}
                                  style={{
                                    width: `${(tickets.length / maxTotal) * 100}%`, minWidth: '16px',
                                    background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.7rem', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                  }}
                                  title={`${m.module} — ${s.label} (First Time): ${tickets.length}`}
                                  onClick={() => { const val = isActive ? null : { module: m.module, type: s.key, label: `${s.label} (First Time)`, tickets }; setSelectedPipelineBar(val); if (val) setTimeout(() => pipelineListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                                >{tickets.length}</div>
                              );
                            })}
                            {/* Refix segment */}
                            {refix > 0 && (() => {
                              const refixTickets = (m.tickets || []).filter(t => t.is_refix);
                              const isActive = selectedPipelineBar?.module === m.module && selectedPipelineBar?.type === 'refix';
                              return (
                                <div
                                  style={{
                                    width: `${(refix / maxTotal) * 100}%`, minWidth: '16px',
                                    background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.7rem', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                  }}
                                  title={`${m.module} — Refix: ${refix}`}
                                  onClick={() => { const val = isActive ? null : { module: m.module, type: 'refix', label: 'Refix', tickets: refixTickets }; setSelectedPipelineBar(val); if (val) setTimeout(() => pipelineListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                                >{refix}</div>
                              );
                            })()}
                          </div>
                          <div style={{ width: '100px', display: 'flex', gap: '6px', fontSize: '0.75rem', fontWeight: 600, alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{firstTime}</span>
                            {refix > 0 && <span style={{ color: '#ef4444' }}>+{refix}R</span>}
                            <span style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '0.68rem', marginLeft: '2px' }}
                              title={`Export all ${m.total} ${m.module} tickets`}
                              onClick={() => exportToExcel(m.tickets || [], `Pipeline_${m.module}`)}>
                              CSV
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Clicked bar — ticket list */}
                  {selectedPipelineBar && (
                    <div ref={pipelineListRef} style={{ marginTop: '16px' }}>
                      <div className="qcq-section-title" style={{ fontSize: '0.9rem' }}>
                        {selectedPipelineBar.module} — {selectedPipelineBar.label} ({selectedPipelineBar.tickets?.length || 0})
                        <button className="btn btn-sm btn-primary" onClick={() => exportToExcel(selectedPipelineBar.tickets, `${selectedPipelineBar.module}_${selectedPipelineBar.label}`)} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>Export</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setSelectedPipelineBar(null)} style={{ marginLeft: 'auto' }}>Close</button>
                      </div>
                      {selectedPipelineBar.tickets?.length > 0 ? (
                        <div className="qcq-table-container">
                          <table className="qcq-table">
                            <thead>
                              <tr>
                                <th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Platform</th>
                                <th>Developer</th><th>Assign To</th><th>QC Tester</th><th>Refix</th><th>Dev Est</th><th>Dev Actual</th><th>ETA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedPipelineBar.tickets.map(t => (
                                <tr key={t.ticket_id}>
                                  <td><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                  <td style={{maxWidth:'250px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.title}>{t.title}</td>
                                  <td><span className="qcq-status-badge">{t.status}</span></td>
                                  <td>{t.priority}</td>
                                  <td>{t.platform || '-'}</td>
                                  <td>{devCell(t)}</td>
                                  <td>{t.current_assignee || '-'}</td>
                                  <td>{t.qc_tester || '-'}</td>
                                  <td>{t.is_refix ? <span className="qcq-fail">Yes</span> : '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.dev_estimate_hours || '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.actual_dev_hours || '-'}</td>
                                  <td>{t.eta || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <p style={{color:'var(--text-muted)',padding:'8px'}}>No tickets</p>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        </main>

      {/* QA estimate modal — the QA Estimation "Plan" step, inline at the queue */}
      {estimatePopup && (
        <div onClick={() => setEstimatePopup(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.66)', backdropFilter: 'blur(2px)',
            zIndex: 100000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 12px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(760px, 97vw)', background: 'var(--bg-card, #1e293b)', border: '1px solid var(--border-color, #334155)',
              borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>⏱ QA Estimate</strong>
              <button onClick={() => setEstimatePopup(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
            </div>
            <TicketEstimatePanel ticketId={estimatePopup.ticket_id} qaMember={estimatePopup.qc_tester || ''} />
          </div>
        </div>
      )}
    </div>
  );
}
