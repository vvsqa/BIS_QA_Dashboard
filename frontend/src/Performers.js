import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './api';

const CATEGORIES = [
  { value: 'qa', label: 'QA' },
  { value: 'dev', label: 'Development' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'overall', label: 'Overall' },
];
const CAT_COLOR = {
  qa: 'var(--accent-teal, #14b8a6)', dev: 'var(--accent-blue, #3b82f6)',
  mobile: 'var(--accent-purple, #8b5cf6)', overall: 'var(--accent-amber, #f59e0b)',
};

function quarterOptions(n = 8) {
  const now = new Date();
  const qNow = Math.floor(now.getMonth() / 3);
  const idxNow = now.getFullYear() * 4 + qNow;
  const opts = [];
  for (let k = 0; k < n; k++) {
    const idx = idxNow - k;
    const year = Math.floor(idx / 4);
    const q = idx % 4;
    opts.push({ offset: k, label: `Q${q + 1} ${year}` });
  }
  return opts;
}
function monthOptions(n = 18) {
  const now = new Date();
  const opts = [];
  for (let k = 0; k < n; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    opts.push({ offset: k, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return opts;
}

const blankForm = { period_type: 'quarter', offset: 0, category: 'qa', employee_id: null,
  employee_name: '', team: '', role: '', composite_score: null, rank: null, team_size: null,
  summary: '', metrics: null };

export default function PerformersPanel() {
  const [data, setData] = useState({ quarter: [], month: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [candidates, setCandidates] = useState([]);
  const [periodInfo, setPeriodInfo] = useState(null);
  const [candLoading, setCandLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/performers');
      if (res.ok) setData(await res.json());
    } catch (e) { /* noop */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const candReq = useRef(0);
  const loadCandidates = useCallback(async (period_type, offset, category, keepSummary) => {
    const myReq = ++candReq.current;   // guard: only the latest request may update state
    setCandLoading(true);
    try {
      const res = await apiFetch(`/performers/candidates?period_type=${period_type}&offset=${offset}&category=${category}`);
      if (myReq !== candReq.current) return;   // a newer period/category request superseded this one
      if (res.ok) {
        const j = await res.json();
        if (myReq !== candReq.current) return;
        setCandidates(j.candidates || []);
        setPeriodInfo({ label: j.period_label, key: j.period_key, ended: j.period_ended });
        if (!keepSummary && (j.candidates || []).length) {
          const top = j.candidates[0];
          setForm(f => ({ ...f, employee_id: top.employee_id, employee_name: top.name, team: top.team,
            role: top.role, composite_score: top.composite_score, rank: top.rank,
            team_size: top.team_size, summary: top.summary, metrics: top.raw_metrics }));
        }
      }
    } catch (e) { /* noop */ }
    if (myReq === candReq.current) setCandLoading(false);
  }, []);

  const openNew = () => {
    setForm(blankForm); setMsg('');
    setShowForm(true);
    loadCandidates('quarter', 0, 'qa', false);
  };
  const openEdit = (rec) => {
    setForm({ period_type: rec.period_type, offset: 0, category: rec.category,
      employee_id: rec.employee_id, employee_name: rec.employee_name, team: rec.team, role: rec.role,
      composite_score: rec.composite_score, rank: rec.rank, team_size: rec.team_size,
      summary: rec.summary || '', metrics: null, _offsetByLabel: rec.period_label });
    setMsg(''); setShowForm(true);
    // resolve offset from label
    const opts = rec.period_type === 'quarter' ? quarterOptions() : monthOptions();
    const found = opts.find(o => o.label === rec.period_label);
    const off = found ? found.offset : 0;
    setForm(f => ({ ...f, offset: off }));
    loadCandidates(rec.period_type, off, rec.category, true);
  };

  const onPeriodChange = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    loadCandidates(next.period_type, next.offset, next.category, false);
  };
  const onPickCandidate = (empId) => {
    const c = candidates.find(x => String(x.employee_id) === String(empId));
    if (c) setForm(f => ({ ...f, employee_id: c.employee_id, employee_name: c.name, team: c.team,
      role: c.role, composite_score: c.composite_score, rank: c.rank, team_size: c.team_size,
      summary: c.summary, metrics: c.raw_metrics }));
  };

  const save = async (freeze) => {
    if (!form.employee_name) { setMsg('Pick a performer first.'); return; }
    setSaving(true); setMsg('');
    try {
      const res = await apiFetch('/performers', { method: 'POST', body: JSON.stringify({
        period_type: form.period_type, offset: form.offset, category: form.category,
        employee_id: form.employee_id ? String(form.employee_id) : null, employee_name: form.employee_name,
        team: form.team, role: form.role, composite_score: form.composite_score, rank: form.rank,
        team_size: form.team_size, summary: form.summary, metrics: form.metrics, freeze }) });
      if (res.ok) { setShowForm(false); await load(); }
      else if (res.status === 401 || res.status === 403) { setMsg('Your session expired — please log in again, then retry.'); }
      else { const e = await res.json().catch(() => ({})); setMsg(e.detail || 'Save failed.'); }
    } catch (e) { setMsg(e.message === 'Unauthorized' ? 'Your session expired — please log in again, then retry.' : 'Save failed.'); }
    setSaving(false);
  };

  const doFreeze = async (id) => {
    if (!window.confirm('Freeze this record? Once frozen it becomes the official, locked result for the period.')) return;
    const res = await apiFetch(`/performers/${id}/freeze`, { method: 'POST' });
    if (res.ok) load();
  };
  const doDelete = async (id) => {
    if (!window.confirm('Delete this draft record?')) return;
    const res = await apiFetch(`/performers/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  };

  const periodOpts = form.period_type === 'quarter' ? quarterOptions() : monthOptions();

  const Card = ({ r }) => (
    <div style={{ background: 'var(--bg-secondary)', border: `1px solid ${r.frozen ? CAT_COLOR[r.category] : 'var(--border-color)'}`,
      borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ padding: '2px 9px', borderRadius: 5, fontSize: '0.7rem', fontWeight: 700,
          background: `${CAT_COLOR[r.category]}1a`, color: CAT_COLOR[r.category], border: `1px solid ${CAT_COLOR[r.category]}` }}>
          {r.category_label}
        </span>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{r.employee_name}</span>
        {r.rank && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>#{r.rank} of {r.team_size} · score {r.composite_score}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {r.frozen ? (
            <span title={`Frozen${r.frozen_on ? ' ' + new Date(r.frozen_on).toLocaleDateString() : ''}`}
              style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-green, #22c55e)' }}>🔒 Frozen</span>
          ) : (
            <>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-amber, #f59e0b)' }}>● Draft</span>
              <button className="btn btn-sm btn-secondary" onClick={() => openEdit(r)} style={{ fontSize: '0.7rem' }}>Edit</button>
              <button className="btn btn-sm btn-primary" onClick={() => doFreeze(r.id)} style={{ fontSize: '0.7rem' }}>Freeze</button>
              <button className="btn btn-sm btn-secondary" onClick={() => doDelete(r.id)} style={{ fontSize: '0.7rem', color: 'var(--accent-red)' }}>Delete</button>
            </>
          )}
        </span>
      </div>
      {r.role && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.role}{r.team ? ` · ${r.team}` : ''}</div>}
      {r.summary && <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{r.summary}</div>}
    </div>
  );

  const Section = ({ title, rows }) => {
    // group by period_label preserving order
    const groups = [];
    const seen = {};
    rows.forEach(r => { if (!seen[r.period_label]) { seen[r.period_label] = []; groups.push([r.period_label, seen[r.period_label]]); } seen[r.period_label].push(r); });
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 10px' }}>{title}</h3>
        {groups.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No records yet.</p>}
        {groups.map(([label, rs]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' }}>{label}</div>
            {rs.map(r => <Card key={r.id} r={r} />)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="qcq-section">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Performers — Hall of Record</h2>
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Performer of the Month &amp; Quarter, per category. Freeze to lock a period as the official record.
          </p>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openNew}>+ Record a performer</button>
      </div>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /><p>Loading…</p></div>
      ) : (
        <>
          <Section title="🏆 Quarterly" rows={data.quarter} />
          <Section title="📅 Monthly" rows={data.month} />
        </>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' }}
          onClick={() => setShowForm(false)}>
          <div style={{ background: 'var(--bg-primary, #0f172a)', border: '1px solid var(--border-color)', borderRadius: 12,
            width: 'min(720px, 100%)', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Record a performer</h3>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Type
                <select className="qcq-search-input" value={form.period_type}
                  onChange={e => onPeriodChange({ period_type: e.target.value, offset: 0 })}
                  style={{ display: 'block', marginTop: 3 }}>
                  <option value="quarter">Quarter</option>
                  <option value="month">Month</option>
                </select>
              </label>
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Period
                <select className="qcq-search-input" value={form.offset}
                  onChange={e => onPeriodChange({ offset: Number(e.target.value) })}
                  style={{ display: 'block', marginTop: 3 }}>
                  {periodOpts.map(o => <option key={o.offset} value={o.offset}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Category
                <select className="qcq-search-input" value={form.category}
                  onChange={e => onPeriodChange({ category: e.target.value })}
                  style={{ display: 'block', marginTop: 3 }}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>Performer
                <select className="qcq-search-input" value={form.employee_id || ''}
                  onChange={e => onPickCandidate(e.target.value)} disabled={candLoading}
                  style={{ display: 'block', marginTop: 3, width: '100%' }}>
                  {candLoading && <option>Loading…</option>}
                  {!candLoading && candidates.length === 0 && <option value="">No candidates</option>}
                  {!candLoading && candidates.map(c => (
                    <option key={c.employee_id} value={c.employee_id}>
                      {c.rank ? `#${c.rank} ` : ''}{c.name}{c.composite_score != null ? ` (${c.composite_score})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {periodInfo?.ended === false && (
              <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber, #f59e0b)', marginBottom: 8 }}>
                ⚠ {periodInfo.label} is still in progress — you can save a draft now and freeze it once the period ends.
              </div>
            )}

            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Summary (auto-filled from the leaderboard — edit freely)</label>
            <textarea value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
              rows={8} style={{ width: '100%', marginTop: 4, padding: 10, borderRadius: 8, fontSize: '0.85rem',
                lineHeight: 1.55, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />

            {msg && <div style={{ color: 'var(--accent-red)', fontSize: '0.78rem', marginTop: 8 }}>{msg}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" disabled={saving} onClick={() => save(false)}>Save draft</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => save(true)}>Save &amp; Freeze</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
