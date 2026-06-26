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
  const [syncing, setSyncing] = useState(false);

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

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-mini" aria-hidden="true">BIS</span>
        <span className="logo-text">BIS 360</span>
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
        <button onClick={globalRefresh} disabled={syncing} className="sidebar-sync-btn"
          title="Sync &amp; Refresh All"
          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', cursor: syncing ? 'wait' : 'pointer',
            background: syncing ? 'var(--accent-amber)' : 'var(--accent-teal)', color: '#fff', fontWeight: 700, fontSize: '0.78rem',
            opacity: syncing ? 0.8 : 1, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span className="sidebar-sync-label">{syncing ? 'Syncing All Data...' : 'Sync & Refresh All'}</span>
        </button>
      </div>
      <nav className="nav-menu">
        <Link to="/" className={`nav-item ${path === '/' || path === '/qc-queue' ? 'active' : ''}`} title="QC Queue & Ageing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M9 12h6M9 16h6" />
          </svg>
          <span className="nav-label">QC Queue &amp; Ageing</span>
        </Link>
        <Link to="/activity-summary" className={`nav-item ${path === '/activity-summary' ? 'active' : ''}`} title="Activity Summary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M12 18v-6" />
            <path d="M9 15l3 3 3-3" />
          </svg>
          <span className="nav-label">Activity Summary</span>
        </Link>

        <Link to="/resource-planner" className={`nav-item ${path === '/resource-planner' ? 'active' : ''}`} title="Resource Planner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <path d="M17 14v3m0 3v-3m0 0h3m-3 0h-3" />
          </svg>
          <span className="nav-label">Resource Planner</span>
        </Link>

        <Link to="/dev-dashboard" className={`nav-item ${path === '/dev-dashboard' ? 'active' : ''}`} title="Dev Dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 18l2-2-2-2" /><path d="M8 18l-2-2 2-2" />
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" />
          </svg>
          <span className="nav-label">Dev Dashboard</span>
        </Link>

        <Link to="/employee-performance" className={`nav-item ${path === '/employee-performance' ? 'active' : ''}`} title="Employee Performance">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9H4a2 2 0 00-2 2v0a2 2 0 002 2h2" />
            <path d="M18 9h2a2 2 0 012 2v0a2 2 0 01-2 2h-2" />
            <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4z" />
          </svg>
          <span className="nav-label">Employee Performance</span>
        </Link>

        <Link to="/qa-estimation" className={`nav-item ${path === '/qa-estimation' ? 'active' : ''}`} title="QA Planning & Review">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 7h6M9 11h6M9 15h4" /><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M16 17l2 2 3-3" />
          </svg>
          <span className="nav-label">QA Planning &amp; Review</span>
        </Link>

        <Link to="/ticket-speed" className={`nav-item ${path === '/ticket-speed' ? 'active' : ''}`} title="Ticket Speed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
          <span className="nav-label">Ticket Speed</span>
        </Link>

        <Link to="/build-quality" className={`nav-item ${path === '/build-quality' ? 'active' : ''}`} title="Build Quality">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
          </svg>
          <span className="nav-label">Build Quality</span>
        </Link>

        <Link to="/ticket-calendar" className={`nav-item ${path === '/ticket-calendar' ? 'active' : ''}`} title="Ticket Calendar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
          </svg>
          <span className="nav-label">Ticket Calendar</span>
        </Link>

        <Link to="/automation" className={`nav-item ${path === '/automation' ? 'active' : ''}`} title="Automation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
          </svg>
          <span className="nav-label">Automation</span>
        </Link>

        <Link to="/calendar" className={`nav-item ${path === '/calendar' ? 'active' : ''}`} title="Calendar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="nav-label">Calendar</span>
        </Link>

        <Link to="/reports-center" className={`nav-item ${path === '/reports-center' ? 'active' : ''}`} title="Reports — QA, Dev & Automation (weekly / monthly / custom)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="16" y2="17" />
          </svg>
          <span className="nav-label">Reports</span>
        </Link>
      </nav>
    </aside>
  );
}
