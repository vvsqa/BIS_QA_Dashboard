import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import { ComplexityBadge } from './complexity';
import './dashboard.css';

const PM_TICKET_URL = 'https://pm.bissafety.app/tickets/';
const fmtH = (h) => (h == null ? '–' : `${(+h).toFixed(1)}h`);
const ENV_OPTS = ['Staging', 'Pre', 'Live'];
const TRIGGERS = [
  { value: 'initial', label: 'Initial plan' }, { value: 'scope_change', label: 'Scope change' },
  { value: 'more_bugs', label: 'More bugs' }, { value: 'manual', label: 'Manual re-estimate' },
];
const ST = {
  awaiting: { label: 'Awaiting', c: '#64748b' }, planning: { label: 'Planning', c: '#f59e0b' },
  in_review: { label: 'In review', c: '#3b82f6' }, reviewed: { label: 'Reviewed', c: '#22c55e' },
};
const STAGES = [{ k: 'planning', label: 'Plan' }, { k: 'in_review', label: 'Review' }, { k: 'reviewed', label: 'Reviewed' }];
const VERDICT = {
  justified: { t: 'Justified', c: '#22c55e' }, partially_justified: { t: 'Partially justified', c: '#f59e0b' },
  over_asked: { t: 'Over-asked', c: '#ef4444' }, within_allowed: { t: 'Within allowed', c: '#22c55e' },
  slight_overrun: { t: 'Slight overrun', c: '#f59e0b' }, over_allowed: { t: 'Over allowed', c: '#ef4444' },
};
const ENV_META = { Staging: '#3b82f6', Pre: '#a855f7', Live: '#22c55e' };
const QC_STATUS = [
  { k: 'QC Testing', cls: 'qcq-card-testing', short: 'QC Testing' },
  { k: 'QC Testing in Progress', cls: 'qcq-card-progress', short: 'In Progress' },
  { k: 'QC Testing Hold', cls: 'qcq-card-hold', short: 'On Hold' },
  { k: 'QC Review Fail', cls: 'qcq-card-failed', short: 'Review Fail' },
  { k: 'Tested - Awaiting Fixes', cls: 'qcq-card-hold', short: 'Awaiting Fixes' },
  { k: 'Code Review Failed', cls: 'qcq-card-failed', short: 'Code Rev Fail' },
  { k: 'BIS Testing', cls: 'qcq-card-total', short: 'BIS Testing' },
];
const STATUS_COLOR = {
  'QC Testing': '#3b82f6', 'QC Testing in Progress': '#0ea5e9', 'QC Testing Hold': '#f59e0b',
  'QC Review Fail': '#ef4444', 'Tested - Awaiting Fixes': '#f59e0b', 'Code Review Failed': '#ef4444', 'BIS Testing': '#a855f7',
};
const DONUT_PALETTE = ['#14b8a6', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#22c55e', '#06b6d4', '#eab308', '#ec4899', '#64748b'];

const CSS = `
@keyframes qae-fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes qae-pop{0%{opacity:0;transform:scale(.97)}100%{opacity:1;transform:scale(1)}}
@keyframes qae-shimmer{0%{background-position:-220px 0}100%{background-position:220px 0}}
.qae-fade{animation:qae-fade .35s cubic-bezier(.2,.7,.3,1) both}
.qae-pop{animation:qae-pop .26s ease both}
.qae-skel{border-radius:8px;background:linear-gradient(90deg,rgba(148,163,184,.08) 25%,rgba(148,163,184,.2) 37%,rgba(148,163,184,.08) 63%);background-size:400px 100%;animation:qae-shimmer 1.1s infinite}
.qae-tab{transition:color .2s,background .2s,box-shadow .2s;cursor:pointer}
.qae-card{transition:transform .16s ease,box-shadow .16s ease}
.qae-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.18)}
.qae-irow:hover{background:var(--bg-tertiary)}
`;

const inp = { padding: '6px 8px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.8rem' };
const PLBL_LOCAL = { fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 };
const sel = (v, onChange, opts, ph, style) => (
  <select value={v} onChange={e => onChange(e.target.value)} style={{ ...inp, ...style }}>
    {ph && <option value="">{ph}</option>}
    {opts.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

function AnimatedNumber({ value, dur = 650, dp = 0 }) {
  const [v, setV] = useState(0); const ref = useRef(0);
  useEffect(() => {
    const from = ref.current, to = Number(value) || 0, t0 = performance.now(); let raf;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); const cur = from + (to - from) * e; setV(cur); ref.current = cur; if (p < 1) raf = requestAnimationFrame(tick); else ref.current = to; };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return <>{(Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp)}</>;
}

function Ring({ value, max, label, color }) {
  const r = 32, c = 2 * Math.PI * r, frac = max > 0 ? Math.min(1, (value || 0) / max) : 0;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1)' }} />
        <text x="40" y="38" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text-primary,#e2e8f0)">{value == null ? '–' : (+value).toFixed(1)}</text>
        <text x="40" y="52" textAnchor="middle" fontSize="8" fill="var(--text-muted)">hrs</text>
      </svg>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, color }}>{label}</div>
    </div>
  );
}

