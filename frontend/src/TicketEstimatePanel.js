import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';

// Shared QA-Estimation "Plan" panel. Used by BOTH the QA Estimation & Review page (TicketEstimation.js)
// and the QC Queue's inline "⏱ Estimate" popup, so the initial-estimate flow is identical in both places
// (same activity/time split-up, same PM comment, same endpoints). Review/revision still happens only in
// the QA Estimation module — this panel exposes just the Plan phase.

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const fmtH = (h) => (h == null ? '–' : `${(+h).toFixed(1)}h`);
const ENV_OPTS = ['Staging', 'Pre', 'Live'];
const ENV_META = { Staging: '#3b82f6', Pre: '#a855f7', Live: '#22c55e' };
const VERDICT = {
  justified: { t: 'Justified', c: '#22c55e' }, partially_justified: { t: 'Partially justified', c: '#f59e0b' },
  over_asked: { t: 'Over-asked', c: '#ef4444' }, within_allowed: { t: 'Within allowed', c: '#22c55e' },
  slight_overrun: { t: 'Slight overrun', c: '#f59e0b' }, over_allowed: { t: 'Over allowed', c: '#ef4444' },
};
const inp = { padding: '6px 8px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.8rem' };
const sel = (v, onChange, opts, ph, style) => (
  <select value={v} onChange={e => onChange(e.target.value)} style={{ ...inp, ...style }}>
    {ph && <option value="">{ph}</option>}
    {opts.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

// Clipboard that also works on the dashboard's plain-HTTP origin (http://10.1.0.20), where
// navigator.clipboard is unavailable (not a secure context). Falls back to a hidden textarea + execCommand.
const copyToClipboard = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.left = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
};

// Editable, ordered, per-environment plan (Staging → Pre → Live). Used for baseline + saved plan.
export function PlanEditor({ plan, setPlan }) {
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

// Clean, aligned, copy-pasteable plan (dot-leader alignment; reads well in PM/Teams/email).
export const planText = (tid, plan) => {
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

// Short justification to paste into PM when adding the PLANNED QA time.
export const pmPlanComment = (tid, plan, ticket) => {
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

export { copyToClipboard };

// ── The shared Plan panel (generate baseline → edit → save initial estimate → copy PM comment) ──
export default function TicketEstimatePanel({ ticketId, qaMember, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [member, setMember] = useState(qaMember || '');
  const [useAi, setUseAi] = useState(true);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/${ticketId}?light=true`);
      const d = r.ok ? await r.json() : null;
      setDetail(d);
      if (!qaMember) setMember(d?.qc_tester || d?.thread?.qa_member || '');
      const last = (d?.rounds || []).slice(-1)[0];
      if (last?.claude_breakdown?.activities) setPlan(last.claude_breakdown);
      else setPlan(null);
    } catch { setDetail(null); }
    setLoading(false);
  }, [ticketId, qaMember]);
  useEffect(() => { setSaved(false); load(); }, [load]);

  const genBaseline = async () => {
    setBusy('baseline');
    try {
      const r = await fetch(`${API_BASE}/qa-estimation/estimate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, qa_member: member, submitted_activities: [], use_ai: useAi, persist: false }) });
      const d = r.ok ? await r.json() : null;
      if (d) setPlan({ activities: d.activities, buffer_hours: d.buffer_hours, recommended_total: d.recommended_total, approach_notes: d.approach_notes, automation: d.automation, source: d.source });
    } catch { /* ignore */ }
    setBusy('');
  };
  const savePlan = async () => {
    if (!plan || !member.trim()) return;
    setBusy('save');
    try {
      await fetch(`${API_BASE}/qa-estimation/save-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, qa_member: member.trim(), activities: plan.activities, buffer_hours: plan.buffer_hours, approach_notes: plan.approach_notes, trigger: 'initial', reason }) });
      setSaved(true); await load(); onSaved && onSaved();
    } catch { /* ignore */ }
    setBusy('');
  };
  const doCopy = async (txt, which) => {
    if (await copyToClipboard(txt)) { setCopied(which); setTimeout(() => setCopied(''), 1600); }
    else window.prompt('Copy (Ctrl+C, Enter):', txt);
  };

  const ticketObj = { module: detail?.module || detail?.test_type, test_type: detail?.test_type };
  const total = plan ? round1((plan.activities || []).reduce((a, x) => a + (parseFloat(x.suggested_hours) || 0), 0) + (plan.buffer_hours || 0)) : null;
  const status = detail?.thread?.status;

  if (loading) return <div className="qae-skel" style={{ height: 160 }} />;

  return (
    <div style={{ color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: '0.9rem' }}>#{ticketId}</strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail?.title || ''}</span>
        {status && status !== 'planning' && status !== 'awaiting' && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>· {status} (revise/review in the QA Estimation module)</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>QA member</span>
          <input value={member} onChange={e => setMember(e.target.value)} placeholder="assign / type name"
            style={{ ...inp, width: 150, padding: '4px 7px' }} />
        </span>
      </div>

      {!plan ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 4px' }}>
          <button className="btn btn-primary" onClick={genBaseline} disabled={busy === 'baseline'}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent-teal, #14b8a6)', color: '#fff', fontWeight: 600 }}>
            {busy === 'baseline' ? '⏳ Generating…' : '✨ Generate estimate (Claude)'}
          </button>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} /> use AI
          </label>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Generates the activity + time split-up for the initial estimate.</span>
        </div>
      ) : (
        <>
          <PlanEditor plan={plan} setPlan={setPlan} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={savePlan} disabled={busy === 'save' || !member.trim()}
              title={!member.trim() ? 'Assign a QA member first' : 'Save this as the initial estimate (Planning)'}
              style={{ padding: '7px 15px', borderRadius: 8, border: 'none', cursor: member.trim() ? 'pointer' : 'default',
                opacity: member.trim() ? 1 : 0.6, background: saved ? '#16a34a' : 'var(--accent-teal, #14b8a6)', color: '#fff', fontWeight: 600 }}>
              {busy === 'save' ? '⏳ Saving…' : saved ? '✓ Saved' : '💾 Save initial estimate'}
            </button>
            <button className="btn btn-secondary" onClick={() => doCopy(pmPlanComment(ticketId, plan, ticketObj), 'pm')}
              style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>
              {copied === 'pm' ? '✓ Copied' : '📋 Copy PM comment'}
            </button>
            <button className="btn btn-secondary" onClick={() => doCopy(planText(ticketId, plan), 'plan')}
              style={{ ...inp, cursor: 'pointer' }}>
              {copied === 'plan' ? '✓ Copied' : '📄 Copy plan'}
            </button>
            <button onClick={genBaseline} disabled={busy === 'baseline'} title="Regenerate from Claude (discards edits)"
              style={{ ...inp, cursor: 'pointer', marginLeft: 'auto', fontSize: '0.72rem' }}>
              {busy === 'baseline' ? '⏳' : '↻ Regenerate'}
            </button>
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason / note (optional)"
            style={{ ...inp, width: '100%', marginTop: 8, padding: '5px 8px', fontSize: '0.76rem' }} />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Paste the PM comment to record the initial estimate in PM. Revise the time & fully review from the QA Estimation & Review module.
          </div>
        </>
      )}
    </div>
  );
}
