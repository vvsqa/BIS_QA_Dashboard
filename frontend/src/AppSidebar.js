import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { isPathAllowedForClient } from './clientModules';
import './dashboard.css';

function SidebarUser() {
  const { user, logout } = useAuth();
  return (
    <div className="sidebar-user">
      <span className="sidebar-user-name">{user?.name || user?.email || 'User'}</span>
      <span className="sidebar-user-role">{user?.designation || user?.role || ''}</span>
      <button type="button" className="sidebar-logout" onClick={logout} title="Sign out">
        Sign out
      </button>
    </div>
  );
}

export default function AppSidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const [theme, setTheme] = useTheme();
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const path = location.pathname;
  const isClient = user?.role === 'CLIENT';
  const clientCanSee = (linkPath) => isPathAllowedForClient(linkPath, user?.allowed_modules);

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-text">DASHBOARD</span>
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
      <nav className="nav-menu">
        {/* Home Page - all users; clients see only if allowed */}
        {(!isClient || clientCanSee('/')) && (
        <Link to="/" className={`nav-item ${path === '/' || path === '/eta-calendar' ? 'active' : ''}`} title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home Page
        </Link>
        )}
        {/* Overview & tracking - clients see only if allowed */}
        {(!isClient || clientCanSee('/dashboard')) && (
        <Link to="/dashboard" className={`nav-item ${path === '/dashboard' || path === '/ticket' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Ticket Dashboard
        </Link>
        )}
        {(!isClient || clientCanSee('/tickets')) && (
        <Link to="/tickets" className={`nav-item ${path === '/tickets' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          Tickets Overview
        </Link>
        )}
        {(!isClient || clientCanSee('/all-bugs')) && (
        <Link to="/all-bugs" className={`nav-item ${path === '/all-bugs' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4l2 2" />
          </svg>
          All Bugs Dashboard
        </Link>
        )}
        {/* Planning & execution */}
        {!isClient && (user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD')) && (
          <Link to="/planning" className={`nav-item ${path === '/planning' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Task Planning
          </Link>
        )}
        {!isClient && user?.employee_id && (
          <Link to="/my-tasks" className={`nav-item ${path === '/my-tasks' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            My Tasks
          </Link>
        )}
        {(!isClient || clientCanSee('/calendar')) && (
        <Link to="/calendar" className={`nav-item ${path === '/calendar' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Calendar
        </Link>
        )}
        {(!isClient || clientCanSee('/timesheet')) && (
        <Link to="/timesheet" className={`nav-item ${path === '/timesheet' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="12" y1="14" x2="12" y2="18" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
          Timesheet
        </Link>
        )}
        {/* People */}
        {!isClient && (user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD')) && (
          <Link to="/employees" className={`nav-item ${path.startsWith('/employees') && !path.includes(user?.employee_id) ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            Employees
          </Link>
        )}
        {!isClient && user?.employee_id && (
          <Link
            to={`/employees/${user.employee_id}`}
            className={`nav-item ${path.includes(`/employees/${user.employee_id}`) ? 'active' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            My Profile
          </Link>
        )}
        {/* Reports & admin - accessible to managers, leads, and admins only */}
        {!isClient && (user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD')) && (
          <Link to="/reports" className={`nav-item ${path === '/reports' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Reports
          </Link>
        )}
        {!isClient && user?.role === 'ADMIN' && (
          <>
            <Link to="/admin/clients" className={`nav-item ${path === '/admin/clients' ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="8" r="3" />
                <circle cx="16" cy="8" r="3" />
                <path d="M2 20c0-3 2.5-5 6-5s6 2 6 5" />
                <path d="M10 20c0-2.6 2-4.5 5-4.5s5 1.9 5 4.5" />
              </svg>
              Client Profiles
            </Link>
            <Link to="/admin/client-modules" className={`nav-item ${path === '/admin/client-modules' ? 'active' : ''}`} title="Set which modules each client can see">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Client module access
            </Link>
          </>
        )}
        {!isClient && (user?.role === 'ADMIN' || user?.role?.includes('MANAGER')) && (
          <Link to="/settings" className={`nav-item ${path === '/settings' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </Link>
        )}
      </nav>
      <SidebarUser />
    </aside>
  );
}
