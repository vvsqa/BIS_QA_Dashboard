import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { formatAPIDate, formatDateRange, formatMonthYear } from './dateUtils';
import './PlanComparison.css';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement);

const API_BASE = 'http://localhost:8000';

// Helper function to format date as YYYY-MM-DD (for API calls)
const formatDate = formatAPIDate;

// Helper function to get week start (Monday)
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

function PlanComparison() {
  const navigate = useNavigate();
  
  // State
  const [team, setTeam] = useState('ALL');
  const [period, setPeriod] = useState('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [comparisonData, setComparisonData] = useState(null);
  const [trendsData, setTrendsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Fetch comparison data
  const fetchComparisonData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const url = `${API_BASE}/planning/comparison?team=${team}&period=${period}&date_str=${formatDate(currentDate)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch comparison data');
      const data = await response.json();
      setComparisonData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [team, period, currentDate]);

  // Fetch trends data
  const fetchTrendsData = useCallback(async () => {
    try {
      const url = `${API_BASE}/planning/comparison/trends?team=${team}&weeks=8`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setTrendsData(data);
      }
    } catch (err) {
      console.error('Failed to fetch trends:', err);
    }
  }, [team]);

  // Navigation handlers
  const goToPrevious = () => {
    const newDate = new Date(currentDate);
    if (period === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const goToNext = () => {
    const newDate = new Date(currentDate);
    if (period === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Effects
  useEffect(() => {
    fetchComparisonData();
    fetchTrendsData();
  }, [fetchComparisonData, fetchTrendsData]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Get variance color class
  const getVarianceClass = (variance) => {
    if (variance > 10) return 'variance-over';
    if (variance < -10) return 'variance-under';
    return 'variance-ok';
  };

  // Get accuracy color class
  const getAccuracyClass = (accuracy) => {
    if (accuracy === null) return '';
    if (accuracy >= 90) return 'accuracy-excellent';
    if (accuracy >= 75) return 'accuracy-good';
    if (accuracy >= 50) return 'accuracy-fair';
    return 'accuracy-poor';
  };

  // Summary Cards
  const renderSummaryCards = () => {
    if (!comparisonData?.summary) return null;

    const { summary } = comparisonData;

    return (
      <div className="summary-cards">
        <div className="summary-card planned">
          <div className="card-icon">📋</div>
          <div className="card-content">
            <span className="card-value">{summary.total_planned_hours}h</span>
            <span className="card-label">Planned Hours</span>
          </div>
        </div>
        <div className="summary-card actual">
          <div className="card-icon">⏱️</div>
          <div className="card-content">
            <span className="card-value">{summary.total_actual_hours}h</span>
            <span className="card-label">Actual Hours</span>
          </div>
        </div>
        <div className={`summary-card variance ${getVarianceClass(summary.variance_percent)}`}>
          <div className="card-icon">{summary.over_estimation ? '📉' : '📈'}</div>
          <div className="card-content">
            <span className="card-value">
              {summary.variance_percent >= 0 ? '+' : ''}{summary.variance_percent}%
            </span>
            <span className="card-label">Variance</span>
          </div>
        </div>
        <div className={`summary-card accuracy ${getAccuracyClass(summary.estimation_accuracy)}`}>
          <div className="card-icon">🎯</div>
          <div className="card-content">
            <span className="card-value">
              {summary.estimation_accuracy !== null ? `${summary.estimation_accuracy}%` : 'N/A'}
            </span>
            <span className="card-label">Accuracy</span>
          </div>
        </div>
      </div>
    );
  };

  // Comparison Chart
  const renderComparisonChart = () => {
    if (!comparisonData?.employees?.length) return null;

    const chartData = {
      labels: comparisonData.employees.map(e => e.employee_name?.split(' ')[0] || 'Unknown'),
      datasets: [
        {
          label: 'Planned Hours',
          data: comparisonData.employees.map(e => e.planned_hours || 0),
          backgroundColor: 'rgba(139, 92, 246, 0.8)',
          borderColor: 'rgb(139, 92, 246)',
          borderWidth: 1
        },
        {
          label: 'Actual Hours',
          data: comparisonData.employees.map(e => e.actual_hours || 0),
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1
        }
      ]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: theme === 'dark' ? '#9ca3af' : '#475569'
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: theme === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(203, 213, 225, 0.5)'
          },
          ticks: {
            color: theme === 'dark' ? '#9ca3af' : '#475569'
          }
        },
        y: {
          grid: {
            color: theme === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(203, 213, 225, 0.5)'
          },
          ticks: {
            color: theme === 'dark' ? '#9ca3af' : '#475569'
          }
        }
      }
    };

    return (
      <div className="chart-panel">
        <h3>Plan vs Actual by Employee</h3>
        <div className="chart-container" style={{ height: '300px' }}>
          <Bar data={chartData} options={options} />
        </div>
      </div>
    );
  };

  // Accuracy Gauge
  const renderAccuracyGauge = () => {
    if (!comparisonData?.summary) return null;

    const accuracy = comparisonData.summary.estimation_accuracy || 0;

    const gaugeData = {
      datasets: [{
        data: [accuracy, 100 - accuracy],
        backgroundColor: [
          accuracy >= 90 ? '#22c55e' : accuracy >= 75 ? '#f59e0b' : '#ef4444',
          theme === 'dark' ? '#1f2937' : '#e2e8f0'
        ],
        borderWidth: 0
      }]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      rotation: -90,
      circumference: 180,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      }
    };

    return (
      <div className="gauge-panel">
        <h3>Estimation Accuracy</h3>
        <div className="gauge-container">
          <div style={{ height: '150px', position: 'relative' }}>
            <Doughnut data={gaugeData} options={options} />
            <div className="gauge-value">
              <span className="value">{accuracy.toFixed(0)}%</span>
              <span className="label">Accuracy</span>
            </div>
          </div>
        </div>
        <div className="gauge-legend">
          <span className={getAccuracyClass(accuracy)}>
            {accuracy >= 90 ? 'Excellent' : accuracy >= 75 ? 'Good' : accuracy >= 50 ? 'Fair' : 'Needs Improvement'}
          </span>
        </div>
      </div>
    );
  };

  // Trends Chart
  const renderTrendsChart = () => {
    if (!trendsData?.trends?.length) return null;

    const chartData = {
      labels: trendsData.trends.map(t => `Week ${t.week_number}`),
      datasets: [
        {
          label: 'Accuracy %',
          data: trendsData.trends.map(t => t.estimation_accuracy || 0),
          borderColor: 'rgb(139, 92, 246)',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          grid: {
            color: theme === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(203, 213, 225, 0.5)'
          },
          ticks: {
            color: theme === 'dark' ? '#9ca3af' : '#475569'
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: theme === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(203, 213, 225, 0.5)'
          },
          ticks: {
            color: theme === 'dark' ? '#9ca3af' : '#475569',
            callback: (value) => value + '%'
          }
        }
      }
    };

    return (
      <div className="chart-panel trends-panel">
        <h3>Accuracy Trend (Last 8 Weeks)</h3>
        <div className="chart-container" style={{ height: '200px' }}>
          <Line data={chartData} options={options} />
        </div>
        {trendsData.summary?.average_accuracy && (
          <div className="trends-summary">
            <span>Average: <strong>{trendsData.summary.average_accuracy}%</strong></span>
          </div>
        )}
      </div>
    );
  };

  // Employee Details Table
  const renderEmployeeTable = () => {
    if (!comparisonData?.employees?.length) return null;

    return (
      <div className="table-panel">
        <h3>Employee Breakdown</h3>
        <div className="table-container">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Team</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Variance</th>
                <th>Accuracy</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.employees.map((emp, idx) => (
                <tr key={idx}>
                  <td>
                    <span 
                      className="employee-name clickable"
                      onClick={() => emp.employee_id && navigate(`/employees/${emp.employee_id}`)}
                    >
                      {emp.employee_name}
                    </span>
                  </td>
                  <td>
                    <span className="team-badge">{emp.team}</span>
                  </td>
                  <td className="hours-cell">{emp.planned_hours.toFixed(1)}h</td>
                  <td className="hours-cell">{emp.actual_hours.toFixed(1)}h</td>
                  <td className={`variance-cell ${getVarianceClass(emp.variance_percent)}`}>
                    {emp.variance >= 0 ? '+' : ''}{emp.variance.toFixed(1)}h
                    <span className="variance-percent">({emp.variance_percent}%)</span>
                  </td>
                  <td className={`accuracy-cell ${getAccuracyClass(emp.estimation_accuracy)}`}>
                    {emp.estimation_accuracy !== null ? `${emp.estimation_accuracy}%` : 'N/A'}
                  </td>
                  <td>
                    <button 
                      className="detail-btn"
                      onClick={() => setSelectedEmployee(emp)}
                      title="View details"
                    >
                      📊 Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Employee Detail Modal
  const renderEmployeeModal = () => {
    if (!selectedEmployee) return null;

    const tickets = Object.entries(selectedEmployee.by_ticket || {});

    return (
      <div className="modal-overlay" onClick={() => setSelectedEmployee(null)}>
        <div className="modal-content employee-detail-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{selectedEmployee.employee_name}</h3>
            <button className="modal-close" onClick={() => setSelectedEmployee(null)}>×</button>
          </div>
          <div className="modal-body">
            <div className="employee-summary">
              <div className="summary-item">
                <span className="label">Planned</span>
                <span className="value">{selectedEmployee.planned_hours.toFixed(1)}h</span>
              </div>
              <div className="summary-item">
                <span className="label">Actual</span>
                <span className="value">{selectedEmployee.actual_hours.toFixed(1)}h</span>
              </div>
              <div className={`summary-item ${getVarianceClass(selectedEmployee.variance_percent)}`}>
                <span className="label">Variance</span>
                <span className="value">{selectedEmployee.variance_percent}%</span>
              </div>
              <div className={`summary-item ${getAccuracyClass(selectedEmployee.estimation_accuracy)}`}>
                <span className="label">Accuracy</span>
                <span className="value">{selectedEmployee.estimation_accuracy}%</span>
              </div>
            </div>

            {tickets.length > 0 && (
              <>
                <h4>Ticket Breakdown</h4>
                <table className="ticket-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Planned</th>
                      <th>Actual</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map(([ticketId, data]) => (
                      <tr key={ticketId}>
                        <td>#{ticketId}</td>
                        <td>{data.planned_hours.toFixed(1)}h</td>
                        <td>{data.actual_hours.toFixed(1)}h</td>
                        <td className={data.variance > 0 ? 'positive' : data.variance < 0 ? 'negative' : ''}>
                          {data.variance >= 0 ? '+' : ''}{data.variance.toFixed(1)}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {selectedEmployee.planned_tasks?.length > 0 && (
              <>
                <h4>Planned Tasks</h4>
                <div className="task-list">
                  {selectedEmployee.planned_tasks.map((task, idx) => (
                    <div key={idx} className="task-item">
                      <span className="task-ticket">#{task.ticket_id}</span>
                      <span className="task-title">{task.task_title}</span>
                      <span className="task-hours">{task.planned_hours}h</span>
                      <span className={`task-status status-${task.status}`}>{task.status}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Period display
  const getPeriodDisplay = () => {
    if (period === 'week') {
      const weekStart = getWeekStart(currentDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return formatDateRange(weekStart, weekEnd);
    } else {
      return formatMonthYear(currentDate);
    }
  };

  return (
    <div className="plan-comparison-module">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <img src="/techversant-logo.png" alt="Techversant" className="company-logo" />
          <div className="logo-text">
            <span className="logo-title">QA Dashboard</span>
            <span className="logo-subtitle">Comparison</span>
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
          <a href="/comparison" className="nav-item active">
            <span className="nav-icon">📊</span>
            <span>Plan vs Actual</span>
          </a>
          <a href="/reports" className="nav-item">
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
      <main className="main-content">
        {/* Header */}
        <header className="page-header">
          <div className="header-title">
            <h1>📊 Plan vs Actual Comparison</h1>
            <p>Compare planned tasks with actual timesheet data</p>
          </div>
        </header>

        {/* Controls */}
        <div className="comparison-controls">
          <div className="control-group">
            {/* Period Toggle */}
            <div className="view-toggle">
              <button 
                className={`toggle-btn ${period === 'week' ? 'active' : ''}`}
                onClick={() => setPeriod('week')}
              >
                Weekly
              </button>
              <button 
                className={`toggle-btn ${period === 'month' ? 'active' : ''}`}
                onClick={() => setPeriod('month')}
              >
                Monthly
              </button>
            </div>

            {/* Team Filter */}
            <select 
              className="team-select"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            >
              <option value="ALL">All Teams</option>
              <option value="QA">QA Team</option>
              <option value="DEV">Dev Team</option>
            </select>
          </div>

          <div className="date-navigation">
            <button className="nav-btn" onClick={goToPrevious}>
              ←
            </button>
            <button className="today-btn" onClick={goToToday}>
              Today
            </button>
            <span className="current-period">
              {getPeriodDisplay()}
            </span>
            <button className="nav-btn" onClick={goToNext}>
              →
            </button>
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading comparison data...</p>
          </div>
        )}
        
        {error && (
          <div className="error-state">
            <p>⚠️ {error}</p>
            <button onClick={fetchComparisonData}>Retry</button>
          </div>
        )}
        
        {!loading && !error && (
          <>
            {renderSummaryCards()}
            
            <div className="charts-grid">
              {renderComparisonChart()}
              {renderAccuracyGauge()}
            </div>
            
            {renderTrendsChart()}
            {renderEmployeeTable()}
          </>
        )}
      </main>

      {/* Employee Detail Modal */}
      {renderEmployeeModal()}
    </div>
  );
}

export default PlanComparison;
