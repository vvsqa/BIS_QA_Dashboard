import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, getToken, setToken, clearToken, setOnUnauthorized, API_BASE } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lockStatus, setLockStatus] = useState(null);
  const navigate = useNavigate();

  const loadUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        // Include permissions from /auth/me response
        setUser({ ...data, token, permissions: data.permissions || {} });
      } else {
        clearToken();
        setUser(null);
      }
    } catch (err) {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLockStatus = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLockStatus(null);
      return;
    }
    try {
      const res = await apiFetch('/timesheet/lock-status');
      if (res.ok) {
        const data = await res.json();
        setLockStatus(data);
      }
    } catch (err) {
      setLockStatus(null);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (user) {
      refreshLockStatus();
    } else {
      setLockStatus(null);
    }
  }, [user, refreshLockStatus]);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
      navigate('/login');
    });
    return () => setOnUnauthorized(() => {});
  }, [navigate]);

  const login = async (email, password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || 'Login failed');
    }
    setToken(data.access_token);
    // After login, load full user data with permissions
    await loadUser();
    return data;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    navigate('/login');
  };

  const changePassword = async (currentPassword, newPassword) => {
    const res = await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to change password');
    }
    // Reload user data to update password_changed_at
    await loadUser();
  };

  // Check if user needs to change password (first login)
  const needsPasswordChange = () => {
    if (!user || user.role === 'ADMIN') return false;
    return user.password_changed_at === null;
  };

  // Helper functions for permission checks
  const canAccessAllProfiles = () => {
    return user?.permissions?.can_access_all_profiles || false;
  };

  const canEditAllProfiles = () => {
    return user?.permissions?.can_edit_all_profiles || false;
  };

  const canChangeUserRoles = () => {
    return user?.permissions?.can_change_user_roles || false;
  };

  const isAdmin = () => user?.role === 'ADMIN';
  const isManager = () => user?.role?.includes('MANAGER') || false;
  const isLead = () => user?.role?.includes('LEAD') || false;

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    changePassword,
    loadUser,
    // Permission helpers
    canAccessAllProfiles,
    canEditAllProfiles,
    canChangeUserRoles,
    isAdmin,
    isManager,
    isLead,
    needsPasswordChange,
    lockStatus,
    refreshLockStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