function Stepper({ status }) {
  const idx = status === 'reviewed' ? 2 : status === 'in_review' ? 1 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1, maxWidth: 360 }}>
      {STAGES.map((s, i) => (
        <React.Fragment key={s.k}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.78rem', transition: 'all .4s', background: i <= idx ? 'var(--accent-teal, #14b8a6)' : 'var(--bg-secondary)', color: i <= idx ? '#fff' : 'var(--text-muted)', boxShadow: i === idx ? '0 0 0 4px rgba(20,184,166,0.22)' : 'none' }}>{i < idx ? '✓' : i + 1}</div>
            <span style={{ fontSize: '0.62rem', fontWeight: i === idx ? 700 : 500, color: i <= idx ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s.label}</span>
          </div>
          {i < STAGES.length - 1 && <div style={{ flex: 1, height: 3, minWidth: 28, margin: '0 5px 16px', borderRadius: 2, background: i < idx ? 'var(--accent-teal, #14b8a6)' : 'var(--border-color)', transition: 'background .5s' }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function StatusBadge({ s }) {
  const m = ST[s] || ST.awaiting;
  return <span style={{ fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 9px', borderRadius: 20, color: '#fff', background: m.c }}>{m.label}</span>;
}

function QcStatusCards({ groups, active, onSelect }) {
  if (!groups.length) return null;
  return (
    <div className="qcq-status-cards" style={{ marginBottom: 16 }}>
      {groups.map(g => (
        <div key={g.k} className={`qcq-card qcq-card-clickable ${g.cls || 'qcq-card-total'} ${active === g.k ? 'qcq-card-active' : ''}`} onClick={() => onSelect(active === g.k ? null : g.k)}>
          <div className="qcq-card-value"><AnimatedNumber value={g.count} /></div>
          <div className="qcq-card-label">{g.short || g.k}</div>
        </div>
      ))}
    </div>
  );
}

// Clean SVG donut with separated slices + readable labels (name · count · %).
function TesterDonut({ groups, active, onSelect }) {
  const total = groups.reduce((a, g) => a + g.count, 0);
  const top = groups.slice(0, 8);
  const restCount = groups.slice(8).reduce((a, g) => a + g.count, 0);
  const slices = restCount > 0 ? [...top, { name: 'Others', count: restCount }] : top;
  const R = 54, CX = 64, CY = 64, SW = 22;
  const circ = 2 * Math.PI * R;
  let acc = 0;
  const arcs = slices.map((g, i) => {
    const frac = total > 0 ? g.count / total : 0;
    const dash = `${frac * circ} ${circ}`;
    const offset = -acc * circ;
    acc += frac;
    return { g, i, dash, offset, color: g.name === 'Others' ? '#64748b' : DONUT_PALETTE[i % DONUT_PALETTE.length] };
  });
  return (
    <div className="qcq-section" style={{ padding: 14 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>QC testers</div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg width="128" height="128" viewBox="0 0 128 128" style={{ flexShrink: 0 }}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={SW} />
          {total > 0 && arcs.map(a => (
            <circle key={a.i} cx={CX} cy={CY} r={R} fill="none" stroke={a.color} strokeWidth={active && active !== a.g.name ? SW - 6 : SW}
              strokeDasharray={a.dash} strokeDashoffset={a.offset} transform={`rotate(-90 ${CX} ${CY})`}
              style={{ opacity: active && active !== a.g.name ? 0.35 : 1, cursor: 'pointer', transition: 'opacity .2s, stroke-width .2s' }}
              onClick={() => onSelect(active === a.g.name ? null : a.g.name)} />
          ))}
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text-primary,#e2e8f0)">{total}</text>
          <text x={CX} y={CY + 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)">tickets</text>
        </svg>
        <div style={{ display: 'grid', gap: 4, fontSize: '0.74rem', flex: 1, minWidth: 160 }}>
          {arcs.map(a => (
            <div key={a.i} onClick={() => onSelect(active === a.g.name ? null : a.g.name)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '2px 4px', borderRadius: 5, background: active === a.g.name ? 'var(--bg-tertiary)' : 'transparent', opacity: active && active !== a.g.name ? 0.5 : 1 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flexShrink: 0 }} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.g.name}</span>
              <b>{a.g.count}</b>
              <span style={{ color: 'var(--text-muted)', minWidth: 34, textAlign: 'right' }}>{total > 0 ? Math.round(a.g.count / total * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Bug-breakdown bar chart (status / severity / environment), color-coded, with counts.
const BUG_COLOR = (cat, key) => {
  const k = (key || '').toLowerCase();
  if (cat === 'severity') return k.includes('crit') ? '#b91c1c' : (k.includes('major') || k.includes('high') || k.includes('block')) ? '#ef4444' : (k.includes('minor') || k.includes('low')) ? '#f59e0b' : '#64748b';
  if (cat === 'env') return k.includes('live') || k.includes('prod') ? '#ef4444' : k.includes('pre') ? '#f59e0b' : k.includes('stag') ? '#3b82f6' : '#64748b';
  // status
  if (k === 'closed') return '#22c55e';
  if (k === 'fixed') return '#06b6d4';
  if (k === 'rejected' || k === 'deferred' || k.includes('wont') || k.includes('duplicate')) return '#64748b';
  if (k === 'reopened') return '#a855f7';
  return '#ef4444'; // open-ish (new / assigned / feedback / in progress)
};
function BugBars({ title, data, cat }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div>
      <div style={{ ...PLBL_LOCAL, marginBottom: 6 }}>{title}</div>
      {entries.length ? (
        <div style={{ display: 'grid', gap: 5 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 22px', alignItems: 'center', gap: 8, fontSize: '0.72rem' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }} title={k}>{k}</span>
              <div style={{ height: 9, borderRadius: 5, background: 'rgba(148,163,184,0.13)' }}>
                <div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 5, background: BUG_COLOR(cat, k), transition: 'width .5s' }} />
              </div>
              <b style={{ textAlign: 'right' }}>{v}</b>
            </div>
          ))}
        </div>
      ) : <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>none</span>}
    </div>
  );
}

// QC-queue-style label/value pair.
function DRow({ label, value, color }) {
  return (
    <div><span className="qcq-detail-label">{label}</span> <span style={{ color: color || 'var(--text-primary)', fontWeight: 600 }}>{value ?? '–'}</span></div>
  );
}

// Editable, ordered, per-environment plan (Staging → Pre → Live). Used for baseline + saved plan.
function PlanEditor({ plan, setPlan }) {
  if (!plan) return null;
  const acts = plan.activities || [];
  const buffer = plan.buffer_hours || 0;
  const total = round1(acts.reduce((a, x) => a + (parseFloat(x.suggested_hours) || 0), 0) + buffer);
  const grouped = ENV_OPTS.map(env => ({ env, rows: acts.map((a, i) => ({ a, i })).filter(x => (x.a.environment || 'Staging') === env) }))
    .filter(g => g.rows.length);
  const setAct = (i, k, val) => setPlan({ ...plan, activities: acts.map((a, j) => j === i ? { ...a, [k]: val } : a) });
  const removeAct = (i) => setPlan({ ...plan, activities: acts.filter((_, j) => j !== i) });
  const addAct = (env) => setPlan({ ...plan, activities: [...acts, { activity: '', environment: env, phase: 'functional', required: true, suggested_hours: 0, rationale: '' }] });
  return (
    <div>
      {grouped.map(({ env, rows }) => (
        <div key={env} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '8px 0 4px' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: ENV_META[env] }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: ENV_META[env], textTransform: 'uppercase', letterSpacing: '0.4px' }}>{env}</span>
            <button onClick={() => addAct(env)} title={`Add a ${env} activity`} style={{ ...inp, marginLeft: 'auto', cursor: 'pointer', padding: '1px 8px', fontSize: '0.7rem' }}>+ add</button>
          </div>
          <table className="qcq-table" style={{ fontSize: '0.76rem' }}>
            <tbody>
              {rows.map(({ a, i }) => (
                <tr key={i} className="qae-irow">
                  <td style={{ textAlign: 'left', width: '38%' }}>
                    <input style={{ ...inp, width: '100%', padding: '3px 6px' }} value={a.activity} onChange={e => setAct(i, 'activity', e.target.value)} />
                  </td>
                  <td style={{ width: 78 }}>{sel(a.environment || 'Staging', v => setAct(i, 'environment', v), ENV_OPTS, null, { padding: '3px 4px', width: '100%' })}</td>
                  <td style={{ width: 64 }}><input type="number" step="0.5" style={{ ...inp, width: 54, padding: '3px 5px' }} value={a.suggested_hours} onChange={e => setAct(i, 'suggested_hours', e.target.value)} /></td>
                  <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>{a.rationale}</td>
                  <td style={{ width: 26 }}><button onClick={() => removeAct(i)} title="Remove" style={{ ...inp, cursor: 'pointer', padding: '2px 6px', color: 'var(--accent-red)' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>+ {fmtH(buffer)} buffer (10% bug/retest/regression){plan.automation?.automated_cases ? ` · ${plan.automation.automated_cases} automated excluded` : ''}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 800, color: 'var(--accent-teal)', fontSize: '1.05rem' }}>Total {fmtH(total)}</span>
      </div>
      {plan.approach_notes && <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-secondary)' }}><b>Approach:</b> {plan.approach_notes} <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>({plan.source})</span></div>}
    </div>
  );
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
// Clean, aligned, copy-pasteable plan: section per environment, dot-leader alignment of activity → hours,
// a subtotal per environment and a grand total. Reads well in PM/Teams/email (dot leaders survive both
// monospace and proportional fonts).
const planText = (tid, plan) => {
  const acts = plan?.activities || [];
  const buf = round1(plan?.buffer_hours || 0);
  const total = round1(acts.reduce((a, x) => a + (parseFloat(x.suggested_hours) || 0), 0) + buf);
  const labels = acts.map(a => (a.activity || '').trim()).concat(['Subtotal', 'Buffer (10%)', 'TOTAL']);
  const W = Math.min(50, Math.max(18, ...labels.map(l => l.length)) + 2);
  const leader = (label, hours) => {
    label = (label || '').trim();
    const val = `${(+hours || 0).toFixed(1)}h`.padStart(6);
    const dots = Math.max(2, W - label.length);
    return `${label} ${'.'.repeat(dots)} ${val}`;
  };
  const out = [`QA Test Plan · #${tid}`, 'Execution order: Staging → Pre → Live', ''];
  ENV_OPTS.forEach(env => {
    const rows = acts.filter(a => (a.environment || 'Staging') === env);
    if (!rows.length) return;
    out.push(env.toUpperCase());
    let sub = 0;
    rows.forEach(a => {
      sub += (+a.suggested_hours || 0);
      out.push('  ' + leader(a.activity, a.suggested_hours));
      if (a.rationale) out.push('      ' + a.rationale.trim());
    });
    out.push('  ' + leader('Subtotal', sub), '');
  });
  if (buf) out.push('  ' + leader('Buffer (10%)', buf), '');
  out.push('  ' + '─'.repeat(W + 7), '  ' + leader('TOTAL', total));
  return out.join('\n');
};

// Clipboard that also works on the dashboard's plain-HTTP origin (http://10.1.0.20), where
// navigator.clipboard is unavailable because it's not a secure context. Falls back to a hidden
// textarea + execCommand('copy'); returns false only if even that fails.
const copyToClipboard = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.left = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
};

// Short justification to paste into PM when adding the PLANNED QA time (edit #1).
const pmPlanComment = (tid, plan, ticket) => {
  const acts = plan?.activities || [];
  const total = round1(acts.reduce((a, x) => a + (parseFloat(x.suggested_hours) || 0), 0) + (plan?.buffer_hours || 0));
  const envs = [...new Set(acts.map(a => a.environment || 'Staging'))];
  const phases = [...new Set(acts.map(a => (a.phase || '').trim()).filter(Boolean))];
  const scope = phases.length ? phases.join(', ')
    : [...new Set(acts.map(a => (a.activity || '').trim()).filter(Boolean))].slice(0, 4).join(', ');
  const au = plan?.automation || {};
  const cc = [];
  if (au.manual_cases) cc.push(`${au.manual_cases} manual`);
  if (au.automated_cases) cc.push(`${au.automated_cases} automated`);
  const mod = ticket?.module || ticket?.test_type || '';
  let s = `QA planned estimate: ${total}h for #${tid}. Scope: ${scope || 'test design & execution'} across ${envs.join(', ') || 'Staging'}`;
  if (cc.length) s += ` (${cc.join(' / ')} cases)`;
  if (plan?.buffer_hours) s += `; +${round1(plan.buffer_hours)}h buffer (bug/retest/regression)`;
  s += '.';
  if (mod) s += ` [${mod}]`;
  return s;
};

// Short justification to paste into PM at REVIEW (edit #2 — only when the plan wasn't met).
// PM time-edit justification built from the reviewed per-activity allocation (aligned, paste-ready).
const pmAllocComment = (tid, alloc) => {
  const acts = (alloc && alloc.activities) || [];
  if (!acts.length) return `QA review #${tid}: no activity breakdown.`;
  const allowed = round1(acts.reduce((s, a) => s + (parseFloat(a.allowed_hours) || 0), 0));
  const actual = round1(acts.reduce((s, a) => s + (parseFloat(a.actual_hours) || 0), 0));
  const W = Math.min(46, Math.max(16, ...acts.map(a => (a.activity || '').length)) + 2);
  const leader = (label, h) => {
    label = (label || '').trim();
    return `${label} ${'.'.repeat(Math.max(2, W - label.length))} ${`${(+h || 0).toFixed(1)}h`.padStart(6)}`;
  };
  const out = [`QA review #${tid}: allowed ${allowed}h (actual ${actual}h) — per-activity max-allowed:`];
  acts.forEach(a => out.push('  ' + leader(a.activity, a.allowed_hours)));
  out.push('  ' + '─'.repeat(W + 7), '  ' + leader('TOTAL ALLOWED', allowed));
  return out.join('\n');
};

// ------------------------------------------------------------------ Detail modal
function DetailPanel({ ticket, onChanged }) {
  const tid = ticket.ticket_id;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);            // working baseline/agreed plan
  const [useAi, setUseAi] = useState(true);
  const [testerText, setTesterText] = useState('');
  const [trigger, setTrigger] = useState('initial');
  const [reason, setReason] = useState('');
  const [testerResult, setTesterResult] = useState(null);
  const [review, setReview] = useState(null);
  const [alloc, setAlloc] = useState(null);          // per-activity review allocation {activities, allowed_total, ...}
  const [rawText, setRawText] = useState('');        // tester's pasted activity + time log
  const [actual, setActual] = useState('');
  const [qaComments, setQaComments] = useState('');
  const [comment, setComment] = useState('');
  const [accepted, setAccepted] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedPm, setCopiedPm] = useState('');
  const [planMode, setPlanMode] = useState('claude');   // claude | propose

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/${tid}`);
      const d = r.ok ? await r.json() : null;
      setDetail(d);
      const th = d?.thread;
      setComment(th?.manager_comment || '');
      setActual(th?.actual_hours != null ? String(th.actual_hours) : '');
      setQaComments(th?.qa_comments || '');
      if (th?.recalc_breakdown) {
        setReview(th.recalc_breakdown);
        if (Array.isArray(th.recalc_breakdown.activities)) setAlloc(th.recalc_breakdown);
        if (th.recalc_breakdown.raw_text) setRawText(th.recalc_breakdown.raw_text);
      }
      // load latest saved plan from the last round
      const last = (d?.rounds || []).slice(-1)[0];
      if (last?.claude_breakdown?.activities) setPlan(last.claude_breakdown);
    } catch { setDetail(null); }
    setLoading(false);
  }, [tid]);
  useEffect(() => { setPlan(null); setTesterResult(null); setAlloc(null); setRawText(''); load(); }, [load]);

  const genBaseline = async () => {
    setBusy('baseline');
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/estimate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, qa_member: ticket.member, submitted_activities: [], use_ai: useAi, persist: false }) });
      const d = r.ok ? await r.json() : null;
      if (d) setPlan({ activities: d.activities, buffer_hours: d.buffer_hours, recommended_total: d.recommended_total, approach_notes: d.approach_notes, automation: d.automation, source: d.source });
    } catch { /* ignore */ }
    setBusy('');
  };
  const savePlan = async () => {
    if (!plan) return;
    setBusy('save');
    try {
      await fetch(`${API_BASE}/qa-estimation/save-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, qa_member: ticket.member, activities: plan.activities, buffer_hours: plan.buffer_hours, approach_notes: plan.approach_notes, trigger, reason }) });
      await load(); onChanged && onChanged();
    } catch { /* ignore */ }
    setBusy('');
  };
  const copyPlan = async () => {
    const txt = planText(tid, plan);
    if (await copyToClipboard(txt)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    else { window.prompt('Copy the plan (Ctrl+C, Enter):', txt); }
  };
  const copyText = async (txt, which) => {
    if (await copyToClipboard(txt)) { setCopiedPm(which); setTimeout(() => setCopiedPm(''), 1600); }
    else { window.prompt('Copy this PM comment (Ctrl+C, Enter):', txt); }
  };
  const downloadExcel = async () => {
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/plan-excel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, activities: plan?.activities || [] }) });
      if (!r.ok) return;
      const blob = await r.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `QA_Plan_${tid}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };
  const runTester = async (persist) => {
    setBusy('tester');
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/estimate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, qa_member: ticket.member, raw_text: testerText, trigger, reason, use_ai: useAi, persist }) });
      const d = r.ok ? await r.json() : null;
      setTesterResult(d);
      if (d?.activities) setPlan({ activities: d.activities, buffer_hours: d.buffer_hours, recommended_total: d.recommended_total, approach_notes: d.approach_notes, automation: d.automation, source: d.source });
      if (persist) { await load(); onChanged && onChanged(); }
    } catch { /* ignore */ }
    setBusy('');
  };
  // Review: parse the tester's raw activity+time log into a per-activity max-allowed table (Claude).
  const allocate = async () => {
    if (!rawText.trim()) return;
    setBusy('recalc');
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/review-allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, raw_text: rawText, qa_comments: qaComments, use_ai: useAi, persist: true }) });
      const d = r.ok ? await r.json() : null;
      if (d) { setAlloc(d); setReview(d); setActual(d.actual_total != null ? String(d.actual_total) : ''); await load(); onChanged && onChanged(); }
    } catch { /* ignore */ }
    setBusy('');
  };
  // Edit one activity's allowed hours; total allowed recomputes from the edited rows.
  const setAllowed = (i, v) => setAlloc(prev => {
    if (!prev) return prev;
    const activities = prev.activities.map((a, j) => j === i ? { ...a, allowed_hours: v } : a);
    const allowed_total = round1(activities.reduce((s, a) => s + (parseFloat(a.allowed_hours) || 0), 0));
    return { ...prev, activities, allowed_total };
  });
  const allocAllowedTotal = alloc ? round1((alloc.activities || []).reduce((s, a) => s + (parseFloat(a.allowed_hours) || 0), 0)) : null;
  // Save the final plan AND submit as reviewed in one action (per design).
  const saveFinal = async () => {
    setBusy('complete');
    try {
      await fetch(`${API_BASE}/qa-estimation/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, manager_comment: comment,
          actual_hours: alloc?.actual_total ?? (actual ? parseFloat(actual) : null),
          qa_comments: rawText || qaComments,
          accepted_estimate: accepted ? parseFloat(accepted) : allocAllowedTotal,
          allocation: alloc?.activities || null }) });
      await load(); onChanged && onChanged();
    } catch { /* ignore */ }
    setBusy('');
  };
  const reopen = async () => {
    setBusy('reopen');
    try { await fetch(`${API_BASE}/qa-estimation/reopen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_id: tid, to_status: 'planning' }) }); await load(); onChanged && onChanged(); }
    catch { /* ignore */ }
    setBusy('');
  };
  const baseline = async (acts, buffer) => {
    setBusy('baseline2');
    try {
      await fetch(`${API_BASE}/qa-estimation/save-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid, qa_member: ticket.member, activities: acts, buffer_hours: buffer || 0, trigger, reason }) });
      await load(); onChanged && onChanged();
    } catch { /* ignore */ }
    setBusy('');
  };

  if (loading) return <div style={{ display: 'grid', gap: 10 }}>{[0, 1, 2].map(i => <div key={i} className="qae-skel" style={{ height: i === 0 ? 56 : 120 }} />)}</div>;
  if (!detail) return <p style={{ color: 'var(--text-muted)' }}>Could not load ticket.</p>;
  const th = detail.thread || {};
  const sig = detail.signals || {};
  const exp = sig.expected || {}, tm = sig.time || {};
  const rounds = detail.rounds || [];
  const status = th.status || 'awaiting';
  const planned = th.suggested_total;
  const actualH = alloc?.actual_total ?? (th.actual_hours != null ? th.actual_hours : (tm.effort_hours || 0));
  const allowed = allocAllowedTotal ?? review?.allowed_total ?? th.recalc_total;
  const ringMax = Math.max(planned || 0, actualH || 0, allowed || 0, 1);
  const rv = review?.verdict ? VERDICT[review.verdict] : null;
  const tv = testerResult?.verdict ? VERDICT[testerResult.verdict] : null;
  const SEC = { borderTop: '1px solid var(--border-color)', paddingTop: 12, marginTop: 12 };
  const H4 = { fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.4px', margin: '0 0 8px' };
  const pm = detail.pm || {}, doc = detail.doc, trd = detail.testrail, rmd = detail.redmine;
  const bt = review?.bug_time;
  const DOC_C = { ALIGNED: '#22c55e', RN_REVIEW: '#f59e0b', PR_NO_RN: '#f59e0b', RN_NO_PR: '#f59e0b', THIN_RN: '#ef4444', NO_PR_NO_RN: '#ef4444', UNKNOWN: '#64748b' };

  return (
    <div className="qae-fade" style={{ display: 'grid', gap: 4, color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <a href={`${PM_TICKET_URL}${tid}`} target="_blank" rel="noreferrer" style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent-teal)' }}>#{tid}</a>
        <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.title}</span>
        <StatusBadge s={status} />
        {status === 'reviewed' && <button className="btn btn-sm btn-secondary" disabled={busy} onClick={reopen}>↺ Reopen</button>}
      </div>
      <div className="qcq-section" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Stepper status={status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: '0.74rem', color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>QA <b style={{ color: 'var(--text-secondary)' }}>{th.qa_member || detail.qc_tester || '—'}</b></span>
          <span>· {detail.test_type}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[detail.current_status] || '#64748b' }} />{detail.current_status}</span>
          {exp.complexity?.level && <ComplexityBadge level={exp.complexity.level} />}
        </div>
      </div>

      {/* PM Estimate & Details */}
      <div className="qcq-section" style={{ padding: 12, ...SEC }}>
        <h4 style={H4}>PM estimate &amp; details</h4>
        <div className="qcq-detail-grid">
          <DRow label="Dev estimate" value={fmtH(pm.dev_estimate_hours)} />
          <DRow label="Dev actual" value={fmtH(pm.actual_dev_hours)} />
          <DRow label="QA estimate" value={fmtH(pm.qa_estimate_hours)} />
          <DRow label="QA actual" value={fmtH(pm.qa_actual_hours)} />
          <DRow label="Priority" value={pm.priority} />
          <DRow label="ETA" value={pm.eta ? new Date(pm.eta).toLocaleDateString('en-US') : '–'} />
          <DRow label="Assignee" value={pm.current_assignee} />
          <DRow label="Developers" value={[pm.backend_developer, pm.frontend_developer].filter(Boolean).join(', ') || '–'} />
        </div>
      </div>

      {/* PLAN — two modes */}
      {status !== 'reviewed' && (
        <div className="qcq-section" style={{ padding: 12, ...SEC }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <h4 style={{ ...H4, margin: 0 }}>① Plan (Staging → Pre → Live)</h4>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              {[['claude', "Use Claude's plan"], ['propose', 'Propose my own']].map(([m, lbl]) => (
                <button key={m} className="qae-tab" onClick={() => setPlanMode(m)} style={{ padding: '4px 12px', borderRadius: 7, fontSize: '0.72rem', fontWeight: 700, border: `1px solid ${planMode === m ? 'var(--accent-teal)' : 'var(--border-color)'}`, background: planMode === m ? 'rgba(20,184,166,0.12)' : 'transparent', color: planMode === m ? 'var(--accent-teal)' : 'var(--text-muted)' }}>{lbl}</button>
              ))}
            </div>
          </div>

          {planMode === 'claude' ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" disabled={busy === 'baseline'} onClick={genBaseline}>{busy === 'baseline' ? '…' : '✨ Generate baseline (Claude)'}</button>
                <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} /> AI</label>
                {plan && <>
                  <button className="btn btn-sm btn-secondary" onClick={copyPlan} style={{ marginLeft: 'auto' }}>{copied ? '✓ Copied' : '⧉ Copy plan'}</button>
                  <button className="btn btn-sm btn-secondary" title="Short justification to paste in PM when adding the planned QA time"
                    onClick={() => copyText(pmPlanComment(tid, plan, ticket), 'plan')}>{copiedPm === 'plan' ? '✓ Copied' : '⧉ PM time comment'}</button>
                  <button className="btn btn-sm btn-secondary" onClick={downloadExcel}>⬇ Excel</button>
                  <button className="btn btn-sm btn-primary" disabled={busy === 'save'} onClick={savePlan}>{busy === 'save' ? '…' : '💾 Baseline plan'}</button>
                </>}
              </div>
              {plan ? <PlanEditor plan={plan} setPlan={setPlan} />
                : <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Generate Claude's baseline plan, edit time/activities as needed, then baseline it.</p>}
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>Paste the proposed plan in any format. Claude reviews it; compare and baseline either.</div>
              <textarea style={{ ...inp, width: '100%', minHeight: 76 }} placeholder={'e.g. Data setup 4h, functional staging 8h, regression pre 4h, retest 2h, live sanity 1h…'} value={testerText} onChange={e => setTesterText(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                {sel(trigger, setTrigger, TRIGGERS, null, { width: 150 })}
                <input style={{ ...inp, flex: 1, minWidth: 140 }} placeholder="Reason (scope / bugs…)" value={reason} onChange={e => setReason(e.target.value)} />
                <button className="btn btn-sm btn-secondary" disabled={busy === 'tester' || !testerText.trim()} onClick={() => runTester(false)}>{busy === 'tester' ? '…' : 'Run Claude review'}</button>
              </div>
              {testerResult && (
                <div className="qae-pop" style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                      <div style={{ ...PLBL_LOCAL }}>Proposed (tester)</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{fmtH(testerResult.submitted_total)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{(testerResult.submitted_activities || []).map(a => `${a.activity} ${(+a.hours || 0).toFixed(1)}h`).join(' · ') || 'parsed from text'}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 10, background: 'rgba(20,184,166,0.08)', border: '1px solid var(--accent-teal)' }}>
                      <div style={{ ...PLBL_LOCAL, color: 'var(--accent-teal)' }}>Claude recommends</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-teal)' }}>{fmtH(testerResult.recommended_total)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{(testerResult.activities || []).length} step(s), ordered Staging→Pre→Live</div>
                    </div>
                  </div>
                  {tv && <div style={{ marginTop: 6, fontWeight: 700, color: tv.c }}>{tv.t} — <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>{testerResult.summary}</span></div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-primary" disabled={busy === 'baseline2'} onClick={() => baseline(testerResult.activities, testerResult.buffer_hours)}>Baseline Claude's</button>
                    <button className="btn btn-sm btn-secondary" disabled={busy === 'baseline2'} onClick={() => baseline((testerResult.submitted_activities || []).map(a => ({ activity: a.activity, environment: 'Staging', phase: 'functional', suggested_hours: a.hours })), 0)}>Baseline proposed</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => { if (testerResult.activities) { setPlan({ activities: testerResult.activities, buffer_hours: testerResult.buffer_hours, recommended_total: testerResult.recommended_total, approach_notes: testerResult.approach_notes, automation: testerResult.automation, source: testerResult.source }); setPlanMode('claude'); } }}>Edit Claude's first</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* RN ↔ PR comparison */}
      {doc && (
        <div className="qcq-section" style={{ padding: 12, ...SEC }}>
          <h4 style={H4}>RN ↔ PR comparison</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 9px', borderRadius: 20, color: '#fff', background: DOC_C[doc.flag] || '#64748b' }}>{doc.flag || 'UNKNOWN'}</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{doc.summary}</span>
          </div>
          <div className="qcq-detail-grid" style={{ marginTop: 6 }}>
            <DRow label="PR present" value={doc.pr_present ? 'Yes' : 'No'} />
            <DRow label="Release note" value={doc.rn_present ? 'Yes' : 'No'} />
            {doc.functional_total != null && <DRow label="Functional files" value={doc.functional_total} />}
            {doc.unexplained?.length > 0 && <DRow label="Undocumented" value={`${doc.unexplained.length} file(s)`} color="var(--accent-red)" />}
          </div>
          {doc.unexplained?.length > 0 && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>{doc.unexplained.slice(0, 8).join(', ')}</div>}
        </div>
      )}

      {/* TestRail */}
      {trd && (
        <div className="qcq-section" style={{ padding: 12, ...SEC }}>
          <h4 style={H4}>TestRail {trd.plan_url && <a href={trd.plan_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.66rem', color: 'var(--accent-teal)', fontWeight: 600 }}>open plan ↗</a>}</h4>
          <div className="qcq-detail-grid">
            <DRow label="Total cases" value={trd.cases ?? '–'} />
            <DRow label="Manual / Automated" value={`${trd.manual ?? '?'} / ${trd.automated ?? '?'}`} />
            <DRow label="Passed" value={trd.passed ?? 0} color="var(--accent-green)" />
            <DRow label="Failed" value={trd.failed ?? 0} color="var(--accent-red)" />
            <DRow label="Untested" value={trd.untested ?? 0} />
            <DRow label="Blocked / Retest" value={`${trd.blocked ?? 0} / ${trd.retest ?? 0}`} />
          </div>
        </div>
      )}

      {/* Redmine — bug detail with graphs */}
      {rmd && (
        <div className="qcq-section" style={{ padding: 12, ...SEC }}>
          <h4 style={H4}>Redmine bugs ({rmd.total ?? 0})</h4>
          {rmd.total > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <BugBars title="By status" data={rmd.by_status} cat="status" />
              <BugBars title="By severity" data={rmd.by_severity} cat="severity" />
              <BugBars title="By environment" data={rmd.by_env} cat="env" />
            </div>
          ) : <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No bugs reported.</span>}
        </div>
      )}

      {/* History */}
      {rounds.length > 0 && (
        <div className="qcq-section" style={{ padding: 12, ...SEC }}>
          <h4 style={H4}>Estimate history ({rounds.length})</h4>
          {rounds.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border-color)', fontSize: '0.76rem' }}>
              <b style={{ minWidth: 22 }}>#{r.round_no}</b>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', minWidth: 84 }}>{r.trigger}</span>
              <span>{r.submitted_total != null ? `submitted ${fmtH(r.submitted_total)} → ` : ''}<b style={{ color: 'var(--accent-teal)' }}>{fmtH(r.suggested_total)}</b></span>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{(r.created_on || '').slice(0, 16).replace('T', ' ')}</span>
              {r.pushed_to_pm
                ? <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: 'var(--accent-green)' }}>✓ pushed {fmtH(r.pushed_estimate)}</span>
                : <button style={{ ...inp, marginLeft: 'auto', cursor: 'pointer', padding: '2px 8px', fontSize: '0.68rem' }} disabled={busy} onClick={async () => { await fetch(`${API_BASE}/qa-estimation/mark-pushed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_id: tid, round_id: r.id, pushed_estimate: r.suggested_total }) }); await load(); onChanged && onChanged(); }}>Push to PM</button>}
            </div>
          ))}
        </div>
      )}

      {/* REVIEW */}
      <div className="qcq-section" style={{ padding: 12, ...SEC }}>
        <h4 style={H4}>③ Review — actuals & recalculation</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <textarea style={{ ...inp, width: '100%', minHeight: 78 }}
            placeholder="Paste the tester's actual activities & time split (raw — e.g. 'Functional testing 4h, Regression 2.5h, Bug retest 45min…'). Claude splits it and sets a max-allowed per activity."
            value={rawText} onChange={e => setRawText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...inp, flex: 1, minWidth: 160 }} placeholder="Optional note (scope grew, blockers…)" value={qaComments} onChange={e => setQaComments(e.target.value)} />
            <button className="btn btn-sm btn-secondary" disabled={busy === 'recalc' || !rawText.trim()} onClick={allocate}>{busy === 'recalc' ? '…' : '✨ Analyze activities (Claude)'}</button>
            <button className="btn btn-sm btn-secondary" disabled={!alloc || !(alloc.activities || []).length} title="Per-activity time-edit justification to paste in PM"
              onClick={() => copyText(pmAllocComment(tid, alloc), 'review')}>{copiedPm === 'review' ? '✓ Copied' : '⧉ PM time comment'}</button>
          </div>
        </div>
        {alloc && (alloc.activities || []).length > 0 && (
          <div className="qae-pop" style={{ marginBottom: 8 }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>Activity</th>
                <th style={{ padding: '4px 6px', width: 70, textAlign: 'right' }}>Actual</th>
                <th style={{ padding: '4px 6px', width: 100, textAlign: 'right' }}>Max allowed</th>
                <th style={{ padding: '4px 6px' }}>Why</th>
              </tr></thead>
              <tbody>
                {alloc.activities.map((a, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '4px 6px' }}>{a.activity}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtH(a.actual_hours)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                      <input type="number" step="0.1" value={a.allowed_hours} onChange={e => setAllowed(i, e.target.value)}
                        style={{ ...inp, width: 66, textAlign: 'right', padding: '2px 6px' }} /></td>
                    <td style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{a.rationale}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                <td style={{ padding: '4px 6px' }}>Total</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtH(alloc.actual_total)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--accent-green)' }}>{fmtH(allocAllowedTotal)}</td>
                <td />
              </tr></tfoot>
            </table>
            {alloc.source === 'rule' && <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4 }}>Parsed without AI — review the allowed values.</div>}
          </div>
        )}
        {review && (
          <div className="qae-pop">
            <div style={{ display: 'flex', justifyContent: 'center', gap: 22 }}>
              <Ring value={planned} max={ringMax} label="Planned" color="#14b8a6" />
              <Ring value={actualH} max={ringMax} label="Actual" color="#a855f7" />
              <Ring value={allowed} max={ringMax} label="Allowed" color={rv?.c || '#22c55e'} />
            </div>
            {rv && <div style={{ textAlign: 'center', fontWeight: 700, color: rv.c }}>{rv.t}</div>}
            {bt && bt.total > 0 && (
              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                + {fmtH(bt.total)} for {bt.bugs} bug(s): reporting {fmtH(bt.reporting)}
                {bt.report_rate_min != null && <span> @ {bt.report_rate_min}min/bug</span>}
                {bt.report_basis === 'tool_measured' && (
                  <span title="Reporting time measured from the BIS Bug Reporter for this ticket"
                    style={{ marginLeft: 4, padding: '0 5px', borderRadius: 8, fontSize: '0.64rem', fontWeight: 700,
                      background: 'rgba(20,184,166,0.16)', color: 'var(--accent-teal)' }}>🐞 Bug Reporter</span>
                )}
                {' '}· retest {fmtH(bt.retest)} · regression {fmtH(bt.regression)}
              </div>
            )}
            {review.bug_reporter && (
              <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 1 }}>
                Bug Reporter on #{tid}: {review.bug_reporter.bugs} filed
                {review.bug_reporter.avg_tool_minutes != null && <span> · avg {review.bug_reporter.avg_tool_minutes}min in-tool</span>}
                {review.bug_reporter.testrail_coupled > 0 && <span> · {review.bug_reporter.testrail_coupled} TestRail-linked</span>}
                {review.bug_reporter.saved_minutes > 0 && <span> · saved {fmtH(review.bug_reporter.saved_minutes / 60)}</span>}
              </div>
            )}
            <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>{review.summary}</div>
          </div>
        )}
      </div>

      {/* SIGN-OFF */}
      <div className="qcq-section" style={{ padding: 12, ...SEC, borderLeft: `3px solid ${status === 'reviewed' ? 'var(--accent-green)' : 'var(--accent-teal)'}` }}>
        <h4 style={H4}>④ Manager review & sign-off</h4>
        {status === 'reviewed' ? (
          <div>
            <b style={{ color: 'var(--accent-green)' }}>✓ Reviewed & completed</b>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}> by {th.reviewed_by} on {(th.reviewed_on || '').slice(0, 10)} · allowed {fmtH(th.recalc_total ?? th.suggested_total)}</span>
            {th.manager_comment && <div style={{ fontSize: '0.82rem', marginTop: 6 }}>{th.manager_comment}</div>}
          </div>
        ) : (
          <>
            <textarea style={{ ...inp, width: '100%', minHeight: 52 }} placeholder="Manager review comment" value={comment} onChange={e => setComment(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <input style={{ ...inp, width: 160 }} type="number" step="0.5" placeholder={`Accepted hrs (${fmtH(allocAllowedTotal ?? allowed ?? planned)})`} value={accepted} onChange={e => setAccepted(e.target.value)} />
              <button className="btn btn-sm btn-primary" disabled={busy === 'complete'} onClick={saveFinal}>{busy === 'complete' ? '…' : '💾 Save final plan & submit reviewed'}</button>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>saves the per-activity allowed + feeds the performance matrix · reopenable anytime</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TicketEstimation() {
  const [period, setPeriod] = useState('60d');
  const [tab, setTab] = useState('active');
  const [testType, setTestType] = useState('web');
  const [status, setStatus] = useState('all');
  const [tester, setTester] = useState('');
  const [module, setModule] = useState('');
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [qcStatus, setQcStatus] = useState(null);
  const [slice, setSlice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ period, tab, status });
      if (tab !== 'reviewed') qs.set('test_type', testType);
      if (tester) qs.set('qc_tester', tester);
      if (module) qs.set('module', module);
      if (search.trim()) qs.set('search', search.trim());
      const r = await fetch(`${API_BASE}/qa-estimation/board?${qs}`);
      setBoard(r.ok ? await r.json() : null);
    } catch { setBoard(null); }
    setLoading(false);
  }, [period, tab, testType, status, tester, module, search]);
  useEffect(() => { load(); }, [load]);

  const allTickets = useMemo(() => board?.tickets || [], [board]);
  const totals = board?.summary?.totals || {};
  const testerOpts = useMemo(() => (board?.summary?.by_tester || []).map(t => ({ value: t.name, label: t.name })), [board]);
  const moduleOpts = useMemo(() => (board?.summary?.by_module || []).map(m => ({ value: m.module, label: m.module })), [board]);
  const statusGroups = useMemo(() => {
    const counts = {};
    allTickets.forEach(t => { counts[t.current_status] = (counts[t.current_status] || 0) + 1; });
    const known = QC_STATUS.filter(s => counts[s.k]).map(s => ({ ...s, count: counts[s.k] }));
    const others = Object.keys(counts).filter(k => !QC_STATUS.some(s => s.k === k)).map(k => ({ k, count: counts[k] }));
    return [...known, ...others];
  }, [allTickets]);
  const testerGroups = useMemo(() => {
    const counts = {};
    allTickets.forEach(t => { const m = t.member || 'Unassigned'; counts[m] = (counts[m] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [allTickets]);
  const tickets = useMemo(() => allTickets.filter(t => (!qcStatus || t.current_status === qcStatus) && (!slice || (t.member || 'Unassigned') === slice)), [allTickets, qcStatus, slice]);
  const searchNum = /^#?\d{3,7}$/.test(search.trim()) ? search.trim().replace('#', '') : null;

  const exportXlsx = async () => {
    const qs = new URLSearchParams({ period, status });
    if (tester) qs.set('qc_tester', tester);
    if (module) qs.set('module', module);
    const res = await fetch(`${API_BASE}/qa-estimation/export-xlsx?${qs}`);
    if (!res.ok) return;
    const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'QA_PlanningReview.xlsx';
    document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
  };

  const TabBtn = ({ id, label, count }) => (
    <button className="qae-tab" onClick={() => { setTab(id); setOpen(null); }} style={{ padding: '7px 16px', borderRadius: 9, fontWeight: 700, fontSize: '0.82rem', border: '1px solid var(--border-color)', background: tab === id ? 'var(--accent-teal, #14b8a6)' : 'transparent', color: tab === id ? '#fff' : 'var(--text-secondary)', boxShadow: tab === id ? '0 4px 14px rgba(20,184,166,0.3)' : 'none' }}>{label}{count != null ? ` · ${count}` : ''}</button>
  );
  const PillBtn = ({ id, label, on, set }) => (
    <button className="qae-tab" onClick={() => { set(id); setOpen(null); }} style={{ padding: '5px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.76rem', border: `1px solid ${on === id ? 'var(--accent-teal)' : 'var(--border-color)'}`, background: on === id ? 'var(--bg-secondary)' : 'transparent', color: on === id ? 'var(--accent-teal)' : 'var(--text-muted)' }}>{label}</button>
  );

  return (
    <div className="dashboard">
      <style>{CSS}</style>
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>QA Planning &amp; Review</h1>
            <p className="header-subtitle">Plan → review → reviewed, per ticket. Find by employee name or ticket id, estimate, recalc on actuals, sign off.</p>
          </div>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <TabBtn id="active" label="Active" count={(totals.awaiting || 0) + (totals.planning || 0) + (totals.in_review || 0)} />
          <TabBtn id="reviewed" label="Reviewed" count={totals.reviewed} />
          {tab === 'active' && <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            <PillBtn id="web" label="🌐 Web" on={testType} set={setTestType} />
            <PillBtn id="mobile" label="📱 Mobile" on={testType} set={setTestType} />
          </div>}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={exportXlsx}>⬇ Export</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {sel(period, setPeriod, [{ value: '30d', label: 'Last 30 days' }, { value: '60d', label: 'Last 60 days' }, { value: '90d', label: 'Last 90 days' }, { value: '180d', label: 'Last 180 days' }, { value: 'all', label: 'All time' }])}
          {sel(status, setStatus, [{ value: 'all', label: 'All workflow' }, { value: 'awaiting', label: 'Awaiting' }, { value: 'planning', label: 'Planning' }, { value: 'in_review', label: 'In review' }, { value: 'reviewed', label: 'Reviewed' }])}
          {sel(tester, setTester, testerOpts, '🔎 All testers')}
          {sel(module, setModule, moduleOpts, 'All modules')}
          <input style={{ ...inp, minWidth: 170 }} type="search" placeholder="Search #ticket / title" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && searchNum) setOpen({ ticket_id: +searchNum, member: '' }); }} />
          {searchNum && <button className="btn btn-sm btn-primary" onClick={() => setOpen({ ticket_id: +searchNum, member: '' })}>Open #{searchNum} →</button>}
        </div>

        <QcStatusCards groups={statusGroups} active={qcStatus} onSelect={setQcStatus} />
        {(qcStatus || slice) && <div style={{ marginBottom: 10, fontSize: '0.74rem', color: 'var(--text-muted)' }}>Filtered{qcStatus ? ` · status: ${qcStatus}` : ''}{slice ? ` · tester: ${slice}` : ''}<button onClick={() => { setQcStatus(null); setSlice(null); }} style={{ ...inp, marginLeft: 8, cursor: 'pointer', padding: '2px 8px', fontSize: '0.7rem' }}>clear</button></div>}

        <TesterDonut groups={testerGroups} active={slice} onSelect={setSlice} />

        <div className="qcq-table-container" style={{ marginTop: 12 }}>
          <table className="qcq-table">
            <thead><tr>
              <th>Ticket</th><th style={{ textAlign: 'left' }}>Title</th><th>QC Tester</th><th>Module</th><th>Complexity</th>
              <th>QC Status</th><th>Stage</th><th>Planned</th><th>Actual</th><th>Allowed</th><th>Rounds</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={11} style={{ padding: 16 }}><div className="qae-skel" style={{ height: 120 }} /></td></tr>
                : tickets.length ? tickets.map(t => {
                  const sc = STATUS_COLOR[t.current_status] || '#64748b';
                  return (
                    <tr key={t.ticket_id} className="qae-fade" style={{ cursor: 'pointer' }} onClick={() => setOpen(t)}>
                      <td style={{ fontWeight: 700 }}>#{t.ticket_id}</td>
                      <td style={{ textAlign: 'left', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</td>
                      <td>{t.member}</td>
                      <td style={{ fontSize: '0.78rem' }}>{t.module}</td>
                      <td>{t.complexity?.level ? <ComplexityBadge level={t.complexity.level} /> : '–'}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: sc }} />{t.current_status}</span></td>
                      <td><StatusBadge s={t.est_status} /></td>
                      <td style={{ fontWeight: 700, color: 'var(--accent-teal)' }}>{t.suggested_total != null ? fmtH(t.suggested_total) : '–'}</td>
                      <td>{t.actual_hours != null ? fmtH(t.actual_hours) : '–'}</td>
                      <td style={{ fontWeight: 700 }}>{t.recalc_total != null ? fmtH(t.recalc_total) : '–'}</td>
                      <td>{t.rounds || '–'}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={11} className="qcq-empty" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No tickets.</td></tr>}
            </tbody>
          </table>
        </div>

        {open && (
          <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.66)', backdropFilter: 'blur(2px)', zIndex: 100001, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '3vh 0' }}>
            <div onClick={e => e.stopPropagation()} className="qae-pop" style={{ width: 'min(1040px, 96vw)', maxHeight: '94vh', overflowY: 'auto', background: 'var(--bg-card, #1e293b)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button onClick={() => setOpen(null)} title="Close" style={{ ...inp, cursor: 'pointer', padding: '3px 10px', fontWeight: 700 }}>✕</button>
              </div>
              <DetailPanel key={open.ticket_id} ticket={open} onChanged={load} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
