/**
 * Explicit proxy to backend in development.
 * Proxies API paths to http://localhost:8000, but NOT browser document requests
 * (e.g. refresh on /timesheet) so the dev server serves index.html and the SPA loads.
 * Restart "npm start" after changing this file.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

const backend = 'http://localhost:8000';
const apiPaths = [
  '/timesheet',
  '/auth',
  '/calendar',
  '/employees',
  '/sync',
  '/admin',
  '/redmine',
  '/testrail',
  '/ticket-tracking',
  '/reports',
  '/dev-planning',
  '/qa-planning',
  '/planning',
  '/my-tasks',
  '/pm-tracker',
  '/goals',
  '/uploads',
];

function isApiPath(pathname) {
  return apiPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isBrowserDocumentRequest(req) {
  const accept = (req.headers.accept || '').toLowerCase();
  return req.method === 'GET' && accept.includes('text/html');
}

module.exports = function (app) {
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
