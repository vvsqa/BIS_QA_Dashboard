import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTableSort, SortableHeader } from './useTableSort';
import { TicketExternalLink } from './ticketUtils';
import { apiFetch, API_BASE } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './dashboard.css';

// Ensure no double slash when API_BASE has trailing slash
const BACKEND_URL = (API_BASE || '').replace(/\/$/, '');

function ReportsModule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [reportType, setReportType] = useState('v2'); // 'v2' for comprehensive, 'v1' for simple
  const [dateRangeType, setDateRangeType] = useState('last7days'); // 'last7days' or 'week'
  const [error, setError] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  
  // Production Bugs Report state
  const [prodBugsLoading, setProdBugsLoading] = useState(false);
  const [prodBugsPreview, setProdBugsPreview] = useState(null);
  const [prodBugsError, setProdBugsError] = useState('');

  // Open Bugs Report state
  const [openBugsLoading, setOpenBugsLoading] = useState(false);
  const [openBugsPreview, setOpenBugsPreview] = useState(null);
  const [openBugsError, setOpenBugsError] = useState('');
  const [openBugsSortBy, setOpenBugsSortBy] = useState('ageing');
  const [openBugsSortOrder, setOpenBugsSortOrder] = useState('desc');
  const [openBugsDeveloper, setOpenBugsDeveloper] = useState('');

  // Get today's date
  const getToday = () => {
    return new Date().toISOString().split('T')[0];
  };

  // Get current week's Monday (for traditional week view)
  const getCurrentMonday = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().split('T')[0];
  };

  useEffect(() => {
    // Set default date based on range type
    if (dateRangeType === 'last7days') {
      setSelectedDate(getToday());
    } else {
      setSelectedDate(getCurrentMonday());
    }
  }, [dateRangeType]);

  // Auto-load preview on mount
  useEffect(() => {
    setSelectedDate(getToday());
  }, []);

  // Fetch preview data (reports are public; works with or without login)
  const fetchPreview = async () => {
    setLoading(true);
    setError('');
    try {
      const useLast7Days = dateRangeType === 'last7days';
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      let path = reportType === 'v2'
        ? `/reports/weekly-v2/preview?last7days=${useLast7Days}${selectedDate ? `&date=${selectedDate}` : ''}`
        : (selectedDate ? `/reports/weekly/preview?date=${selectedDate}` : '/reports/weekly/preview');
      const requestUrl = base ? `${base}${path}` : path;
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to fetch report preview';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : (Array.isArray(j.detail) ? j.detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : String(j.detail));
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await response.json();
      setPreviewData(data);
    } catch (err) {
      const msg = err?.message || '';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError') || err?.name === 'TypeError';
      setError(isNetworkError
        ? 'Backend not reachable. Start it with: cd backend && python -m uvicorn main:app --reload (or run start-backend.bat). In dev, leave REACT_APP_API_BASE empty so the proxy is used.'
        : msg || 'Failed to fetch report preview');
    } finally {
      setLoading(false);
    }
  };

  // Generate and download PDF
  const downloadReport = async () => {
    setLoading(true);
    setError('');
    try {
      const useLast7Days = dateRangeType === 'last7days';
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      let path = reportType === 'v2'
        ? `/reports/weekly-v2?last7days=${useLast7Days}${selectedDate ? `&date=${selectedDate}` : ''}${projectName ? `&project=${encodeURIComponent(projectName)}` : ''}`
        : (selectedDate ? `/reports/weekly?date=${selectedDate}` : '/reports/weekly');
      const requestUrl = base ? `${base}${path}` : path;
      const headers = {};
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to generate report';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : String(j.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const filename = reportType === 'v2'
        ? `QA_Weekly_Report_V2_${previewData?.week_start || 'report'}.pdf`
        : `QA_Weekly_Report_${previewData?.week_start || 'report'}.pdf`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
    } catch (err) {
      const msg = err?.message || '';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError') || err?.name === 'TypeError';
      setError(isNetworkError
        ? 'Backend not reachable. Start it with: cd backend && python -m uvicorn main:app --reload (or run start-backend.bat). In dev, leave REACT_APP_API_BASE empty so the proxy is used.'
        : msg || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDate) {
      fetchPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, reportType, dateRangeType]);

  // Calculate week change
  const getWeekChange = (current, previous) => {
    const change = current - previous;
    return {
      value: change,
      display: change >= 0 ? `+${change}` : `${change}`,
      isPositive: change >= 0
    };
  };

  // Table sorting for BIS testing tickets
  const { sortedData: sortedBisTickets, sortConfig: bisSortConfig, handleSort: handleBisSort } = useTableSort(
    previewData?.bis_testing_tickets || [],
    { defaultSortKey: 'ticket_id', defaultSortDirection: 'desc' }
  );

  // Table sorting for closed tickets
  const { sortedData: sortedClosedTickets, sortConfig: closedSortConfig, handleSort: handleClosedSort } = useTableSort(
    previewData?.closed_tickets || [],
    { defaultSortKey: 'ticket_id', defaultSortDirection: 'desc' }
  );

  // Fetch Production Bugs Report preview
  const fetchProdBugsPreview = async () => {
    setProdBugsLoading(true);
    setProdBugsError('');
    try {
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      const requestUrl = `${base}/reports/production-bugs/preview`;
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to fetch report preview';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : String(j.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await response.json();
      setProdBugsPreview(data);
    } catch (err) {
      setProdBugsError(err?.message || 'Failed to fetch preview');
    } finally {
      setProdBugsLoading(false);
    }
  };

  // Download Production Bugs Report
  const downloadProdBugsReport = async (format = 'excel') => {
    setProdBugsLoading(true);
    setProdBugsError('');
    try {
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      const requestUrl = `${base}/reports/production-bugs/download?format=${format}`;
      const headers = {};
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to generate report';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : String(j.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      a.download = `Production_PreProd_Bugs_Report.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
    } catch (err) {
      setProdBugsError(err?.message || 'Failed to generate report');
    } finally {
      setProdBugsLoading(false);
    }
  };

  // Fetch Open Bugs Report preview
  const fetchOpenBugsPreview = async () => {
    setOpenBugsLoading(true);
    setOpenBugsError('');
    try {
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      const requestUrl = `${base}/reports/open-bugs/preview`;
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to fetch open bugs preview';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : String(j.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await response.json();
      setOpenBugsPreview(data);
    } catch (err) {
      setOpenBugsError(err?.message || 'Failed to fetch preview');
    } finally {
      setOpenBugsLoading(false);
    }
  };

  // Download Open Bugs Report PDF
  const downloadOpenBugsReport = async () => {
    setOpenBugsLoading(true);
    setOpenBugsError('');
    try {
      const base = (BACKEND_URL || '').replace(/\/$/, '');
      let requestUrl = `${base}/reports/open-bugs?sort_by=${openBugsSortBy}&sort_order=${openBugsSortOrder}`;
      if (openBugsDeveloper) {
        requestUrl += `&developer=${encodeURIComponent(openBugsDeveloper)}`;
      }
      const headers = {};
      const token = localStorage.getItem('qa_dashboard_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(requestUrl, { headers });
      if (!response.ok) {
        let msg = 'Failed to generate report';
        try {
          const j = await response.json();
          if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : String(j.detail);
        } catch (_) {}
        throw new Error(msg);
      }
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const devSuffix = openBugsDeveloper ? `_${openBugsDeveloper.replace(/\s+/g, '_')}` : '';
      a.download = `Open_Bugs_Report${devSuffix}_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
    } catch (err) {
      setOpenBugsError(err?.message || 'Failed to generate report');
    } finally {
      setOpenBugsLoading(false);
    }
  };

  // Load production bugs and open bugs preview on mount
  useEffect(() => {
    fetchProdBugsPreview();
    fetchOpenBugsPreview();
  }, []);

  return (
    <div className="dashboard-container">
      <AppSidebar />

      {/* Main Content */}
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        {/* Page Header */}
        <header className="page-header">
          <div className="header-title">
            <h1>📈 Reports</h1>
            <p>Generate comprehensive QA weekly reports</p>
          </div>
        </header>

        {/* Report Generator Section */}
        <section className="report-generator-section">
          <div className="section-header">
            <h2>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Weekly QA Report Generator
            </h2>
            <p className="section-subtitle">Generate comprehensive, client-ready QA reports</p>
          </div>

          <div className="report-controls">
            <div className="control-row">
              <div className="control-group">
                <label>Report Type</label>
                <div className="report-type-selector">
                  <button 
                    className={`type-btn ${reportType === 'v2' ? 'active' : ''}`}
                    onClick={() => setReportType('v2')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Comprehensive Report
                    <span className="type-badge">Recommended</span>
                  </button>
                  <button 
                    className={`type-btn ${reportType === 'v1' ? 'active' : ''}`}
                    onClick={() => setReportType('v1')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14,2 14,8 20,8"/>
                    </svg>
                    Simple Report
                  </button>
                </div>
              </div>
            </div>

            {reportType === 'v2' && (
              <div className="control-row">
                <div className="control-group">
                  <label>Date Range</label>
                  <div className="date-range-selector">
                    <button 
                      className={`range-btn ${dateRangeType === 'last7days' ? 'active' : ''}`}
                      onClick={() => setDateRangeType('last7days')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                      </svg>
                      Last 7 Days
                    </button>
                    <button 
                      className={`range-btn ${dateRangeType === 'week' ? 'active' : ''}`}
                      onClick={() => setDateRangeType('week')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      Mon-Fri Week
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="control-row">
              <div className="control-group">
                <label>{dateRangeType === 'last7days' ? 'End Date (Today)' : 'Select Week (Monday Date)'}</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="date-input"
                />
              </div>

              {reportType === 'v2' && (
                <div className="control-group">
                  <label>Project/Client Name (Optional)</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g., Client XYZ Project"
                    className="text-input"
                  />
                </div>
              )}

              <div className="control-actions">
                <button 
                  className="btn-preview"
                  onClick={fetchPreview}
                  disabled={loading}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  {loading ? 'Loading...' : 'Preview'}
                </button>

                <button 
                  className="btn-download"
                  onClick={downloadReport}
                  disabled={loading || !previewData}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {loading ? 'Generating...' : 'Download PDF'}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}
        </section>

        {/* Preview Section - Remodeled Report */}
        {previewData && (
          <div className="report-preview-wrapper">
            {/* Cover */}
            <section className="report-cover">
              <h1 className="report-cover-title">QA Weekly Report</h1>
              <p className="report-cover-date">{previewData.week_start} — {previewData.week_end}</p>
              {projectName && <p className="report-cover-project">{projectName}</p>}
              <p className="report-cover-meta">Report preview · Comprehensive</p>
            </section>

            {reportType === 'v2' && (
              <>
                {/* Page 1: After cover – QA overview & variance */}
                <section className="report-page-section">
                  <h2 className="report-section-title">QA Overview</h2>
                  <div className="report-kpi-grid">
                    <div className="report-kpi-card">
                      <span className="report-kpi-value">{previewData.current_week?.qa_tickets_count ?? 0}</span>
                      <span className="report-kpi-label">Current tickets with QA</span>
                    </div>
                    <div className="report-kpi-card report-kpi-status">
                      <span className="report-kpi-value">{previewData.qa_pending_breakdown?.['QC Testing'] ?? 0}</span>
                      <span className="report-kpi-label">QC Testing</span>
                    </div>
                    <div className="report-kpi-card report-kpi-status">
                      <span className="report-kpi-value">{previewData.qa_pending_breakdown?.['QC Testing in Progress'] ?? 0}</span>
                      <span className="report-kpi-label">QC Testing in Progress</span>
                    </div>
                    <div className="report-kpi-card report-kpi-status">
                      <span className="report-kpi-value">{previewData.qa_pending_breakdown?.['QC Testing Hold'] ?? 0}</span>
                      <span className="report-kpi-label">QC Testing Hold</span>
                    </div>
                    <div className="report-kpi-card report-kpi-incoming">
                      <span className="report-kpi-value">{previewData.current_week?.qc_newly_added_count ?? 0}</span>
                      <span className="report-kpi-label">Newly moved to QC Testing</span>
                    </div>
                    <div className="report-kpi-card report-kpi-outgoing">
                      <span className="report-kpi-value">{previewData.current_week?.bis_testing_count ?? 0}</span>
                      <span className="report-kpi-label">Moved out to BIS Testing</span>
                    </div>
                  </div>
                  {previewData.variance && (
                    <div className="report-variance-box">
                      <h3 className="report-variance-title">Incoming vs Outgoing vs Last Week</h3>
                      <div className="report-variance-grid">
                        <div className="report-variance-item">
                          <span className="report-variance-label">This week incoming (to QA)</span>
                          <span className="report-variance-value">{previewData.variance.this_week_incoming ?? 0}</span>
                          <span className={`report-variance-delta ${(previewData.variance.incoming_change ?? 0) >= 0 ? 'up' : 'down'}`}>
                            {(previewData.variance.incoming_change ?? 0) >= 0 ? '+' : ''}{previewData.variance.incoming_change ?? 0} vs last week
                          </span>
                        </div>
                        <div className="report-variance-item">
                          <span className="report-variance-label">This week outgoing (from QA)</span>
                          <span className="report-variance-value">{previewData.variance.this_week_outgoing ?? 0}</span>
                          <span className={`report-variance-delta ${(previewData.variance.outgoing_change ?? 0) >= 0 ? 'up' : 'down'}`}>
                            {(previewData.variance.outgoing_change ?? 0) >= 0 ? '+' : ''}{previewData.variance.outgoing_change ?? 0} vs last week
                          </span>
                        </div>
                        <div className="report-variance-item muted">
                          <span className="report-variance-label">Last week incoming</span>
                          <span className="report-variance-value">{previewData.variance.last_week_incoming ?? 0}</span>
                        </div>
                        <div className="report-variance-item muted">
                          <span className="report-variance-label">Last week outgoing</span>
                          <span className="report-variance-value">{previewData.variance.last_week_outgoing ?? 0}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* Page 2: Tickets QA worked on last week */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Tickets QA worked on (report week)</h2>
                  <div className="report-table-wrap">
                    <table className="report-table report-table-full">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Title</th>
                          <th>Priority</th>
                          <th>Status</th>
                          <th>QC Tester</th>
                          <th>Module</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData.tickets_worked_on_this_week || []).map((t, idx) => (
                          <tr key={t.ticket_id || idx}>
                            <td>
                              <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                              <TicketExternalLink ticketId={t.ticket_id} />
                            </td>
                            <td className="report-cell-truncate" title={t.title}>{(t.title || '—').slice(0, 50)}{(t.title || '').length > 50 ? '…' : ''}</td>
                            <td>{t.priority || '—'}</td>
                            <td>{t.status || '—'}</td>
                            <td>{t.qc_tester || t.qa_tester || '—'}</td>
                            <td>{t.module || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!previewData.tickets_worked_on_this_week || previewData.tickets_worked_on_this_week.length === 0) && (
                      <p className="report-empty-msg">No tickets in scope for this week.</p>
                    )}
                  </div>
                </section>

                {/* Tickets failed by QA */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Tickets failed by QA (report week)</h2>
                  <div className="report-table-wrap">
                    <table className="report-table report-table-full">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Title</th>
                          <th>Priority</th>
                          <th>Times tested/failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData.qa_failed_this_week || []).map((t, idx) => (
                          <tr key={t.ticket_id || idx}>
                            <td>
                              <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                              <TicketExternalLink ticketId={t.ticket_id} />
                            </td>
                            <td className="report-cell-truncate" title={t.title}>{(t.title || '—').slice(0, 55)}{(t.title || '').length > 55 ? '…' : ''}</td>
                            <td>{t.priority || '—'}</td>
                            <td>{t.times_tested_and_failed != null ? t.times_tested_and_failed : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!previewData.qa_failed_this_week || previewData.qa_failed_this_week.length === 0) && (
                      <p className="report-empty-msg">None.</p>
                    )}
                  </div>
                </section>

                {/* Tickets put on hold */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Tickets put on hold by QA (report week)</h2>
                  <div className="report-table-wrap">
                    <table className="report-table report-table-full">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Title</th>
                          <th>Priority</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData.on_hold_this_week || []).map((t, idx) => (
                          <tr key={t.ticket_id || idx}>
                            <td>
                              <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                              <TicketExternalLink ticketId={t.ticket_id} />
                            </td>
                            <td className="report-cell-truncate" title={t.title}>{(t.title || '—').slice(0, 40)}{(t.title || '').length > 40 ? '…' : ''}</td>
                            <td>{t.priority || '—'}</td>
                            <td className="report-cell-truncate" title={t.hold_reason || t.put_on_hold_from || '—'}>
                              {t.hold_reason ? (
                                <span>{(t.hold_reason || '').slice(0, 45)}{(t.hold_reason || '').length > 45 ? '…' : ''}</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>{t.put_on_hold_from || '—'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!previewData.on_hold_this_week || previewData.on_hold_this_week.length === 0) && (
                      <p className="report-empty-msg">None.</p>
                    )}
                  </div>
                </section>

                {/* BIS Testing – detailed status with open/deferred bugs */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Tickets moved to BIS Testing (report week) – Status & bugs</h2>
                  {(previewData.bis_testing_moved || []).length === 0 ? (
                    <p className="report-empty-msg">No tickets moved to BIS Testing this week.</p>
                  ) : (
                    (previewData.bis_testing_moved || []).map((t, idx) => (
                      <div key={t.ticket_id || idx} className="report-bis-ticket-block">
                        <div className="report-bis-ticket-header">
                          <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                          <TicketExternalLink ticketId={t.ticket_id} />
                          <span className="report-bis-title">{(t.title || '—').slice(0, 60)}{(t.title || '').length > 60 ? '…' : ''}</span>
                          <span className="report-bis-meta">Priority: {t.priority || '—'} · Status: {t.status || '—'} · QA: {t.qa_tester || '—'} · Bugs: {t.bugs_open ?? 0}/{t.bugs_total ?? 0} · Pass: {t.pass_rate ?? 0}%</span>
                        </div>
                        {((t.open_bugs && t.open_bugs.length > 0) || (t.deferred_bugs && t.deferred_bugs.length > 0)) && (
                          <div className="report-bis-bugs-row">
                            {t.open_bugs && t.open_bugs.length > 0 && (
                              <div className="report-bis-bugs-list">
                                <h4 className="report-bis-bugs-head">Open bugs</h4>
                                <table className="report-table report-table-small">
                                  <thead><tr><th>ID</th><th>Subject</th><th>Status</th><th>Severity</th></tr></thead>
                                  <tbody>
                                    {t.open_bugs.slice(0, 10).map((b, i) => (
                                      <tr key={b.id || i}><td>{b.id}</td><td className="report-cell-truncate" title={b.subject}>{(b.subject || '').slice(0, 40)}{(b.subject || '').length > 40 ? '…' : ''}</td><td>{b.status}</td><td>{b.severity}</td></tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {t.deferred_bugs && t.deferred_bugs.length > 0 && (
                              <div className="report-bis-bugs-list">
                                <h4 className="report-bis-bugs-head">Deferred bugs</h4>
                                <table className="report-table report-table-small">
                                  <thead><tr><th>ID</th><th>Subject</th><th>Status</th><th>Severity</th></tr></thead>
                                  <tbody>
                                    {t.deferred_bugs.slice(0, 10).map((b, i) => (
                                      <tr key={b.id || i}><td>{b.id}</td><td className="report-cell-truncate" title={b.subject}>{(b.subject || '').slice(0, 40)}{(b.subject || '').length > 40 ? '…' : ''}</td><td>{b.status}</td><td>{b.severity}</td></tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>

                {/* Next week allocation plan */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Next week – QA allocation plan</h2>
                  <div className="report-table-wrap">
                    <table className="report-table report-table-full">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Title</th>
                          <th>Priority</th>
                          <th>ETA</th>
                          <th>QC Tester</th>
                          <th>Est. hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData.next_week_plan || []).map((t, idx) => (
                          <tr key={t.ticket_id || idx}>
                            <td>
                              <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                              <TicketExternalLink ticketId={t.ticket_id} />
                            </td>
                            <td className="report-cell-truncate" title={t.title}>{(t.title || '—').slice(0, 45)}{(t.title || '').length > 45 ? '…' : ''}</td>
                            <td>{t.priority || '—'}</td>
                            <td>{t.eta_str || '—'}</td>
                            <td>{t.qa_tester || t.qc_tester || '—'}</td>
                            <td>{t.qa_estimate != null ? `${t.qa_estimate}h` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!previewData.next_week_plan || previewData.next_week_plan.length === 0) && (
                      <p className="report-empty-msg">No planned tickets for next week.</p>
                    )}
                  </div>
                </section>

                {/* ETA calendar for next week */}
                <section className="report-page-section">
                  <h2 className="report-section-title">Next week – ETA calendar</h2>
                  <div className="report-eta-calendar">
                    {(previewData.next_week_eta_calendar || []).length === 0 ? (
                      <p className="report-empty-msg">No ETA dates for next week.</p>
                    ) : (
                      <div className="report-eta-calendar-grid">
                        {(previewData.next_week_eta_calendar || []).map((day, i) => (
                          <div key={day.date || i} className="report-eta-day">
                            <div className="report-eta-day-label">{day.date}</div>
                            <div className="report-eta-day-tickets">
                              {(day.tickets || []).map((t, j) => (
                                <div key={t.ticket_id || j} className="report-eta-ticket-card">
                                  <Link to={`/tickets?ticket=${t.ticket_id}`} className="ticket-link">#{t.ticket_id}</Link>
                                  <span className="report-eta-ticket-priority">{t.priority || '—'}</span>
                                  <span className="report-eta-ticket-title">{(t.title || '—').slice(0, 25)}{(t.title || '').length > 25 ? '…' : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* V1: simple summary when report type is v1 */}
            {reportType === 'v1' && previewData.current_week && (
              <section className="report-preview-section">
                <div className="report-summary-grid three-cols">
                  <div className="report-summary-card qa-tickets">
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.qa_tickets_count || 0}</div>
                      <div className="summary-label">Pending with QA</div>
                    </div>
                  </div>
                  <div className="report-summary-card bis-testing">
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.bis_testing_count || 0}</div>
                      <div className="summary-label">Moved to BIS</div>
                    </div>
                  </div>
                  <div className="report-summary-card closed">
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.closed_count || 0}</div>
                      <div className="summary-label">Closed</div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Production Bugs Report Section */}
        <section className="report-generator-section" style={{ marginTop: '2rem' }}>
          <div className="section-header">
            <h2>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              Production & Pre-Production Bugs Report
            </h2>
            <p className="section-subtitle">Detailed analysis of bugs found in Production and Pre-Production environments</p>
          </div>

          {/* Preview Stats */}
          {prodBugsPreview && (
            <div className="report-kpi-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)' }}>
                <span className="report-kpi-value">{prodBugsPreview.environment_breakdown?.Production?.total || 0}</span>
                <span className="report-kpi-label">Production Bugs</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                  {prodBugsPreview.environment_breakdown?.Production?.open || 0} open
                </span>
              </div>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #f57c00 0%, #e65100 100%)' }}>
                <span className="report-kpi-value">{prodBugsPreview.environment_breakdown?.['Pre-production']?.total || 0}</span>
                <span className="report-kpi-label">Pre-Production Bugs</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                  {prodBugsPreview.environment_breakdown?.['Pre-production']?.open || 0} open
                </span>
              </div>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #ff8f00 0%, #ff6f00 100%)' }}>
                <span className="report-kpi-value">{prodBugsPreview.environment_breakdown?.['BIS Testing (Pre)']?.total || 0}</span>
                <span className="report-kpi-label">BIS Testing Bugs</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                  {prodBugsPreview.environment_breakdown?.['BIS Testing (Pre)']?.open || 0} open
                </span>
              </div>
              <div className="report-kpi-card">
                <span className="report-kpi-value">{prodBugsPreview.total_bugs || 0}</span>
                <span className="report-kpi-label">Total Bugs</span>
              </div>
              <div className="report-kpi-card">
                <span className="report-kpi-value">{prodBugsPreview.tickets_affected || 0}</span>
                <span className="report-kpi-label">Tickets Affected</span>
              </div>
            </div>
          )}

          <div className="report-controls">
            <div className="control-row">
              <div className="control-actions" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button 
                  className="btn-preview"
                  onClick={fetchProdBugsPreview}
                  disabled={prodBugsLoading}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  {prodBugsLoading ? 'Loading...' : 'Refresh Stats'}
                </button>

                <button 
                  className="btn-download"
                  onClick={() => downloadProdBugsReport('excel')}
                  disabled={prodBugsLoading}
                  style={{ background: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {prodBugsLoading ? 'Generating...' : 'Download Excel'}
                </button>

                <button 
                  className="btn-download"
                  onClick={() => downloadProdBugsReport('pdf')}
                  disabled={prodBugsLoading}
                  style={{ background: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {prodBugsLoading ? 'Generating...' : 'Download PDF'}
                </button>
              </div>
            </div>
          </div>

          {prodBugsError && (
            <div className="error-message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {prodBugsError}
            </div>
          )}

          {/* Report Info */}
          <div className="info-card" style={{ marginTop: '1.5rem' }}>
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Report Contents
            </h3>
            <div className="features-grid">
              <div className="feature-item">
                <span className="feature-icon">🎯</span>
                <span>Ticket-wise bug breakdown</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">👨‍💻</span>
                <span>Developer-wise analysis</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🧪</span>
                <span>Tester-wise analysis</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⏱️</span>
                <span>Dev & QA time tracking</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📊</span>
                <span>Environment breakdown</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🔥</span>
                <span>Severity analysis</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📦</span>
                <span>Module-wise statistics</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🐛</span>
                <span>Detailed bug lists</span>
              </div>
            </div>
          </div>
        </section>

        {/* Open Bugs Report Section */}
        <section className="report-generator-section" style={{ marginTop: '2rem' }}>
          <div className="section-header">
            <h2>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Open Bugs Report
            </h2>
            <p className="section-subtitle">All currently open bugs from Redmine with ticket details, developers, testers, and ageing</p>
          </div>

          {/* Preview Stats */}
          {openBugsPreview && openBugsPreview.summary && (
            <div className="report-kpi-grid" style={{ marginBottom: '1.5rem', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' }}>
                <span className="report-kpi-value">{openBugsPreview.summary.total_bugs || 0}</span>
                <span className="report-kpi-label">Total Open Bugs</span>
              </div>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
                <span className="report-kpi-value">{openBugsPreview.summary.unique_tickets || 0}</span>
                <span className="report-kpi-label">Tickets Affected</span>
              </div>
              <div className="report-kpi-card" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' }}>
                <span className="report-kpi-value">{openBugsPreview.summary.avg_ageing || 0}</span>
                <span className="report-kpi-label">Avg Ageing (Days)</span>
              </div>
            </div>
          )}

          {/* Developer Summary Table */}
          {openBugsPreview && openBugsPreview.developer_summary && openBugsPreview.developer_summary.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Developer-wise Bug Summary (Top 15)</h4>
              <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--gradient-purple)', color: 'white' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left' }}>#</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left' }}>Developer</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center' }}>Bug Count</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center' }}>Avg Ageing (Days)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openBugsPreview.developer_summary.slice(0, 15).map((dev, idx) => (
                      <tr key={dev.developer} style={{ background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-card)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)' }}>{dev.developer}</td>
                        <td style={{ 
                          padding: '0.5rem 0.75rem', 
                          textAlign: 'center', 
                          fontWeight: 'bold',
                          color: dev.bug_count >= 20 ? '#dc2626' : dev.bug_count >= 10 ? '#ea580c' : dev.bug_count >= 5 ? '#ca8a04' : 'var(--text-primary)'
                        }}>{dev.bug_count}</td>
                        <td style={{ 
                          padding: '0.5rem 0.75rem', 
                          textAlign: 'center',
                          color: dev.avg_ageing_days > 90 ? '#dc2626' : dev.avg_ageing_days > 30 ? '#ea580c' : 'var(--text-primary)'
                        }}>{dev.avg_ageing_days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="report-controls">
            <div className="control-row">
              <div className="control-actions" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Sort By:</label>
                  <select 
                    value={openBugsSortBy} 
                    onChange={(e) => setOpenBugsSortBy(e.target.value)}
                    style={{ 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border-color)', 
                      background: 'var(--bg-card)', 
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem'
                    }}
                  >
                    <option value="ageing">Ageing (Days)</option>
                    <option value="bug_id">Bug ID</option>
                    <option value="ticket_id">Ticket ID</option>
                    <option value="developer">Developer</option>
                    <option value="severity">Severity</option>
                  </select>
                </div>

                <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Order:</label>
                  <select 
                    value={openBugsSortOrder} 
                    onChange={(e) => setOpenBugsSortOrder(e.target.value)}
                    style={{ 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border-color)', 
                      background: 'var(--bg-card)', 
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem'
                    }}
                  >
                    <option value="desc">Descending (High to Low)</option>
                    <option value="asc">Ascending (Low to High)</option>
                  </select>
                </div>

                <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Developer:</label>
                  <select 
                    value={openBugsDeveloper} 
                    onChange={(e) => setOpenBugsDeveloper(e.target.value)}
                    style={{ 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border-color)', 
                      background: 'var(--bg-card)', 
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      minWidth: '180px'
                    }}
                  >
                    <option value="">All Developers</option>
                    {openBugsPreview?.developers_list?.map(dev => (
                      <option key={dev} value={dev}>{dev}</option>
                    ))}
                  </select>
                </div>

                <button 
                  className="btn-preview"
                  onClick={fetchOpenBugsPreview}
                  disabled={openBugsLoading}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  {openBugsLoading ? 'Loading...' : 'Refresh Stats'}
                </button>

                <button 
                  className="btn-download"
                  onClick={downloadOpenBugsReport}
                  disabled={openBugsLoading}
                  style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {openBugsLoading ? 'Generating...' : (openBugsDeveloper ? `Download ${openBugsDeveloper}'s Bugs PDF` : 'Download Open Bugs PDF')}
                </button>
              </div>
            </div>
          </div>

          {openBugsError && (
            <div className="error-message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {openBugsError}
            </div>
          )}

          {/* Report Info */}
          <div className="info-card" style={{ marginTop: '1.5rem' }}>
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Report Contents
            </h3>
            <div className="features-grid">
              <div className="feature-item">
                <span className="feature-icon">🐛</span>
                <span>Bug ID & Subject</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🎫</span>
                <span>Linked Ticket ID</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">👨‍💻</span>
                <span>Developer(s) Assigned</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🧪</span>
                <span>QA Tester</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📊</span>
                <span>Bug Status</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⏳</span>
                <span>Ageing (Days)</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🔖</span>
                <span>Ticket Status</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🔥</span>
                <span>Severity Breakdown</span>
              </div>
            </div>
          </div>
        </section>

        {/* Report Features Section */}
        <section className="report-info-section">
          <div className="info-card featured">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Weekly QA Report Features
            </h3>
            <div className="features-grid">
              <div className="feature-item">
                <span className="feature-icon">📊</span>
                <span>Cover Page with Project Name</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📈</span>
                <span>QA Overview Dashboard</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📉</span>
                <span>Weekly Comparison Analysis</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">✅</span>
                <span>BIS Testing Summary</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📋</span>
                <span>Individual Ticket Details</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🐛</span>
                <span>Bug Details per Ticket</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🧪</span>
                <span>Test Execution Summary</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📅</span>
                <span>Next Week Planning</span>
              </div>
            </div>
          </div>

          <div className="info-card">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Data Sources
            </h3>
            <ul>
              <li><strong>Tickets & Time:</strong> PM Tool Excel exports</li>
              <li><strong>Bugs:</strong> Redmine API integration</li>
              <li><strong>Test Cases:</strong> TestRail API integration</li>
              <li><strong>Status Tracking:</strong> Real-time sync</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

export default ReportsModule;
