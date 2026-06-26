// Shared QA-ticket complexity helpers — used by every ticket list (QC queue, Dev dashboard, Tickets,
// Resource Planner, Ticket Speed, Calendar, Activity Summary, top-search lookup). One fetch of the
// complexity map (/live/complexity/map), joined into rows by ticket_id, so the rating shows next to the
// title everywhere and is sortable/filterable like a native field.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';

export const CX_STYLE = {
  High:   ['var(--accent-red, #ef4444)',   'rgba(239,68,68,0.13)'],
  Medium: ['var(--accent-amber, #f59e0b)', 'rgba(245,158,11,0.13)'],
  Low:    ['var(--accent-green, #22c55e)', 'rgba(34,197,94,0.13)'],
};
// Numeric rank for sorting (High first when sorting desc).
export const CX_RANK = { High: 3, Medium: 2, Low: 1 };
export const cxRank = (level) => CX_RANK[level] || 0;

export function ComplexityBadge({ level, overridden, title, size }) {
  if (!level || level === 'Unknown') {
    return <span style={{ color: 'var(--text-muted)' }} title={title || 'Not rated yet'}>—</span>;
  }
  const [color, bg] = CX_STYLE[level] || ['var(--text-muted)', 'transparent'];
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: size === 'sm' ? '2px 7px' : '3px 9px', borderRadius: 11,
      fontSize: size === 'sm' ? '0.66rem' : '0.72rem', fontWeight: 700, lineHeight: 1.4, background: bg, color }}>
      {level}{overridden ? <span title="Manually set" style={{ fontSize: '0.62rem' }}>✎</span> : null}
    </span>
  );
}

export function CxPips({ score }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%',
          background: i < (score || 0) ? 'var(--accent-blue, #3b82f6)' : 'var(--border-color, #334155)' }} />
      ))}
    </span>
  );
}

// Fetches the complexity map once (and refreshes on demand). Returns helpers to read a ticket's level
// and to merge complexity onto a list of ticket objects (preserving any complexity already attached,
// e.g. by /live/qc-queue).
export function useComplexityMap() {
  const [map, setMap] = useState({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/live/complexity/map`);
      if (res.ok) setMap((await res.json()).map || {});
    } catch { /* ignore — ratings just stay blank */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Pick up newly-warmed ratings without a full reload.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const levelOf = useCallback((t) => {
    if (t && t.complexity) return t.complexity;            // already attached (qc-queue / lookup)
    const e = map[String(t?.ticket_id ?? t)];
    return e ? e.level : undefined;
  }, [map]);

  const entryOf = useCallback((t) => {
    const id = String(t?.ticket_id ?? t);
    const e = map[id] || {};
    return {
      level: (t && t.complexity) || e.level,
      score: (t && t.complexity_score != null ? t.complexity_score : e.score),
      overridden: (t && t.complexity_overridden) || e.overridden,
      mode: (t && t.complexity_mode) || e.mode,
    };
  }, [map]);

  // Merge complexity onto each row so existing field-based sort/filter just works.
  const withComplexity = useCallback((list) => (list || []).map(t => {
    const e = entryOf(t);
    return { ...t, complexity: e.level, complexity_score: e.score,
             complexity_overridden: e.overridden, complexity_mode: e.mode };
  }), [entryOf]);

  return { map, refresh, levelOf, entryOf, withComplexity };
}

// Filter a list by complexity level ('' = all). Works on rows already merged via withComplexity.
export function cxFilterRows(list, value) {
  if (!value) return list;
  return (list || []).filter(t => (t.complexity || '') === value);
}

// A standard High/Medium/Low filter dropdown for any list toolbar.
export function ComplexityFilter({ value, onChange, style }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} title="Filter by complexity"
      style={{ fontSize: '0.78rem', padding: '4px 8px', borderRadius: 7, cursor: 'pointer',
        background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border-color, #334155)',
        color: 'var(--text-primary)', ...(style || {}) }}>
      <option value="">All complexity</option>
      <option value="High">High</option>
      <option value="Medium">Medium</option>
      <option value="Low">Low</option>
    </select>
  );
}
