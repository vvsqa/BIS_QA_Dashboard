import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTableSort, SortableHeader } from './useTableSort';
import './dashboard.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

function ReportsModule() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [reportType, setReportType] = useState('v2'); // 'v2' for comprehensive, 'v1' for simple
  const [dateRangeType, setDateRangeType] = useState('last7days'); // 'last7days' or 'week'
  const [error, setError] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

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

  // Handle theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Fetch preview data
  const fetchPreview = async () => {
    setLoading(true);
    setError('');
    try {
      const useLast7Days = dateRangeType === 'last7days';
      let url;
      
      if (reportType === 'v2') {
        url = `${BACKEND_URL}/reports/weekly-v2/preview?last7days=${useLast7Days}`;
        if (selectedDate) {
          url += `&date=${selectedDate}`;
        }
      } else {
        url = selectedDate 
          ? `${BACKEND_URL}/reports/weekly/preview?date=${selectedDate}`
          : `${BACKEND_URL}/reports/weekly/preview`;
      }
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch report preview');
      
      const data = await response.json();
      setPreviewData(data);
    } catch (err) {
      setError(err.message);
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
      let url;
      
      if (reportType === 'v2') {
        url = `${BACKEND_URL}/reports/weekly-v2?last7days=${useLast7Days}`;
        if (selectedDate) {
          url += `&date=${selectedDate}`;
        }
        if (projectName) {
          url += `&project=${encodeURIComponent(projectName)}`;
        }
      } else {
        url = selectedDate 
          ? `${BACKEND_URL}/reports/weekly?date=${selectedDate}`
          : `${BACKEND_URL}/reports/weekly`;
      }
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to generate report');
      
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
      setError(err.message);
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

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <img src="/techversant-logo.png" alt="Techversant" className="company-logo" />
          <div className="logo-text">
            <span className="logo-title">QA Dashboard</span>
            <span className="logo-subtitle">Reports</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <a href="/" className="nav-item">
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </a>
          <a href="/tickets" className="nav-item">
            <span className="nav-icon">🎫</span>
            <span>Tickets</span>
          </a>
          <a href="/all-bugs" className="nav-item">
            <span className="nav-icon">🐛</span>
            <span>All Bugs</span>
          </a>
          <a href="/employees" className="nav-item">
            <span className="nav-icon">👥</span>
            <span>Employees</span>
          </a>
          <a href="/calendar" className="nav-item">
            <span className="nav-icon">📅</span>
            <span>Calendar</span>
          </a>
          <a href="/planning" className="nav-item">
            <span className="nav-icon">📋</span>
            <span>Task Planning</span>
          </a>
          <a href="/reports" className="nav-item active">
            <span className="nav-icon">📈</span>
            <span>Reports</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <button 
            className="theme-toggle" 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </aside>

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

        {/* Preview Section */}
        {previewData && (
          <section className="report-preview-section">
            <div className="section-header">
              <h2>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M3 9h18"/>
                </svg>
                Report Preview: {previewData.week_start} to {previewData.week_end}
              </h2>
            </div>

            {/* Summary Cards - V2 Format */}
            {reportType === 'v2' && previewData.current_week && (
              <>
                {/* Main KPIs */}
                <div className="report-summary-grid three-cols">
                  <div className="report-summary-card qa-tickets">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                        <rect x="9" y="3" width="6" height="4" rx="1"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.qa_tickets_count || 0}</div>
                      <div className="summary-label">Total Pending with QA</div>
                    </div>
                  </div>

                  <div className="report-summary-card bis-testing achievement">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.bis_testing_count || 0}</div>
                      <div className="summary-label">Moved to BIS Testing</div>
                      <div className="summary-subtext">QA Achievement</div>
                    </div>
                  </div>

                  <div className="report-summary-card closed">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9 12l2 2 4-4"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.current_week.closed_count || 0}</div>
                      <div className="summary-label">Closed (QA)</div>
                    </div>
                  </div>
                </div>

                {/* QA Pending Breakdown */}
                {previewData.qa_pending_breakdown && (
                  <div className="qa-breakdown-section">
                    <h3>QA Team Pending - Status Breakdown</h3>
                    <div className="breakdown-grid">
                      <div className="breakdown-item">
                        <span className="breakdown-status">QC Testing</span>
                        <span className="breakdown-count">{previewData.qa_pending_breakdown['QC Testing'] || 0}</span>
                      </div>
                      <div className="breakdown-item">
                        <span className="breakdown-status">QC Testing in Progress</span>
                        <span className="breakdown-count">{previewData.qa_pending_breakdown['QC Testing in Progress'] || 0}</span>
                      </div>
                      <div className="breakdown-item">
                        <span className="breakdown-status">QC Testing Hold</span>
                        <span className="breakdown-count">{previewData.qa_pending_breakdown['QC Testing Hold'] || 0}</span>
                      </div>
                    </div>
                  </div>
                )}


                {/* Quality Metrics */}
                {previewData.metrics && (
                  <div className="report-metrics-row">
                    <div className="report-metrics-card">
                      <h3>Bug Tracking</h3>
                      <div className="metrics-grid">
                        <div className="metric-item">
                          <span className="metric-value red">{previewData.metrics.total_bugs || 0}</span>
                          <span className="metric-label">Total Bugs</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value orange">{previewData.metrics.bugs_open || 0}</span>
                          <span className="metric-label">Open</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value green">{previewData.metrics.bugs_fixed || 0}</span>
                          <span className="metric-label">Fixed</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value purple">{previewData.metrics.bugs_deferred || 0}</span>
                          <span className="metric-label">Deferred</span>
                        </div>
                      </div>
                    </div>

                    <div className="report-metrics-card">
                      <h3>Test Execution</h3>
                      <div className="metrics-grid">
                        <div className="metric-item">
                          <span className="metric-value blue">{previewData.metrics.total_test_cases || 0}</span>
                          <span className="metric-label">Total Tests</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value green">{previewData.metrics.tests_passed || 0}</span>
                          <span className="metric-label">Passed</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value red">{previewData.metrics.tests_failed || 0}</span>
                          <span className="metric-label">Failed</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-value purple">
                            {previewData.metrics.total_test_cases > 0 
                              ? Math.round((previewData.metrics.tests_passed / previewData.metrics.total_test_cases) * 100)
                              : 0}%
                          </span>
                          <span className="metric-label">Pass Rate</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* BIS Testing Tickets */}
                {previewData.bis_testing_tickets && previewData.bis_testing_tickets.length > 0 && (
                  <div className="report-table-section">
                    <h3>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                      Tickets Moved to BIS Testing ({previewData.bis_testing_tickets.length})
                    </h3>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <SortableHeader columnKey="ticket_id" onSort={handleBisSort} sortConfig={bisSortConfig}>Ticket ID</SortableHeader>
                          <SortableHeader columnKey="title" onSort={handleBisSort} sortConfig={bisSortConfig}>Title</SortableHeader>
                          <SortableHeader columnKey="bugs_open" onSort={handleBisSort} sortConfig={bisSortConfig}>Bugs (Open/Total)</SortableHeader>
                          <SortableHeader columnKey="tests_total" onSort={handleBisSort} sortConfig={bisSortConfig}>Tests</SortableHeader>
                          <SortableHeader columnKey="pass_rate" onSort={handleBisSort} sortConfig={bisSortConfig}>Pass Rate</SortableHeader>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBisTickets.slice(0, 10).map((ticket, idx) => (
                          <tr key={idx}>
                            <td 
                              className="clickable-cell"
                              onClick={() => navigate(`/?ticket=${ticket.ticket_id}`)}
                            >
                              #{ticket.ticket_id}
                            </td>
                            <td className="truncate">{ticket.title}</td>
                            <td>
                              <span className="bugs-count">
                                <span className={ticket.bugs_open > 0 ? 'open' : 'fixed'}>{ticket.bugs_open}</span>
                                /{ticket.bugs_total}
                              </span>
                            </td>
                            <td>{ticket.tests_total}</td>
                            <td>
                              <span className={`pass-rate ${ticket.pass_rate >= 90 ? 'high' : ticket.pass_rate >= 70 ? 'medium' : 'low'}`}>
                                {ticket.pass_rate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Closed Tickets */}
                {previewData.closed_tickets && previewData.closed_tickets.length > 0 && (
                  <div className="report-table-section">
                    <h3>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9 12l2 2 4-4"/>
                      </svg>
                      Tickets Closed This Week ({previewData.closed_tickets.length})
                    </h3>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <SortableHeader columnKey="ticket_id" onSort={handleClosedSort} sortConfig={closedSortConfig}>Ticket ID</SortableHeader>
                          <SortableHeader columnKey="title" onSort={handleClosedSort} sortConfig={closedSortConfig}>Title</SortableHeader>
                          <SortableHeader columnKey="bugs_closed" onSort={handleClosedSort} sortConfig={closedSortConfig}>Bugs Closed</SortableHeader>
                          <SortableHeader columnKey="tests_passed" onSort={handleClosedSort} sortConfig={closedSortConfig}>Tests Passed</SortableHeader>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedClosedTickets.slice(0, 10).map((ticket, idx) => (
                          <tr key={idx}>
                            <td 
                              className="clickable-cell"
                              onClick={() => navigate(`/?ticket=${ticket.ticket_id}`)}
                            >
                              #{ticket.ticket_id}
                            </td>
                            <td className="truncate">{ticket.title}</td>
                            <td>{ticket.bugs_closed}</td>
                            <td>{ticket.tests_passed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* V1 Format - Legacy */}
            {reportType === 'v1' && previewData.summary && (
              <>
                <div className="report-summary-grid">
                  <div className="report-summary-card bis-testing">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.summary?.moved_to_bis_this_week || 0}</div>
                      <div className="summary-label">Moved to BIS Testing</div>
                    </div>
                  </div>

                  <div className="report-summary-card closed">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9 12l2 2 4-4"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.summary?.total_closed || 0}</div>
                      <div className="summary-label">Closed This Week</div>
                    </div>
                  </div>

                  <div className="report-summary-card in-progress">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.summary?.total_in_progress || 0}</div>
                      <div className="summary-label">In Progress</div>
                    </div>
                  </div>

                  <div className="report-summary-card planned">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <div className="summary-value">{previewData.summary?.planned_next_week || 0}</div>
                      <div className="summary-label">Planned Next Week</div>
                    </div>
                  </div>
                </div>

                <div className="report-metrics-row">
                  <div className="report-metrics-card">
                    <h3>Bug Tracking</h3>
                    <div className="metrics-grid">
                      <div className="metric-item">
                        <span className="metric-value red">{previewData.summary?.total_bugs_found || 0}</span>
                        <span className="metric-label">Bugs Found</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-value green">{previewData.summary?.total_bugs_fixed || 0}</span>
                        <span className="metric-label">Bugs Fixed</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-value orange">{(previewData.summary?.total_bugs_found || 0) - (previewData.summary?.total_bugs_fixed || 0)}</span>
                        <span className="metric-label">Bugs Open</span>
                      </div>
                    </div>
                  </div>

                  <div className="report-metrics-card">
                    <h3>Test Execution</h3>
                    <div className="metrics-grid">
                      <div className="metric-item">
                        <span className="metric-value blue">{previewData.summary?.total_test_cases || 0}</span>
                        <span className="metric-label">Total Tests</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-value green">{previewData.summary?.test_cases_passed || 0}</span>
                        <span className="metric-label">Passed</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-value red">{previewData.summary?.test_cases_failed || 0}</span>
                        <span className="metric-label">Failed</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* Report Features Section */}
        <section className="report-info-section">
          <div className="info-card featured">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Comprehensive Report Features
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
