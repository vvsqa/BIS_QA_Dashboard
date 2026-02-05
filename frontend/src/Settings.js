import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
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

  const isAdminOrManager = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');

  useEffect(() => {
    if (!isAdminOrManager) return;
    loadUsers();
  }, [user?.role, isAdminOrManager]);

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
      <div className="page-container" style={{ padding: '2rem' }}>
        <h2>Access Denied</h2>
        <p>Only administrators can access Settings.</p>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ padding: '2rem', maxWidth: 900 }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Settings</h1>

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
                  <th>Email</th>
                  <th>Role</th>
                  <th>Employee</th>
                  <th>Password Changed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
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
  );
}

export default Settings;
