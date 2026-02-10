/**
 * Authenticated API client. Adds Bearer token to requests.
 * On 401, clears token and triggers logout.
 * API base is environment-driven:
 * - REACT_APP_API_BASE for direct API calls (prod/staging or custom local setup).
 * - Empty value uses relative paths (works with dev proxy or same-origin backend).
 */
const rawApiBase = (process.env.REACT_APP_API_BASE || '').trim();
const API_BASE = rawApiBase.replace(/\/$/, '');
const TOKEN_KEY = 'qa_dashboard_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized = () => {};

export function setOnUnauthorized(callback) {
  onUnauthorized = callback;
}

export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    clearToken();
    onUnauthorized();
    throw new Error('Unauthorized');
  }
  return res;
}

export { API_BASE };
