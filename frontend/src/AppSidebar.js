import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from './ThemeContext';
import { API_BASE } from './api';
import './dashboard.css';

export default function AppSidebar() {
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const path = location.pathname;
  const [generating, setGenerating] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const globalRefresh = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
      window.location.reload();
    } catch (err) {
      console.error('Refresh failed:', err);
      setSyncing(false);
    }
  };

  const downloadReport = async (type) => {
    setGenerating(type);
    try {
      let url = `${API_BASE}/live/reports/${type}`;
      if (customStart && customEnd) {
        url += `?start_date=${customStart}&end_date=${customEnd}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || `${type}_report.xlsx`).replace(/"/g, '');
        a.click();
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      console.error('Report download failed:', err);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-text">QA DASHBOARD</span>
      </div>
      <div className="theme-toggle-container">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <button onClick={globalRefresh} disabled={syncing}
          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', cursor: syncing ? 'wait' : 'pointer',
            background: syncing ? 'var(--accent-amber)' : 'var(--accent-teal)', color: '#fff', fontWeight: 700, fontSize: '0.78rem',
            opacity: syncing ? 0.8 : 1, transition: 'all 0.2s' }}>
          {syncing ? 'Syncing All Data...' : 'Sync & Refresh All'}
        </button>
      </div>
      <nav className="nav-menu">
        <Link to="/" className={`nav-item ${path === '/' || path === '/qc-queue' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M9 12h6M9 16h6" />
          </svg>
          QC Queue & Ageing
        </Link>
        <Link to="/team-board" className={`nav-item ${path === '/team-board' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            <path d="M12 17l2 2 4-4" />
          </svg>
          Team Board
        </Link>
        <Link to="/qa-summary" className={`nav-item ${path === '/qa-summary' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M12 18v-6" />
            <path d="M9 15l3 3 3-3" />
          </svg>
          Activity Summary
        </Link>

        <Link to="/resource-planner" className={`nav-item ${path === '/resource-planner' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <path d="M17 14v3m0 3v-3m0 0h3m-3 0h-3" />
          </svg>
          Resource Planner
        </Link>

        <Link to="/dev-dashboard" className={`nav-item ${path === '/dev-dashboard' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 18l2-2-2-2" /><path d="M8 18l-2-2 2-2" />
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" />
          </svg>
          Dev Dashboard
        </Link>

        <Link to="/automation" className={`nav-item ${path === '/automation' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
          </svg>
          Automation
        </Link>

        <Link to="/calendar" className={`nav-item ${path === '/calendar' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Calendar
        </Link>

        <div className="sidebar-section-label">Reports</div>
        <div style={{ padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Date pickers */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="qcq-search-input" style={{ fontSize: '0.7rem', padding: '3px 4px', flex: 1 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="qcq-search-input" style={{ fontSize: '0.7rem', padding: '3px 4px', flex: 1 }} />
          </div>
          {/* Quick presets */}
          <div style={{ display: 'flex', gap: '3px' }}>
            <button className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: '0.68rem', padding: '3px' }}
              onClick={() => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 7); setCustomStart(f.toISOString().split('T')[0]); setCustomEnd(t.toISOString().split('T')[0]); }}>
              Past 7 days
            </button>
            <button className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: '0.68rem', padding: '3px' }}
              onClick={() => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 30); setCustomStart(f.toISOString().split('T')[0]); setCustomEnd(t.toISOString().split('T')[0]); }}>
              Past 30 days
            </button>
          </div>
          {/* Download buttons */}
          <div style={{ display: 'flex', gap: '3px' }}>
            <button className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: '0.72rem', padding: '5px' }}
              onClick={() => downloadReport('weekly')} disabled={!!generating}>
              {generating === 'weekly' ? 'Generating...' : 'QA Report'}
            </button>
            <button className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: '0.72rem', padding: '5px' }}
              onClick={() => downloadReport('dev-weekly')} disabled={!!generating}>
              {generating === 'dev-weekly' ? 'Generating...' : 'Dev Report'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '3px' }}>
            <button className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: '0.72rem', padding: '5px', background: 'var(--accent-teal, #14b8a6)' }}
              onClick={() => downloadReport('automation-weekly')} disabled={!!generating}>
              {generating === 'automation-weekly' ? 'Generating...' : 'Automation Report'}
            </button>
          </div>
          {customStart && customEnd
            ? <span style={{ fontSize: '0.65rem', color: 'var(--accent-teal)' }}>{customStart} to {customEnd}</span>
            : <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Select dates or use presets</span>
          }
        </div>
      </nav>
    </aside>
  );
}
