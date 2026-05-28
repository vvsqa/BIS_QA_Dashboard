/**
 * Explicit proxy to backend in development.
 * Proxies API paths to REACT_APP_DEV_PROXY_TARGET, but NOT browser document requests
 * (e.g. refresh on /timesheet) so the dev server serves index.html and the SPA loads.
 * Restart "npm start" after changing this file.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

const backend = (process.env.REACT_APP_DEV_PROXY_TARGET || '').trim();
const apiPaths = [
  '/api',
  '/timesheet',
  '/auth',
  '/calendar',
  '/employees',
  '/sync',
  '/admin',
  '/redmine',
  '/testrail',
  '/ticket-tracking',
  '/tickets-dashboard',
  '/tickets',
  '/dashboard',
  '/bugs',
  '/status-history',
  '/reports',
  '/dev-planning',
  '/qa-planning',
  '/planning',
  '/my-tasks',
  '/pm-tracker',
  '/goals',
  '/uploads',
  '/login',
  '/eta-calendar',
  '/automation',
  '/qc-queue',
  '/qc-cycles',
  '/ageing',
  '/analytics',
  '/team-board',
  '/live',
];

function isApiPath(pathname) {
  return apiPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isBrowserDocumentRequest(req) {
  const accept = (req.headers.accept || '').toLowerCase();
  return req.method === 'GET' && accept.includes('text/html');
}

module.exports = function (app) {
  if (!backend) {
    // Keep startup working even when no proxy target is configured.
    // In that case set REACT_APP_API_BASE for direct API calls.
    console.warn('[setupProxy] REACT_APP_DEV_PROXY_TARGET is not set. API proxy is disabled.');
    return;
  }

  app.use(
    createProxyMiddleware((pathname, req) => {
      if (!isApiPath(pathname)) return false;
      if (isBrowserDocumentRequest(req)) return false;
      return true;
    }, {
      target: backend,
      changeOrigin: true,
      ws: true,
    })
  );
};
