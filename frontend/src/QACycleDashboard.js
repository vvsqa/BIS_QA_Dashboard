import React, { useState, useEffect, useCallback } from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
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
import './QACycleDashboard.css';

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

// Tab definitions
const TABS = [
  { id: 'dashboard', label: 'Executive Dashboard', icon: '📊' },
  { id: 'impact', label: 'Historical Impact', icon: '📈' },
  { id: 'tickets', label: 'Ticket Data', icon: '🎫' },
  { id: 'methodology', label: 'Methodology', icon: '📋' },
];

// Helper to get month options for dropdown
const getMonthOptions = () => {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    });
  }
  return options;
};

function QACycleDashboard() {
  useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsPagination, setTicketsPagination] = useState({ offset: 0, limit: 50, total: 0 });
  const [ticketFilters, setTicketFilters] = useState({ search: '', platform: '', priority: '', minCycles: '' });
  const [downloading, setDownloading] = useState(false);
  
  // Date filter state
  const [dateFilterType, setDateFilterType] = useState('all'); // 'all', 'month', 'custom'
  const [selectedMonth, setSelectedMonth] = useState('');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const monthOptions = getMonthOptions();

  // Build date filter params
  const getDateParams = useCallback(() => {
    const params = new URLSearchParams();
    if (dateFilterType === 'month' && selectedMonth) {
      const [year, month] = selectedMonth.split('-');
      const startDate = new Date(year, parseInt(month) - 1, 1);
      const endDate = new Date(year, parseInt(month), 0); // Last day of month
      params.append('start_date', startDate.toISOString().split('T')[0]);
      params.append('end_date', endDate.toISOString().split('T')[0]);
    } else if (dateFilterType === 'custom' && customStartDate && customEndDate) {
      params.append('start_date', customStartDate);
      params.append('end_date', customEndDate);
    }
    return params.toString();
  }, [dateFilterType, selectedMonth, customStartDate, customEndDate]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dateParams = getDateParams();
      const url = `${BACKEND_URL}/api/qa-dashboard/metrics${dateParams ? '?' + dateParams : ''}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load metrics: ${response.status}`);
      }
      const data = await response.json();
      setMetrics(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getDateParams]);

  const fetchTickets = useCallback(async (newOffset = 0) => {
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: ticketsPagination.limit.toString(),
        offset: newOffset.toString(),
      });
      if (ticketFilters.platform) params.append('platform', ticketFilters.platform);
      if (ticketFilters.priority) params.append('priority', ticketFilters.priority);
      if (ticketFilters.minCycles) params.append('min_cycles', ticketFilters.minCycles);
      
      // Add date filters
      if (dateFilterType === 'month' && selectedMonth) {
        const [year, month] = selectedMonth.split('-');
        const startDate = new Date(year, parseInt(month) - 1, 1);
        const endDate = new Date(year, parseInt(month), 0);
        params.append('start_date', startDate.toISOString().split('T')[0]);
        params.append('end_date', endDate.toISOString().split('T')[0]);
      } else if (dateFilterType === 'custom' && customStartDate && customEndDate) {
        params.append('start_date', customStartDate);
        params.append('end_date', customEndDate);
      }

      const response = await apiFetch(`${BACKEND_URL}/api/qa-dashboard/tickets?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to load tickets: ${response.status}`);
      }
      const data = await response.json();
      setTickets(data.tickets || []);
      setTicketsPagination(prev => ({ ...prev, offset: newOffset, total: data.total || 0 }));
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      setTicketsLoading(false);
    }
  }, [ticketsPagination.limit, ticketFilters, dateFilterType, selectedMonth, customStartDate, customEndDate]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (activeTab === 'tickets' && tickets.length === 0 && !ticketsLoading) {
      fetchTickets(0);
    }
  }, [activeTab, tickets.length, ticketsLoading, fetchTickets]);

  const handleDownloadExcel = async () => {
    setDownloading(true);
    try {
      const dateParams = getDateParams();
      const url = `${BACKEND_URL}/reports/qa-dashboard/download${dateParams ? '?' + dateParams : ''}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error('Failed to download dashboard');
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      
      // Include date range in filename
      let filename = 'QA_Dashboard';
      if (dateFilterType === 'month' && selectedMonth) {
        filename += `_${selectedMonth}`;
      } else if (dateFilterType === 'custom' && customStartDate && customEndDate) {
        filename += `_${customStartDate}_to_${customEndDate}`;
      } else {
        filename += `_${new Date().toISOString().split('T')[0]}`;
      }
      a.download = `${filename}.xlsx`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      a.remove();
    } catch (err) {
      alert('Failed to download: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };
  
  // Handle date filter change
  const handleApplyDateFilter = () => {
    setTickets([]); // Clear tickets to force reload
    fetchMetrics();
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading QA Cycle Dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="error-container">
            <h2>Error Loading Dashboard</h2>
            <p>{error}</p>
            <button onClick={fetchMetrics} className="btn btn-primary">Retry</button>
          </div>
        </main>
      </div>
    );
  }

  const { summary, platform_breakdown, priority_breakdown, cycle_breakdown, monthly_trend, status_distribution, reduction_targets, qc_tester_breakdown, developer_breakdown } = metrics || {};

  // Chart colors
  const chartColors = {
    blue: 'rgba(52, 152, 219, 0.8)',
    green: 'rgba(39, 174, 96, 0.8)',
    orange: 'rgba(230, 126, 34, 0.8)',
    red: 'rgba(231, 76, 60, 0.8)',
    purple: 'rgba(155, 89, 182, 0.8)',
    teal: 'rgba(26, 188, 156, 0.8)',
    yellow: 'rgba(241, 196, 15, 0.8)',
    gray: 'rgba(149, 165, 166, 0.8)',
  };

  const pieColors = [
    chartColors.blue, chartColors.green, chartColors.orange, chartColors.red,
    chartColors.purple, chartColors.teal, chartColors.yellow, chartColors.gray,
  ];

  // Monthly Trend Chart
  const trendChartData = {
    labels: (monthly_trend || []).map(m => m.month),
    datasets: [{
      label: 'Avg QA Days',
      data: (monthly_trend || []).map(m => m.avg_days),
      borderColor: chartColors.blue,
      backgroundColor: 'rgba(52, 152, 219, 0.1)',
      fill: true,
      tension: 0.4,
    }],
  };

  const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Days' },
      },
    },
  };

  // Platform Bar Chart
  const platformChartData = {
    labels: (platform_breakdown || []).slice(0, 8).map(p => p.platform),
    datasets: [{
      label: 'Avg Days',
      data: (platform_breakdown || []).slice(0, 8).map(p => p.avg_days),
      backgroundColor: pieColors,
    }],
  };

  const platformChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        beginAtZero: true,
        title: { display: true, text: 'Avg Days' },
      },
    },
  };

  // Cycle Distribution Chart
  const cycleChartData = {
    labels: (cycle_breakdown || []).map(c => c.cycles),
    datasets: [{
      label: 'Avg Days',
      data: (cycle_breakdown || []).map(c => c.avg_days),
      backgroundColor: [chartColors.green, chartColors.orange, chartColors.red],
    }],
  };

  const cycleChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Avg Days' },
      },
    },
  };

  // Status Distribution Pie Chart
  const statusChartData = {
    labels: (status_distribution || []).slice(0, 6).map(s => s.status),
    datasets: [{
      data: (status_distribution || []).slice(0, 6).map(s => s.count),
      backgroundColor: pieColors,
    }],
  };

  const statusChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { boxWidth: 12, font: { size: 11 } },
      },
    },
  };

  // Helper to format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Render Executive Dashboard Tab
  const renderDashboardTab = () => (
    <>
      {/* KPI Widgets Row 1 */}
      <div className="qa-widgets-row">
        <div className="qa-widget qa-widget-blue">
          <div className="qa-widget-value">{summary?.total_tickets?.toLocaleString() || 0}</div>
          <div className="qa-widget-label">Total Tickets</div>
        </div>
        <div className="qa-widget qa-widget-green">
          <div className="qa-widget-value">{summary?.qa_completed?.toLocaleString() || 0}</div>
          <div className="qa-widget-label">QA Completed</div>
        </div>
        <div className="qa-widget qa-widget-orange">
          <div className="qa-widget-value">{summary?.avg_qa_days || 0}</div>
          <div className="qa-widget-label">Avg QA Days</div>
        </div>
        <div className="qa-widget qa-widget-purple">
          <div className="qa-widget-value">{summary?.median_qa_days || 0}</div>
          <div className="qa-widget-label">Median Days</div>
        </div>
        <div className="qa-widget qa-widget-green">
          <div className="qa-widget-value">{summary?.first_pass_rate || 0}%</div>
          <div className="qa-widget-label">First Pass Rate</div>
        </div>
        <div className="qa-widget qa-widget-blue">
          <div className="qa-widget-value">{summary?.avg_cycles || 0}</div>
          <div className="qa-widget-label">Avg Cycles</div>
        </div>
      </div>

      {/* KPI Widgets Row 2 */}
      <div className="qa-widgets-row qa-widgets-row-small">
        <div className="qa-widget qa-widget-red qa-widget-small">
          <div className="qa-widget-value">{summary?.total_fails?.toLocaleString() || 0}</div>
          <div className="qa-widget-label">Total QA Fails</div>
        </div>
        <div className="qa-widget qa-widget-yellow qa-widget-small">
          <div className="qa-widget-value">{summary?.in_qa_now || 0}</div>
          <div className="qa-widget-label">In QA Now</div>
        </div>
        <div className="qa-widget qa-widget-teal qa-widget-small">
          <div className="qa-widget-value">{summary?.total_hold_hours?.toLocaleString() || 0}</div>
          <div className="qa-widget-label">Total Hold Hours</div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="qa-charts-row">
        <div className="qa-chart-card qa-chart-wide">
          <h3>Monthly QA Cycle Time Trend</h3>
          <div className="qa-chart-container">
            <Line data={trendChartData} options={trendChartOptions} />
          </div>
        </div>
        <div className="qa-chart-card">
          <h3>Status Distribution</h3>
          <div className="qa-chart-container">
            <Pie data={statusChartData} options={statusChartOptions} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="qa-charts-row">
        <div className="qa-chart-card">
          <h3>QA Time by Platform</h3>
          <div className="qa-chart-container qa-chart-tall">
            <Bar data={platformChartData} options={platformChartOptions} />
          </div>
        </div>
        <div className="qa-chart-card">
          <h3>Impact of Rework (Cycles)</h3>
          <div className="qa-chart-container">
            <Bar data={cycleChartData} options={cycleChartOptions} />
          </div>
          {cycle_breakdown && cycle_breakdown.length >= 2 && (
            <div className="qa-insight">
              <strong>Insight:</strong> Tickets with 2 cycles take{' '}
              {(cycle_breakdown[1]?.avg_days / cycle_breakdown[0]?.avg_days).toFixed(1)}x longer than first-pass
            </div>
          )}
        </div>
      </div>

      {/* Tables Row */}
      <div className="qa-tables-row">
        {/* Reduction Targets */}
        <div className="qa-table-card">
          <h3>Cycle Time Reduction Targets</h3>
          <table className="qa-data-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Days</th>
                <th>Reduction</th>
              </tr>
            </thead>
            <tbody>
              <tr className="qa-table-highlight">
                <td>Current Baseline</td>
                <td>{reduction_targets?.baseline}</td>
                <td>-</td>
              </tr>
              <tr>
                <td>10% Reduction</td>
                <td>{reduction_targets?.target_10}</td>
                <td className="qa-cell-green">-{(reduction_targets?.baseline - reduction_targets?.target_10).toFixed(1)} days</td>
              </tr>
              <tr>
                <td>20% Reduction</td>
                <td>{reduction_targets?.target_20}</td>
                <td className="qa-cell-green">-{(reduction_targets?.baseline - reduction_targets?.target_20).toFixed(1)} days</td>
              </tr>
              <tr>
                <td>30% Reduction (Stretch)</td>
                <td>{reduction_targets?.target_30}</td>
                <td className="qa-cell-green">-{(reduction_targets?.baseline - reduction_targets?.target_30).toFixed(1)} days</td>
              </tr>
              <tr>
                <td>50% Reduction (Aspirational)</td>
                <td>{reduction_targets?.target_50}</td>
                <td className="qa-cell-green">-{(reduction_targets?.baseline - reduction_targets?.target_50).toFixed(1)} days</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Platform Breakdown */}
        <div className="qa-table-card">
          <h3>QA Time by Platform</h3>
          <table className="qa-data-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Tickets</th>
                <th>Avg Days</th>
                <th>Total Days</th>
              </tr>
            </thead>
            <tbody>
              {(platform_breakdown || []).slice(0, 8).map((p, i) => (
                <tr key={i}>
                  <td>{p.platform}</td>
                  <td>{p.tickets}</td>
                  <td>{p.avg_days}</td>
                  <td>{p.total_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Priority Breakdown */}
        <div className="qa-table-card">
          <h3>QA Time by Priority</h3>
          <table className="qa-data-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Tickets</th>
                <th>Avg Days</th>
                <th>Total Days</th>
              </tr>
            </thead>
            <tbody>
              {(priority_breakdown || []).slice(0, 8).map((p, i) => (
                <tr key={i}>
                  <td>{p.priority}</td>
                  <td>{p.tickets}</td>
                  <td>{p.avg_days}</td>
                  <td>{p.total_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resource Breakdown Row */}
      <div className="qa-tables-row qa-tables-row-2col">
        {/* QC Tester Breakdown */}
        <div className="qa-table-card">
          <h3>QA Time by QC Tester</h3>
          <table className="qa-data-table">
            <thead>
              <tr>
                <th>QC Tester</th>
                <th>Tickets</th>
                <th>Avg Days</th>
                <th>Total Days</th>
              </tr>
            </thead>
            <tbody>
              {(qc_tester_breakdown || []).slice(0, 10).map((t, i) => (
                <tr key={i}>
                  <td>{t.name}</td>
                  <td>{t.tickets}</td>
                  <td>{t.avg_days}</td>
                  <td>{t.total_days}</td>
                </tr>
              ))}
              {(!qc_tester_breakdown || qc_tester_breakdown.length === 0) && (
                <tr><td colSpan="4" className="qa-no-data">No QC tester data available</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Developer Breakdown */}
        <div className="qa-table-card">
          <h3>QA Time by Developer</h3>
          <table className="qa-data-table">
            <thead>
              <tr>
                <th>Developer</th>
                <th>Tickets</th>
                <th>Avg Days</th>
                <th>Total Days</th>
              </tr>
            </thead>
            <tbody>
              {(developer_breakdown || []).slice(0, 10).map((d, i) => (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td>{d.tickets}</td>
                  <td>{d.avg_days}</td>
                  <td>{d.total_days}</td>
                </tr>
              ))}
              {(!developer_breakdown || developer_breakdown.length === 0) && (
                <tr><td colSpan="4" className="qa-no-data">No developer data available</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  // Render Historical Impact Tab
  const renderImpactTab = () => (
    <>
      <div className="qa-section">
        <h2>QA Cycle Time by Rework Count</h2>
        <p className="qa-section-desc">Analysis of how multiple QA cycles affect overall timeline</p>
        
        <div className="qa-impact-cards">
          {(cycle_breakdown || []).map((c, i) => (
            <div key={i} className={`qa-impact-card qa-impact-${i === 0 ? 'good' : i === 1 ? 'warning' : 'bad'}`}>
              <div className="qa-impact-label">{c.cycles}</div>
              <div className="qa-impact-stats">
                <div className="qa-impact-stat">
                  <span className="qa-impact-value">{c.tickets}</span>
                  <span className="qa-impact-desc">tickets</span>
                </div>
                <div className="qa-impact-stat">
                  <span className="qa-impact-value">{c.avg_days}</span>
                  <span className="qa-impact-desc">avg days</span>
                </div>
                <div className="qa-impact-stat">
                  <span className="qa-impact-value">{c.pct_tickets}%</span>
                  <span className="qa-impact-desc">of tickets</span>
                </div>
                <div className="qa-impact-stat">
                  <span className="qa-impact-value">{c.pct_time}%</span>
                  <span className="qa-impact-desc">of QA time</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="qa-section">
        <h2>Key Insights</h2>
        <div className="qa-insights-list">
          {cycle_breakdown && cycle_breakdown.length >= 2 && (
            <div className="qa-insight-item">
              <span className="qa-insight-icon">📊</span>
              <span>Tickets with 2 cycles take <strong>{(cycle_breakdown[1]?.avg_days / cycle_breakdown[0]?.avg_days).toFixed(1)}x longer</strong> than first-pass tickets</span>
            </div>
          )}
          {cycle_breakdown && cycle_breakdown.length >= 3 && (
            <div className="qa-insight-item">
              <span className="qa-insight-icon">⚠️</span>
              <span><strong>{cycle_breakdown[2]?.pct_tickets}%</strong> of tickets (3+ cycles) consume <strong>{cycle_breakdown[2]?.pct_time}%</strong> of total QA time</span>
            </div>
          )}
          {cycle_breakdown && cycle_breakdown.length >= 2 && (
            <div className="qa-insight-item qa-insight-alert">
              <span className="qa-insight-icon">💡</span>
              <span>Total extra days lost to rework: <strong>
                {Math.round(cycle_breakdown.slice(1).reduce((acc, c) => {
                  return acc + (c.avg_days - cycle_breakdown[0].avg_days) * c.tickets;
                }, 0))} days
              </strong></span>
            </div>
          )}
        </div>
      </div>

      <div className="qa-charts-row">
        <div className="qa-chart-card">
          <h3>Avg QA Days by Cycle Count</h3>
          <div className="qa-chart-container">
            <Bar data={cycleChartData} options={cycleChartOptions} />
          </div>
        </div>
        <div className="qa-chart-card">
          <h3>Time Distribution by Cycles</h3>
          <div className="qa-chart-container">
            <Pie 
              data={{
                labels: (cycle_breakdown || []).map(c => c.cycles),
                datasets: [{
                  data: (cycle_breakdown || []).map(c => c.total_days),
                  backgroundColor: [chartColors.green, chartColors.orange, chartColors.red],
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'right' },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* Monthly Trend in Impact Tab */}
      <div className="qa-section">
        <h2>Monthly QA Cycle Time Trend</h2>
        <div className="qa-chart-card qa-chart-full">
          <div className="qa-chart-container qa-chart-tall">
            <Line data={trendChartData} options={trendChartOptions} />
          </div>
        </div>
        <table className="qa-data-table qa-trend-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Avg Days</th>
              <th>Tickets</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {(monthly_trend || []).map((m, i, arr) => {
              const prevAvg = i > 0 ? arr[i - 1].avg_days : m.avg_days;
              const change = m.avg_days - prevAvg;
              return (
                <tr key={i}>
                  <td>{m.month}</td>
                  <td>{m.avg_days}</td>
                  <td>{m.tickets}</td>
                  <td className={change < 0 ? 'qa-cell-green' : change > 0 ? 'qa-cell-red' : ''}>
                    {change === 0 ? '-' : `${change > 0 ? '+' : ''}${change.toFixed(1)} days`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  // Render Ticket Data Tab
  const renderTicketsTab = () => (
    <>
      <div className="qa-section">
        <div className="qa-tickets-header">
          <h2>Ticket Data</h2>
          <div className="qa-tickets-filters">
            <input
              type="text"
              placeholder="Search ticket ID..."
              className="qa-filter-input"
              value={ticketFilters.search}
              onChange={(e) => setTicketFilters(prev => ({ ...prev, search: e.target.value }))}
            />
            <select 
              className="qa-filter-select"
              value={ticketFilters.minCycles}
              onChange={(e) => {
                setTicketFilters(prev => ({ ...prev, minCycles: e.target.value }));
              }}
            >
              <option value="">All Cycles</option>
              <option value="2">2+ Cycles</option>
              <option value="3">3+ Cycles</option>
            </select>
            <button 
              className="btn btn-primary btn-sm"
              onClick={() => fetchTickets(0)}
              disabled={ticketsLoading}
            >
              {ticketsLoading ? 'Loading...' : 'Apply Filters'}
            </button>
          </div>
        </div>

        {ticketsLoading ? (
          <div className="qa-loading">Loading tickets...</div>
        ) : (
          <>
            <div className="qa-tickets-table-container">
              <table className="qa-tickets-table">
                <thead>
                  <tr>
                    <th>Ticket ID</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Platform</th>
                    <th>QC Tester</th>
                    <th>Backend Dev</th>
                    <th>Frontend Dev</th>
                    <th>QA Start</th>
                    <th>QA End</th>
                    <th>Hold Hrs</th>
                    <th>QA Days</th>
                    <th>Cycles</th>
                    <th>Fails</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets
                    .filter(t => !ticketFilters.search || String(t.ticket_id).includes(ticketFilters.search))
                    .map((t, i) => (
                    <tr key={i} className={t.qa_cycles >= 3 ? 'qa-row-warning' : ''}>
                      <td className="qa-ticket-id">{t.ticket_id}</td>
                      <td>
                        <span className={`qa-status-badge qa-status-${(t.current_status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                          {t.current_status || '-'}
                        </span>
                      </td>
                      <td>{t.priority || '-'}</td>
                      <td>{t.subdepartment || '-'}</td>
                      <td>{t.qc_tester || '-'}</td>
                      <td>{t.backend_dev || '-'}</td>
                      <td>{t.frontend_dev || '-'}</td>
                      <td>{formatDate(t.qa_start)}</td>
                      <td>{formatDate(t.qa_end)}</td>
                      <td>{t.qa_hold_hours || 0}</td>
                      <td className={t.qa_business_days > 5 ? 'qa-cell-red' : t.qa_business_days > 2 ? 'qa-cell-orange' : 'qa-cell-green'}>
                        {t.qa_business_days || '-'}
                      </td>
                      <td className={t.qa_cycles >= 3 ? 'qa-cell-red' : t.qa_cycles === 2 ? 'qa-cell-orange' : ''}>
                        {t.qa_cycles || 0}
                      </td>
                      <td className={t.fail_count > 0 ? 'qa-cell-red' : ''}>{t.fail_count || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="qa-pagination">
              <span>
                Showing {ticketsPagination.offset + 1} - {Math.min(ticketsPagination.offset + tickets.length, ticketsPagination.total)} of {ticketsPagination.total}
              </span>
              <div className="qa-pagination-buttons">
                <button 
                  className="btn btn-sm"
                  disabled={ticketsPagination.offset === 0 || ticketsLoading}
                  onClick={() => fetchTickets(Math.max(0, ticketsPagination.offset - ticketsPagination.limit))}
                >
                  Previous
                </button>
                <button 
                  className="btn btn-sm"
                  disabled={ticketsPagination.offset + ticketsPagination.limit >= ticketsPagination.total || ticketsLoading}
                  onClick={() => fetchTickets(ticketsPagination.offset + ticketsPagination.limit)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );

  // Render Methodology Tab
  const renderMethodologyTab = () => (
    <>
      <div className="qa-methodology">
        <div className="qa-method-section">
          <h2>QA Cycle Time Calculation Methodology</h2>
          <p className="qa-method-intro">
            This dashboard tracks QA performance metrics based on ticket status transitions in the PM Tracker system.
          </p>
        </div>

        <div className="qa-method-section">
          <h3>Metric Definitions</h3>
          <table className="qa-data-table qa-method-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Formula / Definition</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>QA Gross Hours</strong></td>
                <td><code>(QA End - QA Start) × 24</code></td>
              </tr>
              <tr>
                <td><strong>QA Net Hours</strong></td>
                <td><code>MAX(Gross Hours - Hold Hours, 0)</code></td>
              </tr>
              <tr>
                <td><strong>QA Business Days</strong></td>
                <td><code>Net Hours / 8</code></td>
              </tr>
              <tr>
                <td><strong>QA Cycles</strong></td>
                <td>Number of times ticket entered QA status</td>
              </tr>
              <tr>
                <td><strong>First Pass Rate</strong></td>
                <td>% of tickets completing QA in exactly 1 cycle</td>
              </tr>
              <tr>
                <td><strong>Rework Cost</strong></td>
                <td>Extra days spent on tickets with 2+ cycles vs. baseline</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="qa-method-section">
          <h3>Status Definitions</h3>
          <div className="qa-status-definitions">
            <div className="qa-status-def">
              <h4>QA Start Statuses</h4>
              <ul>
                <li>QC Testing</li>
                <li>QC Testing in Progress</li>
              </ul>
            </div>
            <div className="qa-status-def">
              <h4>QA End Statuses</h4>
              <ul>
                <li>BIS Testing</li>
                <li>Closed</li>
                <li>Approved for Live</li>
                <li>Moved to Live</li>
              </ul>
            </div>
            <div className="qa-status-def">
              <h4>QA Hold Statuses</h4>
              <ul>
                <li>QC Testing On-hold</li>
                <li>QC Testing Hold</li>
                <li>Hold/Pending</li>
              </ul>
            </div>
            <div className="qa-status-def">
              <h4>QA Fail Statuses</h4>
              <ul>
                <li>QC Review Fail</li>
                <li>Tested - Awaiting Fixes</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="qa-method-section">
          <h3>Client Goals</h3>
          <div className="qa-goals-list">
            <div className="qa-goal">
              <span className="qa-goal-number">1</span>
              <div className="qa-goal-content">
                <h4>Reduce Cycle Time</h4>
                <p>Target: 20-30% reduction from baseline</p>
              </div>
            </div>
            <div className="qa-goal">
              <span className="qa-goal-number">2</span>
              <div className="qa-goal-content">
                <h4>Reduce Duplicate Testing</h4>
                <p>Track: QA Cycles, Fail Count, Rework Cost</p>
              </div>
            </div>
            <div className="qa-goal">
              <span className="qa-goal-number">3</span>
              <div className="qa-goal-content">
                <h4>Increase Automated Test Cases</h4>
                <p>Tracked via TestRail (separate dashboard)</p>
              </div>
            </div>
            <div className="qa-goal">
              <span className="qa-goal-number">4</span>
              <div className="qa-goal-content">
                <h4>Increase Automation Utilization</h4>
                <p>Tracked via TestRail (separate dashboard)</p>
              </div>
            </div>
          </div>
        </div>

        <div className="qa-method-section">
          <h3>Data Source</h3>
          <p>
            Data is sourced from the PM Tracker Status Change API, which provides a complete history of all 
            ticket status transitions. The dashboard processes approximately <strong>{summary?.total_tickets?.toLocaleString() || 0}</strong> tickets.
          </p>
          <p>
            <em>Last updated: {metrics?.generated_at ? new Date(metrics.generated_at).toLocaleString() : '-'}</em>
          </p>
        </div>
      </div>
    </>
  );

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="page-header">
          <div className="header-title">
            <h1>QA Cycle Time Dashboard</h1>
            <p>Track QA performance, cycle time trends, and reduction progress</p>
          </div>
          <div className="header-actions">
            <button 
              onClick={handleDownloadExcel} 
              className="btn btn-primary"
              disabled={downloading}
            >
              {downloading ? 'Downloading...' : 'Download Excel'}
            </button>
            <button onClick={fetchMetrics} className="btn btn-secondary">
              Refresh
            </button>
          </div>
        </header>

        {/* Date Filter Bar */}
        <div className="qa-date-filter-bar">
          <div className="qa-date-filter-group">
            <label>Time Period:</label>
            <select 
              className="qa-filter-select"
              value={dateFilterType}
              onChange={(e) => setDateFilterType(e.target.value)}
            >
              <option value="all">All Time</option>
              <option value="month">Select Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          
          {dateFilterType === 'month' && (
            <div className="qa-date-filter-group">
              <label>Month:</label>
              <select 
                className="qa-filter-select qa-filter-month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                <option value="">Select month...</option>
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
          
          {dateFilterType === 'custom' && (
            <>
              <div className="qa-date-filter-group">
                <label>From:</label>
                <input 
                  type="date" 
                  className="qa-filter-input qa-filter-date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                />
              </div>
              <div className="qa-date-filter-group">
                <label>To:</label>
                <input 
                  type="date" 
                  className="qa-filter-input qa-filter-date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                />
              </div>
            </>
          )}
          
          {dateFilterType !== 'all' && (
            <button 
              className="btn btn-primary btn-sm"
              onClick={handleApplyDateFilter}
              disabled={
                (dateFilterType === 'month' && !selectedMonth) ||
                (dateFilterType === 'custom' && (!customStartDate || !customEndDate))
              }
            >
              Apply Filter
            </button>
          )}
          
          {dateFilterType !== 'all' && (selectedMonth || (customStartDate && customEndDate)) && (
            <button 
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDateFilterType('all');
                setSelectedMonth('');
                setCustomStartDate('');
                setCustomEndDate('');
                setTimeout(() => fetchMetrics(), 0);
              }}
            >
              Clear Filter
            </button>
          )}
          
          {/* Show current filter */}
          {dateFilterType !== 'all' && metrics && (
            <div className="qa-date-filter-info">
              Showing data for: <strong>
                {dateFilterType === 'month' && selectedMonth 
                  ? monthOptions.find(o => o.value === selectedMonth)?.label 
                  : `${customStartDate} to ${customEndDate}`}
              </strong>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="qa-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`qa-tab ${activeTab === tab.id ? 'qa-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="qa-tab-icon">{tab.icon}</span>
              <span className="qa-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="qa-tab-content">
          {activeTab === 'dashboard' && renderDashboardTab()}
          {activeTab === 'impact' && renderImpactTab()}
          {activeTab === 'tickets' && renderTicketsTab()}
          {activeTab === 'methodology' && renderMethodologyTab()}
        </div>

        {/* Footer */}
        <div className="qa-dashboard-footer">
          <p>
            Generated at: {metrics?.generated_at ? new Date(metrics.generated_at).toLocaleString() : '-'}
            {' | '}
            <button onClick={handleDownloadExcel} className="qa-link-btn" disabled={downloading}>
              {downloading ? 'Downloading...' : 'Download Full Excel Report'}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

export default QACycleDashboard;
