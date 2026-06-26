import { useState } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

// One card per report category. `monthly`/`custom` null => that option isn't offered.
const CATEGORIES = [
  {
    key: 'qa', title: 'QA — Web Manual Testing', accent: '#14b8a6',
    desc: 'Load, ticket movement and average QA cycle time for the web manual team. Mobile & automation excluded.',
    weekly: '/live/reports/weekly', monthly: '/live/reports/monthly', custom: '/live/reports/weekly',
    icon: (<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>),
  },
  {
    key: 'dev', title: 'Development', accent: '#3b82f6',
    desc: 'Handoffs to QC, delivery to live, bugs fixed, average lead time and dev effort, with per-developer workload.',
    weekly: '/live/reports/dev-weekly', monthly: '/live/reports/dev-monthly', custom: '/live/reports/dev-weekly',
    icon: (<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>),
  },
  {
    key: 'automation', title: 'Automation', accent: '#a78bfa',
    desc: 'Coverage, automated executions, utilisation, time saved and per-member scripting — same card as the Automation module.',
    weekly: '/live/reports/automation-weekly', monthly: null, custom: '/live/reports/automation-weekly',
    icon: (<><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>),
  },
  {
    key: 'qa-automation', title: 'QA + Automation (Combined)', accent: '#06b6d4',
    desc: 'One PDF: the manual QA card, then the automation card, then case-list tables for next-week planned and backlog by module.',
    weekly: '/live/reports/qa-automation-weekly', monthly: null, custom: '/live/reports/qa-automation-weekly',
    icon: (<><path d="M9 11l3 3L22 4" /><path d="M12 2L2 7l10 5 10-5-10-5z" /></>),
  },
];

export default function ReportsCenter() {
  const [busy, setBusy] = useState('');     // "<key>:<mode>" currently downloading
  const [error, setError] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const customValid = !!(start && end && start <= end);

  const download = async (tag, path, params) => {
    setBusy(tag); setError('');
    try {
      const base = (API_BASE || '').replace(/\/$/, '');
      const qs = new URLSearchParams(params || {}).toString();
      const res = await fetch(base + path + (qs ? `?${qs}` : ''));
      if (!res.ok) throw new Error(`Failed to generate report (${res.status})`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || 'report.pdf').replace(/"/g, '');
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.message || 'Download failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)', padding: '24px 28px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Reports Center</h1>
        <p style={{ color: 'var(--text-muted)', margin: '6px 0 0', fontSize: '0.9rem' }}>
          Dark-themed PDF reports for QA, Development and Automation. Each offers a <strong>Weekly</strong> (this Mon–Fri),
          a <strong>Monthly</strong> (this month) and a <strong>Custom range</strong> download.
        </p>
      </div>

      {/* Custom range control */}
      <div className="qcq-section" style={{ padding: '14px 16px', marginBottom: 18, display: 'flex',
        alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Custom range:</span>
        <input type="date" value={start} onChange={e => setStart(e.target.value)}
          className="qcq-search-input" style={{ padding: '5px 8px', fontSize: '0.8rem' }} />
        <span style={{ color: 'var(--text-muted)' }}>to</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
          className="qcq-search-input" style={{ padding: '5px 8px', fontSize: '0.8rem' }} />
        <span style={{ fontSize: '0.72rem', color: customValid ? 'var(--accent-teal)' : 'var(--text-muted)' }}>
          {start && end
            ? (customValid ? 'Range set — use the “Custom” button on any card' : 'End date must be on/after start date')
            : 'Pick a start & end to enable the Custom buttons'}
        </span>
      </div>

      {error && <div className="error-message" style={{ marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {CATEGORIES.map(cat => (
          <div key={cat.key} className="qcq-section" style={{ padding: 18, borderTop: `3px solid ${cat.accent}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: 9,
                background: `${cat.accent}22`, alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={cat.accent} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">{cat.icon}</svg>
              </span>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{cat.title}</h2>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', minHeight: 52, margin: '0 0 14px' }}>{cat.desc}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-sm btn-primary" disabled={!!busy}
                onClick={() => download(`${cat.key}:weekly`, cat.weekly, {})}>
                {busy === `${cat.key}:weekly` ? 'Generating…' : '⬇  Weekly (this Mon–Fri)'}
              </button>

              {cat.monthly && (
                <button className="btn btn-sm btn-primary" disabled={!!busy}
                  onClick={() => download(`${cat.key}:monthly`, cat.monthly, {})}>
                  {busy === `${cat.key}:monthly` ? 'Generating…' : '⬇  Monthly (this month)'}
                </button>
              )}

              <button className="btn btn-sm btn-secondary" disabled={!!busy || !customValid}
                title={customValid ? 'Download for the selected custom range' : 'Set a valid custom range above first'}
                onClick={() => download(`${cat.key}:custom`,
                  cat.custom,
                  cat.key === 'automation' ? { start_date: start } : { start_date: start, end_date: end })}>
                {busy === `${cat.key}:custom` ? 'Generating…' : '⬇  Custom range'}
              </button>
              {cat.key === 'automation' && (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  Automation shows the current live snapshot (no monthly variant); Custom uses the chosen week start.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      </main>
    </div>
  );
}
