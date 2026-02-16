import React, { useEffect, useState } from 'react';
import AppSidebar from './AppSidebar';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import { CLIENT_MODULES } from './clientModules';
import './dashboard.css';

export default function ClientModuleAccess() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [localModules, setLocalModules] = useState({}); // clientId -> Set(moduleId)

  const isAdmin = user?.role === 'ADMIN';

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
      const list = Array.isArray(data.clients) ? data.clients : [];
      setClients(list);
      const next = {};
      list.forEach((c) => {
        next[c.id] = new Set(c.allowed_modules || []);
      });
      setLocalModules(next);
    } catch (e) {
      setError(e.message || 'Failed to load client profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadClients();
  }, [isAdmin]);

  const toggleModule = (clientId, moduleId) => {
    setLocalModules((prev) => {
      const set = new Set(prev[clientId] || []);
      if (set.has(moduleId)) set.delete(moduleId);
      else set.add(moduleId);
      return { ...prev, [clientId]: set };
    });
  };

  const saveClientModules = async (clientId) => {
    const set = localModules[clientId];
    const list = set ? Array.from(set) : [];
    setSavingId(clientId);
    setError('');
    try {
      const res = await apiFetch(`/admin/clients/${clientId}/modules`, {
        method: 'PUT',
        body: JSON.stringify({ allowed_modules: list }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Failed to update');
      await loadClients();
    } catch (e) {
      setError(e.message || 'Failed to update');
    } finally {
      setSavingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content">
          <div className="page-container" style={{ padding: '2rem' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can access Client Module Access.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
        <div className="page-container" style={{ padding: '2rem', maxWidth: 1100 }}>
          <h1 style={{ marginBottom: '0.5rem' }}>Client module access</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Choose which modules each client can see in the app. Changes apply after the client refreshes or logs in again.
          </p>
          {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</p>}
          {loading ? (
            <p>Loading clients...</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 160 }}>Client</th>
                    {CLIENT_MODULES.map((m) => (
                      <th key={m.id} style={{ minWidth: 100, textAlign: 'center' }} title={m.paths.join(', ')}>
                        {m.label}
                      </th>
                    ))}
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{c.email}</div>
                      </td>
                      {CLIENT_MODULES.map((m) => (
                        <td key={m.id} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={(localModules[c.id] || new Set()).has(m.id)}
                            onChange={() => toggleModule(c.id, m.id)}
                            disabled={!c.is_active}
                            title={c.is_active ? m.label : 'Client inactive'}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => saveClientModules(c.id)}
                          disabled={savingId === c.id || !c.is_active}
                        >
                          {savingId === c.id ? 'Saving...' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {clients.length === 0 && (
                    <tr>
                      <td colSpan={CLIENT_MODULES.length + 2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No client profiles. Create clients in Client Profiles first.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
