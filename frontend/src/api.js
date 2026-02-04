/**
 * Authenticated API client. Adds Bearer token to requests.
 * On 401, clears token and triggers logout.
 * In development with npm start, use empty base so the proxy (package.json "proxy": "http://localhost:8000") is used.
 */
const API_BASE = process.env.REACT_APP_API_BASE !== undefined && process.env.REACT_APP_API_BASE !== ''
  ? process.env.REACT_APP_API_BASE
  : (process.env.NODE_ENV === 'development' ? '' : `http://${window.location.hostname}:8000`);
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
