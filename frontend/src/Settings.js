import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import { useTableSort, SortableHeader } from './useTableSort';
import { apiFetch, API_BASE } from './api';
import './dashboard.css';

function Settings() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [resettingUser, setResettingUser] = useState(null);
  
  // Google Sheets Export state
  const [sheetsStatus, setSheetsStatus] = useState(null);
  const [sheetsExporting, setSheetsExporting] = useState(false);
  const [sheetsMessage, setSheetsMessage] = useState('');

  const { sortedData: sortedUsers, sortConfig, handleSort } = useTableSort(users, {
    defaultSortKey: 'email',
    defaultSortDirection: 'asc',
  });

  const isAdminOrManager = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');

  const loadSheetsStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/sync/sheets-export/status`);
      if (res.ok) {
        const data = await res.json();
        setSheetsStatus(data);
      }
    } catch (e) {
      console.error('Failed to load sheets status:', e);
    }
  }, []);

  useEffect(() => {
    if (!isAdminOrManager) return;
    loadUsers();
    loadSheetsStatus();
  }, [user?.role, isAdminOrManager, loadSheetsStatus]);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_BASE}/admin/users`);
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (userId) => {
    setResettingUser(userId);
    try {
      const res = await apiFetch(`${API_BASE}/admin/users/${userId}/reset-password`, {
        method: 'POST',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Failed to reset password');
      }
      const data = await res.json();
      alert(`Password reset. Default password: ${data.default_password}`);
      loadUsers();
    } catch (e) {
      alert(e.message || 'Failed to reset password');
    } finally {
      setResettingUser(null);
    }
  };

  const handleSheetsExport = async () => {
    setSheetsExporting(true);
    setSheetsMessage('');
    try {
      const res = await apiFetch(`${API_BASE}/sync/sheets-export/trigger`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const details = data.details?.sheets || {};
        const totalRows = Object.values(details).reduce((sum, s) => sum + (s.rows || 0), 0);
        setSheetsMessage(`Export successful! ${totalRows.toLocaleString()} rows exported to Google Sheets.`);
      } else {
        throw new Error(data.detail || data.error || 'Export failed');
      }
    } catch (e) {
      setSheetsMessage(`Export failed: ${e.message}`);
    } finally {
      setSheetsExporting(false);
    }
  };

  const handleAdminConfigSubmit = async (e) => {
    e.preventDefault();
    setAdminMessage('');
    if (adminNewPassword && adminNewPassword !== adminConfirmPassword) {
      setAdminMessage('Passwords do not match');
      return;
    }
    if (!adminEmail && !adminNewPassword) {
      setAdminMessage('Enter email and/or new password');
      return;
    }
    setAdminSaving(true);
    try {
      const body = {};
      if (adminEmail) body.email = adminEmail.trim();
      if (adminNewPassword) body.new_password = adminNewPassword;
      const res = await apiFetch(`${API_BASE}/admin/config`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Failed to update');
      }
      setAdminMessage('Admin config updated successfully');
      setAdminNewPassword('');
      setAdminConfirmPassword('');
    } catch (e) {
      setAdminMessage(e.message || 'Failed to update');
    } finally {
      setAdminSaving(false);
    }
  };

  if (user?.role !== 'ADMIN') {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content">
          <div className="page-container" style={{ padding: '2rem' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can access Settings.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
    <div className="page-container" style={{ padding: '2rem', maxWidth: 900 }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Settings</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Google Sheets Export</h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Export PM Tool and TestRail data to Google Sheets. Auto-syncs every hour when enabled.
        </p>
        
        {sheetsStatus && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '1rem', 
            backgroundColor: 'var(--bg-secondary)', 
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ 
                width: 10, 
                height: 10, 
                borderRadius: '50%', 
                backgroundColor: sheetsStatus.configured ? 'var(--success)' : 'var(--danger)' 
              }}></span>
              <span>{sheetsStatus.configured ? 'Configured' : 'Not Configured'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ 
                width: 10, 
                height: 10, 
                borderRadius: '50%', 
                backgroundColor: sheetsStatus.auto_sync_enabled ? 'var(--success)' : 'var(--warning)' 
              }}></span>
              <span>Auto-sync: {sheetsStatus.auto_sync_enabled ? 'Enabled (every hour)' : 'Disabled'}</span>
            </div>
            {sheetsStatus.spreadsheet_url && (
              <a 
                href={sheetsStatus.spreadsheet_url} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: 'var(--primary)', textDecoration: 'underline' }}
              >
                Open Google Sheet
              </a>
            )}
          </div>
        )}
        
        {sheetsMessage && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '0.75rem', 
            borderRadius: '4px',
            backgroundColor: sheetsMessage.includes('successful') ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)',
            color: sheetsMessage.includes('successful') ? 'var(--success)' : 'var(--danger)'
          }}>
            {sheetsMessage}
          </div>
        )}
        
        <button 
          type="button" 
          onClick={handleSheetsExport}
          disabled={sheetsExporting || !sheetsStatus?.configured}
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          {sheetsExporting ? (
            <>
              <span className="loading-spinner-small"></span>
              Exporting...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              Sync to Google Sheets Now
            </>
          )}
        </button>
        
        {!sheetsStatus?.configured && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Configure SHEETS_EXPORT_* environment variables to enable export.
          </p>
        )}
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Admin Configuration</h2>
        <form onSubmit={handleAdminConfigSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 400 }}>
          <div>
            <label htmlFor="admin-email" style={{ display: 'block', marginBottom: 4 }}>Admin Email</label>
            <input
              id="admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="e.g. admin@techversantinfotech.com (use a dedicated email, not a manager user)"
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
          <div>
            <label htmlFor="admin-new-pw" style={{ display: 'block', marginBottom: 4 }}>New Password</label>
            <input
              id="admin-new-pw"
              type="password"
              value={adminNewPassword}
              onChange={(e) => setAdminNewPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
          <div>
            <label htmlFor="admin-confirm-pw" style={{ display: 'block', marginBottom: 4 }}>Confirm New Password</label>
            <input
              id="admin-confirm-pw"
              type="password"
              value={adminConfirmPassword}
              onChange={(e) => setAdminConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
          {adminMessage && <div style={{ color: adminMessage.includes('success') ? 'var(--success)' : 'var(--danger)' }}>{adminMessage}</div>}
          <button type="submit" disabled={adminSaving} className="btn-primary">
            {adminSaving ? 'Saving...' : 'Update Admin Config'}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>User Management</h2>
        {loading ? (
          <p>Loading users...</p>
        ) : error ? (
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <SortableHeader columnKey="email" onSort={handleSort} sortConfig={sortConfig}>Email</SortableHeader>
                  <SortableHeader columnKey="role" onSort={handleSort} sortConfig={sortConfig}>Role</SortableHeader>
                  <SortableHeader columnKey="employee_name" onSort={handleSort} sortConfig={sortConfig}>Employee</SortableHeader>
                  <SortableHeader columnKey="password_changed_at" onSort={handleSort} sortConfig={sortConfig}>Password Changed</SortableHeader>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.employee_name || u.employee_id || '-'}</td>
                    <td>{u.password_changed_at ? 'Yes' : 'No (first login)'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleResetPassword(u.id)}
                        disabled={resettingUser === u.id}
                      >
                        {resettingUser === u.id ? 'Resetting...' : 'Reset Password'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
      </main>
    </div>
  );
}

export default Settings;
