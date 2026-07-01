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

/**
 * Fetch a file (PDF/xlsx/…) and trigger a browser download instead of navigating.
 * Uses the same authenticated fetch path as the rest of the app, so it works whether
 * the endpoint is public or token-protected. Throws with the server's message on failure
 * so callers can show a real error inline rather than opening a broken page.
 */
export async function downloadFile(path, filename) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, { headers });
  if (res.status === 401) { clearToken(); onUnauthorized(); throw new Error('Your session expired — please log in again.'); }
  if (!res.ok) {
    let msg = `Download failed (HTTP ${res.status})`;
    try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch (e) { /* non-JSON error body */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(objUrl);
}

export { API_BASE };
