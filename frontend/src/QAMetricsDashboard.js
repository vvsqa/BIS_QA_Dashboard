import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler,
} from 'chart.js';
import { apiFetch, API_BASE } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './dashboard.css';
import './QAMetricsDashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler
);

const BACKEND_URL = (API_BASE || '').replace(/\/$/, '');

const PERIOD_OPTIONS = [
  { value: 'past_week', label: 'Past Week', days: 7 },
  { value: 'past_month', label: 'Past Month', days: 30 },
  { value: 'past_quarter', label: 'Past Quarter', days: 90 },
  { value: 'past_year', label: 'Past Year', days: 365 },
  { value: 'overall', label: 'Overall', days: null },
];

function QAMetricsDashboard({ isPublic = false }) {
  useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('past_month');
  const [metricsData, setMetricsData] = useState(null);
  const [periodComparison, setPeriodComparison] = useState(null);
  const [ticketList, setTicketList] = useState([]);
  const [ticketSort, setTicketSort] = useState({ field: 'qc_cycle_days', direction: 'desc' });
  const [ticketFilter, setTicketFilter] = useState('');
  const [showTicketList, setShowTicketList] = useState(true);
  const [exporting, setExporting] = useState(false);
  const now = new Date();
  const [startMonth, setStartMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [startYear, setStartYear] = useState(String(now.getFullYear()));
  const [endMonth, setEndMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [endYear, setEndYear] = useState(String(now.getFullYear()));
  const [useMonthYearRange, setUseMonthYearRange] = useState(false);

  const yearOptions = Array.from({ length: 7 }, (_, i) => String(now.getFullYear() - 5 + i));
  const monthOptions = [
    { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
    { value: '04', label: 'Apr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
    { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' }, { value: '09', label: 'Sep' },
    { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
  ];

  const getRangeParams = () => {
    if (!useMonthYearRange) return '';
    const start = `${startYear}-${startMonth}-01`;
    const endDate = new Date(Number(endYear), Number(endMonth), 0);
    const end = `${endYear}-${endMonth}-${String(endDate.getDate()).padStart(2, '0')}`;
    return `&start_date=${start}&end_date=${end}`;
  };

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = isPublic ? '/api/public/qa-metrics' : '/api/qa-metrics';
      const url = `${BACKEND_URL}${endpoint}?period=${selectedPeriod}${getRangeParams()}`;
      const response = isPublic ? await fetch(url) : await apiFetch(url);
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetricsData(data.metrics);
      setTicketList(data.tickets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, isPublic, useMonthYearRange, startMonth, startYear, endMonth, endYear]);

  const fetchPeriodComparison = useCallback(async () => {
    try {
      const endpoint = isPublic ? '/api/public/qa-metrics/comparison' : '/api/qa-metrics/comparison';
      const url = `${BACKEND_URL}${endpoint}`;
      const response = isPublic ? await fetch(url) : await apiFetch(url);
      if (response.ok) {
        const data = await response.json();
        setPeriodComparison(data);
      }
    } catch (err) {
      console.error('Failed to fetch comparison:', err);
    }
  }, [isPublic]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    fetchPeriodComparison();
  }, [fetchPeriodComparison]);

  const handleSort = (field) => {
    setTicketSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedTickets = [...ticketList]
    .filter(t => {
      if (!ticketFilter) return true;
      const search = ticketFilter.toLowerCase();
      return (
        String(t.ticket_id).includes(search) ||
        (t.current_status || '').toLowerCase().includes(search) ||
        (t.priority || '').toLowerCase().includes(search) ||
        (t.platform || '').toLowerCase().includes(search) ||
        (t.qc_tester || '').toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      const aVal = a[ticketSort.field] ?? 0;
      const bVal = b[ticketSort.field] ?? 0;
      if (ticketSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getCycleColor = (cycles) => {
    if (cycles === 1) return 'qam-badge-green';
    if (cycles === 2) return 'qam-badge-yellow';
    return 'qam-badge-red';
  };

  const getDaysColor = (days) => {
    if (days === null || days === undefined) return '';
    if (days <= 3) return 'qam-badge-green';
    if (days <= 7) return 'qam-badge-yellow';
    return 'qam-badge-red';
  };

  const handleTicketClick = (ticketId) => {
    if (isPublic) {
      // For public page, open in new tab or show alert
      window.open(`/ticket?search=${ticketId}`, '_blank');
    } else {
      navigate(`/ticket?search=${ticketId}`);
    }
  };

  const handlePeriodSelect = (periodValue) => {
    setSelectedPeriod(periodValue);
    setShowTicketList(true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const endpoint = isPublic ? '/api/public/qa-metrics/export' : '/api/qa-metrics/export';
      const url = `${BACKEND_URL}${endpoint}?period=${selectedPeriod}${getRangeParams()}`;
      const response = isPublic ? await fetch(url) : await apiFetch(url);
      if (!response.ok) throw new Error('Failed to export Excel');

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `qa_metrics_${selectedPeriod}.xlsx`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err.message || 'Failed to export Excel');
    } finally {
      setExporting(false);
    }
  };

  if (error) {
    return (
      <div className={isPublic ? 'qam-public-layout' : 'app-layout'}>
        {!isPublic && <AppSidebar />}
        <main className={isPublic ? 'qam-public-main' : 'main-content'}>
          <div className="error-container">
            <span className="error-icon">⚠️</span>
            <p>{error}</p>
            <button onClick={fetchMetrics} className="btn btn-primary">Retry</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={isPublic ? 'qam-public-layout' : 'app-layout'}>
      {!isPublic && <AppSidebar />}
      <main className={isPublic ? 'qam-public-main' : 'main-content'}>
        <header className={isPublic ? 'qam-public-header' : 'content-header'}>
          <div className="header-left">
            <h1>QA Metrics Dashboard</h1>
          </div>
          <div className="header-actions">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="qam-period-select"
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <label className="qam-range-toggle">
              <input
                type="checkbox"
                checked={useMonthYearRange}
                onChange={(e) => setUseMonthYearRange(e.target.checked)}
              />
              Month/Year Range
            </label>
            {useMonthYearRange && (
              <div className="qam-range-controls">
                <select value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className="qam-period-select">
                  {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select value={startYear} onChange={(e) => setStartYear(e.target.value)} className="qam-period-select">
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <span>to</span>
                <select value={endMonth} onChange={(e) => setEndMonth(e.target.value)} className="qam-period-select">
                  {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select value={endYear} onChange={(e) => setEndYear(e.target.value)} className="qam-period-select">
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading metrics...</p>
          </div>
        ) : (
          <div className="qam-content">
            {/* Key Metrics Widgets - AT TOP */}
            <section className="qam-section qam-metrics-section">
              <div className="qam-metrics-grid">
                {/* Metric 1: QC Cycle Time */}
                <div className="qam-metric-card qam-metric-blue">
                  <div className="qam-metric-header">
                    <span className="qam-metric-icon">⏱️</span>
                    <span className="qam-metric-label">QC Cycle Time</span>
                  </div>
                  <div className="qam-metric-value">{metricsData?.avg_qc_cycle_days || 0}<span className="qam-metric-unit">days avg</span></div>
                  <div className="qam-metric-stats">
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.median_qc_cycle_days || 0}</span>
                      <span className="qam-stat-label">Median</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.completed_tickets || 0}</span>
                      <span className="qam-stat-label">Completed</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.total_tickets || 0}</span>
                      <span className="qam-stat-label">Total</span>
                    </div>
                  </div>
                </div>

                {/* Metric 2: Test Cycle Time */}
                <div className="qam-metric-card qam-metric-purple">
                  <div className="qam-metric-header">
                    <span className="qam-metric-icon">🔄</span>
                    <span className="qam-metric-label">Test Cycle Time</span>
                  </div>
                  <div className="qam-metric-value">{metricsData?.avg_test_cycle_days || 0}<span className="qam-metric-unit">days avg</span></div>
                  <div className="qam-metric-stats">
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.total_test_cycles || 0}</span>
                      <span className="qam-stat-label">Total Cycles</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value qam-stat-green">{metricsData?.pass_cycles || 0}</span>
                      <span className="qam-stat-label">Pass</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value qam-stat-red">{metricsData?.fail_cycles || 0}</span>
                      <span className="qam-stat-label">Fail</span>
                    </div>
                  </div>
                </div>

                {/* Metric 3: First Pass Rate */}
                <div className="qam-metric-card qam-metric-orange">
                  <div className="qam-metric-header">
                    <span className="qam-metric-icon">🎯</span>
                    <span className="qam-metric-label">First Pass Rate</span>
                  </div>
                  <div className="qam-metric-value">{metricsData?.first_pass_rate || 0}<span className="qam-metric-unit">%</span></div>
                  <div className="qam-metric-stats">
                    <div className="qam-stat">
                      <span className="qam-stat-value qam-stat-green">{metricsData?.one_cycle_count || 0}</span>
                      <span className="qam-stat-label">1 Cycle</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value qam-stat-yellow">{metricsData?.cycle_distribution?.['2'] || 0}</span>
                      <span className="qam-stat-label">2 Cycles</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value qam-stat-red">{metricsData?.cycle_distribution?.['3+'] || 0}</span>
                      <span className="qam-stat-label">3+ Cycles</span>
                    </div>
                  </div>
                </div>

                {/* Metric 4: Waiting Time */}
                <div className="qam-metric-card qam-metric-teal">
                  <div className="qam-metric-header">
                    <span className="qam-metric-icon">⏳</span>
                    <span className="qam-metric-label">Queue Wait Time</span>
                  </div>
                  <div className="qam-metric-value">{metricsData?.avg_waiting_days || 0}<span className="qam-metric-unit">days avg</span></div>
                  <div className="qam-metric-stats">
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.total_waiting_events || 0}</span>
                      <span className="qam-stat-label">Events</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.max_waiting_days || 0}</span>
                      <span className="qam-stat-label">Max Days</span>
                    </div>
                    <div className="qam-stat">
                      <span className="qam-stat-value">{metricsData?.total_tickets - metricsData?.completed_tickets || 0}</span>
                      <span className="qam-stat-label">In Progress</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Time Period Filter - Clickable Cards */}
            <section className="qam-section">
              <h2 className="qam-section-title">Select Time Period</h2>
              <div className="qam-period-filter-grid">
                {PERIOD_OPTIONS.map(opt => {
                  const data = periodComparison?.[opt.value] || {};
                  const isSelected = opt.value === selectedPeriod;
                  return (
                    <div
                      key={opt.value}
                      className={`qam-period-filter-card ${isSelected ? 'qam-period-filter-active' : ''}`}
                      onClick={() => handlePeriodSelect(opt.value)}
                    >
                      <div className="qam-period-filter-label">{opt.label}</div>
                      <div className="qam-period-filter-count">{data.total_tickets || 0} tickets</div>
                      {isSelected && <div className="qam-period-filter-indicator">▼</div>}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Ticket List - Shows when period selected */}
            {showTicketList && (
              <section className="qam-section">
                <div className="qam-section-header">
                  <h2 className="qam-section-title">
                    Tickets - {PERIOD_OPTIONS.find(p => p.value === selectedPeriod)?.label} ({sortedTickets.length} tickets)
                  </h2>
                  <input
                    type="text"
                    placeholder="Filter tickets..."
                    value={ticketFilter}
                    onChange={(e) => setTicketFilter(e.target.value)}
                    className="qam-filter-input"
                  />
                </div>
                <div className="qam-table-container">
                  <table className="qam-table">
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('ticket_id')}>
                          Ticket ID {ticketSort.field === 'ticket_id' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>QC Tester</th>
                        <th onClick={() => handleSort('qc_cycle_days')}>
                          Total QC Days {ticketSort.field === 'qc_cycle_days' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th onClick={() => handleSort('active_testing_days')}>
                          Active Testing {ticketSort.field === 'active_testing_days' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th onClick={() => handleSort('waiting_in_queue_days')}>
                          Queue Wait {ticketSort.field === 'waiting_in_queue_days' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th onClick={() => handleSort('dev_hold_days')}>
                          Dev Hold {ticketSort.field === 'dev_hold_days' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th onClick={() => handleSort('qa_hold_days')}>
                          QA Hold {ticketSort.field === 'qa_hold_days' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th onClick={() => handleSort('test_cycles')}>
                          Cycles {ticketSort.field === 'test_cycles' && (ticketSort.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th>QC Start</th>
                        <th>BIS Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTickets.slice(0, 100).map((ticket) => (
                        <tr key={ticket.ticket_id}>
                          <td 
                            className="qam-ticket-id qam-ticket-link"
                            onClick={() => handleTicketClick(ticket.ticket_id)}
                            title="Click to view in Ticket Dashboard"
                          >
                            {ticket.ticket_id}
                          </td>
                          <td>{ticket.current_status || '-'}</td>
                          <td>{ticket.priority || '-'}</td>
                          <td>{ticket.qc_tester || '-'}</td>
                          <td>
                            {ticket.qc_cycle_days !== null ? (
                              <span className={`qam-badge ${getDaysColor(ticket.qc_cycle_days)}`}>
                                {ticket.qc_cycle_days}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {ticket.active_testing_days !== null ? (
                              <span className={`qam-badge ${getDaysColor(ticket.active_testing_days)}`}>
                                {ticket.active_testing_days}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {ticket.waiting_in_queue_days !== null ? (
                              <span className={`qam-badge ${getDaysColor(ticket.waiting_in_queue_days)}`}>
                                {ticket.waiting_in_queue_days}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {ticket.dev_hold_days !== null && ticket.dev_hold_days > 0 ? (
                              <span className="qam-badge qam-badge-orange">
                                {ticket.dev_hold_days}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {ticket.qa_hold_days !== null && ticket.qa_hold_days > 0 ? (
                              <span className="qam-badge qam-badge-purple">
                                {ticket.qa_hold_days}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            <span className={`qam-badge ${getCycleColor(ticket.test_cycles)}`}>
                              {ticket.test_cycles || 0}
                            </span>
                          </td>
                          <td className="qam-date-cell">{formatDate(ticket.first_qc_testing)}</td>
                          <td className="qam-date-cell">{formatDate(ticket.first_bis_testing)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sortedTickets.length > 100 && (
                    <div className="qam-table-footer">
                      Showing 100 of {sortedTickets.length} tickets. Use filter to narrow results.
                    </div>
                  )}
                </div>
                
                {/* Column Legend */}
                <div className="qam-legend">
                  <div className="qam-legend-item">
                    <span className="qam-legend-color" style={{background: '#3498db'}}></span>
                    <span><strong>Total QC Days:</strong> Full cycle from QC Testing → BIS Testing</span>
                  </div>
                  <div className="qam-legend-item">
                    <span className="qam-legend-color" style={{background: '#27ae60'}}></span>
                    <span><strong>Active Testing:</strong> Days in "QC Testing in Progress" status</span>
                  </div>
                  <div className="qam-legend-item">
                    <span className="qam-legend-color" style={{background: '#9b59b6'}}></span>
                    <span><strong>Queue Wait:</strong> Days waiting in "QC Testing" before pickup</span>
                  </div>
                  <div className="qam-legend-item">
                    <span className="qam-legend-color" style={{background: '#e67e22'}}></span>
                    <span><strong>Dev Hold:</strong> Days in "QC Review Fail" / "Tested - Awaiting Fixes" (dev fixing)</span>
                  </div>
                  <div className="qam-legend-item">
                    <span className="qam-legend-color" style={{background: '#8e44ad'}}></span>
                    <span><strong>QA Hold:</strong> Days in "QC Testing Hold" / "QC Testing On-hold"</span>
                  </div>
                </div>
              </section>
            )}

            {/* Charts Section */}
            {metricsData?.cycle_distribution && (
              <section className="qam-section">
                <h2 className="qam-section-title">Cycle Distribution</h2>
                <div className="qam-charts-grid">
                  <div className="qam-chart-card">
                    <h3>Tickets by Cycle Count</h3>
                    <div className="qam-chart-container">
                      <Doughnut
                        data={{
                          labels: ['1 Cycle (First Pass)', '2 Cycles', '3+ Cycles'],
                          datasets: [{
                            data: [
                              metricsData.cycle_distribution['1'] || 0,
                              metricsData.cycle_distribution['2'] || 0,
                              metricsData.cycle_distribution['3+'] || 0,
                            ],
                            backgroundColor: ['#27ae60', '#f1c40f', '#e74c3c'],
                            borderWidth: 0,
                          }]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { position: 'bottom' }
                          }
                        }}
                      />
                    </div>
                  </div>

                  {metricsData?.daily_trend && (
                    <div className="qam-chart-card qam-chart-wide">
                      <h3>Daily QC Cycle Time Trend</h3>
                      <div className="qam-chart-container">
                        <Line
                          data={{
                            labels: metricsData.daily_trend.map(d => d.date),
                            datasets: [{
                              label: 'Avg Cycle Days',
                              data: metricsData.daily_trend.map(d => d.avg_days),
                              borderColor: '#3498db',
                              backgroundColor: 'rgba(52, 152, 219, 0.1)',
                              fill: true,
                              tension: 0.4,
                            }]
                          }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { display: false }
                            },
                            scales: {
                              y: { beginAtZero: true }
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

          </div>
        )}
      </main>
    </div>
  );
}

export default QAMetricsDashboard;
