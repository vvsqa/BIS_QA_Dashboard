import React, { useEffect, useMemo, useState } from 'react';
import AppSidebar from './AppSidebar';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import './dashboard.css';

function emptyForm() {
  return { name: '', email: '', is_active: true };
}

export default function ClientProfiles() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [importCsv, setImportCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const isAdmin = user?.role === 'ADMIN';

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [clients]
  );

  const loadClients = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/admin/clients');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Failed to load client profiles');
      }
      const data = await res.json();
      setClients(Array.isArray(data.clients) ? data.clients : []);
    } catch (e) {
      setError(e.message || 'Failed to load client profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadClients();
    }
  }, [isAdmin]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/admin/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          is_active: !!form.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create client');
      }
      alert(`Client created. Default password: ${data.default_password}`);
      setForm(emptyForm());
      await loadClients();
    } catch (e) {
      setError(e.message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (client) => {
    setEditId(client.id);
    setEditForm({
      name: client.name || '',
      email: client.email || '',
      is_active: !!client.is_active,
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm(emptyForm());
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/admin/clients/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name.trim(),
          email: editForm.email.trim().toLowerCase(),
          is_active: !!editForm.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update client');
      }
      cancelEdit();
      await loadClients();
    } catch (e) {
      setError(e.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  const resetClientPassword = async (clientId) => {
    setResettingId(clientId);
    setError('');
    try {
      const res = await apiFetch(`/admin/clients/${clientId}/reset-password`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to reset password');
      }
      alert(`Client password reset. Default password: ${data.default_password}`);
      await loadClients();
    } catch (e) {
      setError(e.message || 'Failed to reset password');
    } finally {
      setResettingId(null);
    }
  };

  const parseCsvToProfiles = (text) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const rows = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
      return parts;
    });
    const first = rows[0].map((c) => (c || '').toLowerCase());
    const isHeader =
      first.some((c) => c === 'first name' || c === 'last name' || c === 'name' || c === 'email');
    const dataRows = isHeader ? rows.slice(1) : rows;
    const profiles = [];
    for (const row of dataRows) {
      if (row.length >= 3) {
        const firstName = row[0] || '';
        const lastName = row[1] || '';
        const email = (row[2] || '').trim().toLowerCase();
        if (email && (firstName || lastName)) {
          profiles.push({ name: `${firstName} ${lastName}`.trim(), email });
        }
      } else if (row.length === 2) {
        const name = (row[0] || '').trim();
        const email = (row[1] || '').trim().toLowerCase();
        if (name && email) profiles.push({ name, email });
      }
    }
    return profiles;
  };

  const handleImport = async () => {
    const profiles = parseCsvToProfiles(importCsv);
    if (profiles.length === 0) {
      setError('Paste CSV with "First name,Last name,Email" or "Name,Email" (one row per client).');
      return;
    }
    setImporting(true);
    setError('');
    setImportResult(null);
    try {
      const res = await apiFetch('/admin/clients/import', {
        method: 'POST',
        body: JSON.stringify({ profiles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Import failed');
      }
      setImportResult(data);
      setImportCsv('');
      await loadClients();
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content">
          <div className="page-container" style={{ padding: '2rem' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can access Client Profiles.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
        <div className="page-container" style={{ padding: '2rem', maxWidth: 1000 }}>
          <h1 style={{ marginBottom: '1rem' }}>Client Profiles</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Create and manage client logins. Default password is <strong>BIS@123</strong>; clients are forced to change it on first login.
          </p>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ marginBottom: '0.75rem', fontSize: '1.2rem' }}>Create Client</h2>
            <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label htmlFor="client-name" style={{ display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  id="client-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="client-email" style={{ display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  id="client-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="client-active" style={{ display: 'block', marginBottom: 4 }}>Active</label>
                <select
                  id="client-active"
                  value={form.is_active ? 'yes' : 'no'}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.value === 'yes' }))}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Creating...' : 'Create'}
              </button>
            </form>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ marginBottom: '0.75rem', fontSize: '1.2rem' }}>Import clients (CSV)</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
              Paste CSV with header <strong>First name,Last name,Email</strong> or <strong>Name,Email</strong>. One row per client. Duplicates by email are skipped.
            </p>
            <textarea
              value={importCsv}
              onChange={(e) => setImportCsv(e.target.value)}
              placeholder={'First name,Last name,Email\nAly,Saafan,aly.saafan@bistraining.ca\n...'}
              rows={6}
              style={{ width: '100%', padding: '0.5rem', fontFamily: 'monospace', marginBottom: '0.5rem' }}
            />
            <button type="button" className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : 'Import'}
            </button>
            {importResult && (
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)' }}>
                {importResult.message}
                {importResult.skipped?.length > 0 && ` Skipped: ${importResult.skipped.join(', ')}`}
              </p>
            )}
          </section>

          <section>
            <h2 style={{ marginBottom: '0.75rem', fontSize: '1.2rem' }}>Client Accounts</h2>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            {loading ? (
              <p>Loading clients...</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Active</th>
                      <th>Password Changed</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {editId === c.id ? (
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                              style={{ width: '100%', padding: '0.35rem' }}
                            />
                          ) : c.name}
                        </td>
                        <td>
                          {editId === c.id ? (
                            <input
                              type="email"
                              value={editForm.email}
                              onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                              style={{ width: '100%', padding: '0.35rem' }}
                            />
                          ) : c.email}
                        </td>
                        <td>
                          {editId === c.id ? (
                            <select
                              value={editForm.is_active ? 'yes' : 'no'}
                              onChange={(e) => setEditForm((p) => ({ ...p, is_active: e.target.value === 'yes' }))}
                              style={{ padding: '0.35rem' }}
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          ) : c.is_active ? 'Yes' : 'No'}
                        </td>
                        <td>{c.password_changed_at ? 'Yes' : 'No (first login)'}</td>
                        <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: '0.5rem' }}>
                          {editId === c.id ? (
                            <>
                              <button type="button" className="btn-primary" onClick={saveEdit} disabled={saving}>Save</button>
                              <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="btn-secondary" onClick={() => startEdit(c)}>Edit</button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => resetClientPassword(c.id)}
                                disabled={resettingId === c.id}
                              >
                                {resettingId === c.id ? 'Resetting...' : 'Reset Password'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sortedClients.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                          No client profiles found.
                        </td>
                      </tr>
                    )}
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
