import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from './api';
import './dashboard.css';

// Period presets mirror the backend regex on /employees/performance/export-xlsx.
const PERIODS = [
  { value: 'last_5_working_days', label: 'Last 5 working days' },
  { value: 'last_10_working_days', label: 'Last 10 working days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

// Embeddable panel — rendered as the "Performance Export" tab inside Employee Performance.
export function PerformanceExportPanel() {
  const [options, setOptions] = useState([]);          // [{employee_id, name, team, is_dev}]
  const [selected, setSelected] = useState(new Set());  // employee_ids
  const [period, setPeriod] = useState('last_5_working_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/employees/performance/export-options`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setOptions(data.employees || []);
        setSelected(new Set(data.defaults || []));   // pre-check Suby & Vincy
      } catch (e) {
        if (alive) setError('Could not load employee list.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Group the (filtered) roster by team — QA first, then Dev, then anything else.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = options.filter(e =>
      !q || (e.name || '').toLowerCase().includes(q) || (e.employee_id || '').toLowerCase().includes(q)
    );
    const buckets = new Map();
    for (const e of matches) {
      const key = (e.team || 'Other').toUpperCase().includes('QA') ? 'QA'
        : (e.is_dev ? 'Development' : (e.team || 'Other'));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    const order = ['QA', 'Development'];
    return [...buckets.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [options, search]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const customValid = period !== 'custom' || (customStart && customEnd && customStart <= customEnd);
  const canDownload = !busy && selected.size > 0 && customValid;

  const download = useCallback(async () => {
    if (!canDownload) return;
    setBusy(true);
    setError('');
    try {
      const qs = new URLSearchParams({ employees: [...selected].join(','), period });
      if (period === 'custom') { qs.set('start', customStart); qs.set('end', customEnd); }
      const res = await fetch(`${API_BASE}/employees/performance/export-xlsx?${qs.toString()}`);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch { /* non-JSON */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || 'Performance_Export.xlsx').replace(/"/g, '');
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [canDownload, selected, period, customStart, customEnd]);

  return (
    <div className="pexp-grid">
      {/* WHO */}
      <section className="pexp-card">
        <div className="pexp-card-head">
          <h3>Who</h3>
          <span className="pexp-count">{selected.size} selected</span>
        </div>
        <input
          className="qcq-search-input pexp-search"
          placeholder="Search name or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {loading ? (
          <p className="pexp-muted">Loading employees…</p>
        ) : (
          <div className="pexp-emp-list">
            {grouped.map(([team, emps]) => (
              <div key={team} className="pexp-group">
                <div className="pexp-group-head">{team} <span className="pexp-muted">({emps.length})</span></div>
                {emps.map(e => (
                  <label key={e.employee_id} className="pexp-emp">
                    <input
                      type="checkbox"
                      checked={selected.has(e.employee_id)}
                      onChange={() => toggle(e.employee_id)}
                    />
                    <span className="pexp-emp-name">{e.name}</span>
                    <span className="pexp-emp-id">{e.employee_id}</span>
                  </label>
                ))}
              </div>
            ))}
            {grouped.length === 0 && <p className="pexp-muted">No matches.</p>}
          </div>
        )}
        {selected.size > 0 && (
          <button className="btn btn-sm btn-secondary pexp-clear" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
      </section>

      {/* PERIOD + DOWNLOAD */}
      <section className="pexp-card">
        <div className="pexp-card-head"><h3>Period</h3></div>
        <select
          className="qcq-search-input"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        >
          {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {period === 'custom' && (
          <div className="pexp-dates">
            <label>From
              <input type="date" className="qcq-search-input" value={customStart}
                max={customEnd || undefined}
                onChange={e => setCustomStart(e.target.value)} />
            </label>
            <label>To
              <input type="date" className="qcq-search-input" value={customEnd}
                min={customStart || undefined}
                onChange={e => setCustomEnd(e.target.value)} />
            </label>
          </div>
        )}
        {period === 'custom' && !customValid && (
          <p className="pexp-warn">Pick a valid From/To range.</p>
        )}

        <div className="pexp-metrics-note">
          <strong>Metrics:</strong> Delivery / throughput &amp; Efficiency, one sheet per person
          (no ranking, no comparison). Quality &amp; attendance are not included.
        </div>

        <button className="btn btn-primary pexp-download" onClick={download} disabled={!canDownload}>
          {busy ? 'Preparing…' : 'Download Excel'}
        </button>
        {selected.size === 0 && <p className="pexp-muted">Select at least one person.</p>}
        {error && <p className="pexp-warn">{error}</p>}
      </section>
    </div>
  );
}

export default PerformanceExportPanel;
