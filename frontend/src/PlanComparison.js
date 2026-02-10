import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { formatAPIDate, formatDisplayDate, formatPlanningWeek } from './dateUtils';
import { useTableSort, SortableHeader } from './useTableSort';
import { TicketExternalLink } from './ticketUtils';
import { API_BASE } from './api';
import './PlanComparison.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartDataLabels
);

function getWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function formatMonth(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthDisplay(monthStr) {
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function PlanComparison({ showParentTitle = false }) {
  const [searchParams] = useSearchParams();
  const employeeFromUrl = searchParams.get('employee') || '';
  const [team, setTeam] = useState('dev');
  const [period, setPeriod] = useState('weekly'); // 'weekly' | 'monthly'
  const [weekStart, setWeekStart] = useState(() => formatAPIDate(getWeekMonday(new Date())));
  const [monthStart, setMonthStart] = useState(() => formatMonth(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedEmployee, setExpandedEmployee] = useState(null);
  const [expandedDays, setExpandedDays] = useState({}); // date string -> boolean
  const [expandedDayEmployees, setExpandedDayEmployees] = useState({}); // "date:employee" -> boolean
  const [employeeSearch, setEmployeeSearch] = useState(employeeFromUrl);
  const [showNoTimesheetOnly, setShowNoTimesheetOnly] = useState(false);

  useEffect(() => {
    if (employeeFromUrl) {
      setEmployeeSearch(employeeFromUrl);
    }
  }, [employeeFromUrl]);
  const [viewMode, setViewMode] = useState('employee-daily'); // 'employee' | 'daily' | 'employee-daily'
  const [employeeDailySortKey, setEmployeeDailySortKey] = useState('employee_name'); // for employee-by-day view

  const fetchComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url;
      if (period === 'monthly') {
        const params = new URLSearchParams({ team, month_str: monthStart });
        url = `${API_BASE}/planning/comparison/monthly?${params}`;
      } else {
        const params = new URLSearchParams({ team, week_start_str: weekStart });
        url = `${API_BASE}/planning/comparison/planning?${params}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || res.statusText || 'Failed to fetch');
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load plan vs actual data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [team, weekStart, monthStart, period]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  const goPrevWeek = () => {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() - 7);
    setWeekStart(formatAPIDate(getWeekMonday(d)));
  };

  const goNextWeek = () => {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    setWeekStart(formatAPIDate(getWeekMonday(d)));
  };

  const goToCurrentWeek = () => {
    setWeekStart(formatAPIDate(getWeekMonday(new Date())));
  };

  const goPrevMonth = () => {
    const [year, month] = monthStart.split('-').map(Number);
    const d = new Date(year, month - 2, 1);
    setMonthStart(formatMonth(d));
  };

  const goNextMonth = () => {
    const [year, month] = monthStart.split('-').map(Number);
    const d = new Date(year, month, 1);
    setMonthStart(formatMonth(d));
  };

  const goToCurrentMonth = () => {
    setMonthStart(formatMonth(new Date()));
  };

  const toggleDayExpand = (date) => {
    setExpandedDays((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const toggleDayEmployeeExpand = (date, employeeName) => {
    const key = `${date}:${employeeName}`;
    setExpandedDayEmployees((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Helper function to determine day deviation status
  const getDayStatus = (day) => {
    const planned = day.total_planned || 0;
    const actual = day.total_actual || 0;
    const variance = day.variance || (actual - planned);
    const variancePercent = planned > 0 ? Math.abs(variance / planned * 100) : 0;
    
    if (planned === 0 && actual === 0) {
      return { status: 'no-data', label: 'No Data', color: 'muted' };
    }
    if (actual === 0 && planned > 0) {
      return { status: 'no-timesheet', label: 'No Timesheet', color: 'warning' };
    }
    // Consider "on track" if variance is within 10%
    if (variancePercent <= 10) {
      return { status: 'on-track', label: 'On Track', color: 'match' };
    }
    if (variance > 0) {
      return { status: 'over', label: `Over (+${variancePercent.toFixed(0)}%)`, color: 'over' };
    }
    return { status: 'under', label: `Under (${variancePercent.toFixed(0)}%)`, color: 'under' };
  };

  const toggleEmployee = (name) => {
    setExpandedEmployee((prev) => (prev === name ? null : name));
  };

  // Sort employee breakdown for Employee by Day view
  const sortEmployeeBreakdown = (list) => {
    if (!list?.length) return list;
    const key = employeeDailySortKey;
    return [...list].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
      }
      const aNum = Number(aVal) ?? 0;
      const bNum = Number(bVal) ?? 0;
      return aNum - bNum;
    });
  };

  const filteredEmployees = useMemo(() => {
    if (!data?.employees) return [];
    let list = data.employees;
    if (employeeSearch.trim()) {
      const q = employeeSearch.trim().toLowerCase();
      list = list.filter(
        (e) =>
          (e.employee_name || '').toLowerCase().includes(q) ||
          (e.role || '').toLowerCase().includes(q) ||
          (e.lead || '').toLowerCase().includes(q)
      );
    }
    if (showNoTimesheetOnly) {
      list = list.filter((e) => e.actual_hours === 0);
    }
    return list;
  }, [data?.employees, employeeSearch, showNoTimesheetOnly]);

  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(filteredEmployees, {
    defaultSortKey: 'employee_name',
    defaultSortDirection: 'asc',
  });

  const dailyChartData = useMemo(() => {
    if (!data?.by_day_summary) return null;
    return {
      labels: data.by_day_summary.map((d, i) => DAY_LABELS[i] || formatDisplayDate(d.date).split('-')[0]),
      datasets: [
        {
          label: 'Planned (h)',
          data: data.by_day_summary.map((d) => d.planned_hours),
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1,
        },
        {
          label: 'Actual (h)',
          data: data.by_day_summary.map((d) => d.actual_hours),
          backgroundColor: 'rgba(20, 184, 166, 0.7)',
          borderColor: 'rgb(20, 184, 166)',
          borderWidth: 1,
        },
      ],
    };
  }, [data?.by_day_summary]);

  const employeeChartData = useMemo(() => {
    if (!sortedEmployees?.length) return null;
    const maxShow = 12;
    const slice = sortedEmployees.slice(0, maxShow);
    return {
      labels: slice.map((e) => (e.employee_name || '').split(' ')[0] || '-'),
      datasets: [
        {
          label: 'Planned (h)',
          data: slice.map((e) => e.planned_hours),
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1,
        },
        {
          label: 'Actual (h)',
          data: slice.map((e) => e.actual_hours),
          backgroundColor: 'rgba(20, 184, 166, 0.7)',
          borderColor: 'rgb(20, 184, 166)',
          borderWidth: 1,
        },
      ],
    };
  }, [sortedEmployees]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      datalabels: {
        display: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: 'var(--text-muted)' },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { font: { size: 11 }, color: 'var(--text-muted)' },
      },
    },
  };

  if (loading && !data) {
    return (
      <div className="plan-comparison-page">
        <div className="plan-comparison-loading">
          <div className="plan-comparison-spinner" />
          <p>Loading plan vs actual data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="plan-comparison-page">
      <header className="plan-comparison-header">
        <div className="plan-comparison-header-top">
          <h2 className="plan-comparison-title">Plan vs Actual Deviation</h2>
          <p className="plan-comparison-subtitle">
            Compare planned tasks (Dev/QA planning) with actual activities (Excel/Google Sheets timesheet).
          </p>
        </div>

        <div className="plan-comparison-controls">
          <div className="plan-comparison-control-group">
            <span className="plan-comparison-control-label">Team</span>
            <div className="plan-comparison-team-toggle">
              <button
                type="button"
                className={`plan-comparison-team-btn ${team === 'dev' ? 'active' : ''}`}
                onClick={() => setTeam('dev')}
              >
                Development
              </button>
              <button
                type="button"
                className={`plan-comparison-team-btn ${team === 'qa' ? 'active' : ''}`}
                onClick={() => setTeam('qa')}
              >
                QA
              </button>
            </div>
          </div>

          <div className="plan-comparison-control-group">
            <span className="plan-comparison-control-label">Period</span>
            <div className="plan-comparison-team-toggle">
              <button
                type="button"
                className={`plan-comparison-team-btn ${period === 'weekly' ? 'active' : ''}`}
                onClick={() => setPeriod('weekly')}
              >
                Weekly
              </button>
              <button
                type="button"
                className={`plan-comparison-team-btn ${period === 'monthly' ? 'active' : ''}`}
                onClick={() => setPeriod('monthly')}
              >
                Monthly
              </button>
            </div>
          </div>

          {period === 'weekly' ? (
            <div className="plan-comparison-control-group">
              <span className="plan-comparison-control-label">Week</span>
              <div className="plan-comparison-week-nav">
                <button type="button" className="plan-comparison-nav-btn" onClick={goPrevWeek} aria-label="Previous week">
                  ‹
                </button>
                <span className="plan-comparison-week-label">{formatPlanningWeek(weekStart)}</span>
                <button type="button" className="plan-comparison-nav-btn" onClick={goNextWeek} aria-label="Next week">
                  ›
                </button>
                <button type="button" className="plan-comparison-today-btn" onClick={goToCurrentWeek}>
                  This Week
                </button>
              </div>
            </div>
          ) : (
            <div className="plan-comparison-control-group">
              <span className="plan-comparison-control-label">Month</span>
              <div className="plan-comparison-week-nav">
                <button type="button" className="plan-comparison-nav-btn" onClick={goPrevMonth} aria-label="Previous month">
                  ‹
                </button>
                <span className="plan-comparison-week-label">{formatMonthDisplay(monthStart)}</span>
                <button type="button" className="plan-comparison-nav-btn" onClick={goNextMonth} aria-label="Next month">
                  ›
                </button>
                <button type="button" className="plan-comparison-today-btn" onClick={goToCurrentMonth}>
                  This Month
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="plan-comparison-refresh"
            onClick={fetchComparison}
            disabled={loading}
            title="Refresh data"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="plan-comparison-error">
          <span className="plan-comparison-error-icon">⚠</span>
          {error}
        </div>
      )}

      {data && !error && (
        <>
          <section className="plan-comparison-summary">
            <h3 className="plan-comparison-section-title">Summary</h3>
            <div className="plan-comparison-summary-cards">
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">📋</span>
                <span className="plan-comparison-card-label">Planned Hours</span>
                <span className="plan-comparison-card-value planned">
                  {data.summary?.total_planned_hours ?? 0}h
                </span>
              </div>
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">✓</span>
                <span className="plan-comparison-card-label">Actual Hours</span>
                <span className="plan-comparison-card-value actual">
                  {data.summary?.total_actual_hours ?? 0}h
                </span>
              </div>
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">Δ</span>
                <span className="plan-comparison-card-label">Variance</span>
                <span
                  className={`plan-comparison-card-value variance ${
                    (data.summary?.total_variance ?? 0) >= 0 ? 'over' : 'under'
                  }`}
                >
                  {(data.summary?.total_variance ?? 0) >= 0 ? '+' : ''}
                  {data.summary?.total_variance ?? 0}h
                  {data.summary?.variance_percent != null && (
                    <span className="plan-comparison-variance-pct">({data.summary.variance_percent}%)</span>
                  )}
                </span>
              </div>
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">%</span>
                <span className="plan-comparison-card-label">Estimation Accuracy</span>
                <span className="plan-comparison-card-value accuracy">
                  {data.summary?.estimation_accuracy != null ? `${data.summary.estimation_accuracy}%` : '—'}
                </span>
              </div>
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">👥</span>
                <span className="plan-comparison-card-label">Active Employees</span>
                <span className="plan-comparison-card-value">{data.summary?.employee_count ?? 0}</span>
              </div>
              <div className="plan-comparison-card">
                <span className="plan-comparison-card-icon">📝</span>
                <span className="plan-comparison-card-label">With Timesheet</span>
                <span className="plan-comparison-card-value">
                  {data.summary?.employees_with_actual ?? 0}
                </span>
              </div>
              <div className="plan-comparison-card plan-comparison-card-warning">
                <span className="plan-comparison-card-icon">⚠</span>
                <span className="plan-comparison-card-label">No Timesheet</span>
                <span className="plan-comparison-card-value">
                  {data.summary?.employees_with_no_timesheet ?? 0}
                </span>
              </div>
            </div>
          </section>

          <section className="plan-comparison-charts">
            <div className="plan-comparison-chart-box">
              <h4 className="plan-comparison-chart-title">Daily Breakdown (Mon–Fri)</h4>
              {dailyChartData && (
                <div className="plan-comparison-chart-inner">
                  <Bar data={dailyChartData} options={chartOptions} />
                </div>
              )}
            </div>
            <div className="plan-comparison-chart-box">
              <h4 className="plan-comparison-chart-title">By Employee (Top 12)</h4>
              {employeeChartData && (
                <div className="plan-comparison-chart-inner">
                  <Bar data={employeeChartData} options={{ ...chartOptions, indexAxis: 'y' }} />
                </div>
              )}
            </div>
          </section>

          <section className="plan-comparison-view-toggle">
            <h3 className="plan-comparison-section-title">Detailed View</h3>
            <div className="plan-comparison-view-btns">
              <button
                type="button"
                className={`plan-comparison-view-btn ${viewMode === 'employee' ? 'active' : ''}`}
                onClick={() => setViewMode('employee')}
              >
                By Employee
              </button>
              <button
                type="button"
                className={`plan-comparison-view-btn ${viewMode === 'daily' ? 'active' : ''}`}
                onClick={() => setViewMode('daily')}
              >
                Daily View
              </button>
              <button
                type="button"
                className={`plan-comparison-view-btn ${viewMode === 'employee-daily' ? 'active' : ''}`}
                onClick={() => setViewMode('employee-daily')}
              >
                Employee by Day
              </button>
            </div>
          </section>

          {viewMode === 'daily' && data?.daily_view && (
            <section className="plan-comparison-daily-view">
              {(data.daily_view || []).map((day, idx) => {
                const dayStatus = getDayStatus(day);
                return (
                <div key={day.date} className={`plan-comparison-day-card plan-comparison-day-${dayStatus.status}`}>
                  <div className="plan-comparison-day-header">
                    <div className="plan-comparison-day-title-row">
                      <span className="plan-comparison-day-title">
                        {day.day_name || DAY_LABELS[idx] || ''} {formatDisplayDate(day.date)}
                      </span>
                      <span className={`plan-comparison-day-status-badge plan-comparison-badge-${dayStatus.color}`}>
                        {dayStatus.label}
                      </span>
                    </div>
                    <div className="plan-comparison-day-totals">
                      <span className="plan-comparison-day-total planned">
                        Planned: <strong>{day.total_planned}h</strong>
                      </span>
                      <span className="plan-comparison-day-total actual">
                        Actual: <strong>{day.total_actual}h</strong>
                      </span>
                      <span className="plan-comparison-day-total available">
                        Available: <strong>{day.total_available}h</strong>
                      </span>
                      <span className={`plan-comparison-day-total variance ${day.variance >= 0 ? 'over' : 'under'}`}>
                        Variance: <strong>{day.variance >= 0 ? '+' : ''}{day.variance}h</strong>
                      </span>
                    </div>
                  </div>
                  <div className="plan-comparison-day-body">
                      <div className="plan-comparison-day-grid">
                        <div className="plan-comparison-day-section">
                          <h4>Planned Tasks</h4>
                          {day.planned_tasks?.length ? (
                            <table className="plan-comparison-day-table">
                              <thead>
                                <tr>
                                  <th>Employee</th>
                                  <th>Ticket / Activity</th>
                                  <th className="num">Hours</th>
                                </tr>
                              </thead>
                              <tbody>
                                {day.planned_tasks.map((t, i) => (
                                  <tr key={i}>
                                    <td>{t.employee_name}</td>
                                    <td>
                                      {t.ticket_id ? (
                                        <>
                                          <Link to={`/tickets?ticket=${t.ticket_id}`} className="plan-comparison-ticket-link" onClick={(e) => e.stopPropagation()}>
                                            #{t.ticket_id}
                                          </Link>
                                          <TicketExternalLink ticketId={t.ticket_id} />
                                          {' '}{t.ticket_title || t.activity_description || '—'}
                                        </>
                                      ) : (
                                        <>{t.generic_category || '—'} · {t.activity_description || '—'}</>
                                      )}
                                    </td>
                                    <td className="num">{t.hours}h</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="plan-comparison-empty">No planned tasks for this day.</p>
                          )}
                        </div>
                        <div className="plan-comparison-day-section">
                          <h4>Actual Timesheet Entries</h4>
                          {day.actual_entries?.length ? (
                            <table className="plan-comparison-day-table">
                              <thead>
                                <tr>
                                  <th>Employee</th>
                                  <th>Ticket / Activity / Project</th>
                                  <th className="num">Hours</th>
                                </tr>
                              </thead>
                              <tbody>
                                {day.actual_entries.map((e, i) => (
                                  <tr key={i}>
                                    <td>{e.employee_name}</td>
                                    <td>
                                      {e.ticket_id != null && (
                                        <>
                                          <Link to={`/tickets?ticket=${e.ticket_id}`} className="plan-comparison-ticket-link" onClick={(ev) => ev.stopPropagation()}>
                                            #{e.ticket_id}
                                          </Link>
                                          <TicketExternalLink ticketId={e.ticket_id} />
                                          {' '}
                                        </>
                                      )}
                                      {e.task_description || '—'}
                                      {e.project_name && ` · ${e.project_name}`}
                                    </td>
                                    <td className="num">{e.hours}h</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="plan-comparison-empty">No timesheet entries for this day.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
              );
              })}
          </section>
          )}

          {viewMode === 'employee-daily' && data?.daily_view && (
            <section className="plan-comparison-employee-daily">
              <div className="plan-comparison-employee-daily-header">
                <h3 className="plan-comparison-section-title">Employee by Day Breakdown</h3>
                <div className="plan-comparison-employee-daily-controls">
                  <p className="plan-comparison-subtitle-small">
                    Expand each day to see individual employee plan vs actual details
                  </p>
                  <label className="plan-comparison-sort-label">
                    Sort by:
                    <select
                      value={employeeDailySortKey}
                      onChange={(e) => setEmployeeDailySortKey(e.target.value)}
                      className="plan-comparison-sort-select"
                    >
                      <option value="employee_name">Name</option>
                      <option value="planned_hours">Planned (h)</option>
                      <option value="actual_hours">Actual (h)</option>
                      <option value="variance">Variance</option>
                    </select>
                  </label>
                </div>
              </div>
              {(data.daily_view || []).map((day) => {
                const dayStatus = getDayStatus(day);
                return (
                <div key={day.date} className={`plan-comparison-day-accordion plan-comparison-day-${dayStatus.status}`}>
                  <div 
                    className={`plan-comparison-day-accordion-header ${expandedDays[day.date] ? 'expanded' : ''}`}
                    onClick={() => toggleDayExpand(day.date)}
                  >
                    <span className="plan-comparison-day-accordion-icon">
                      {expandedDays[day.date] ? '▼' : '▶'}
                    </span>
                    <span className="plan-comparison-day-accordion-title">
                      <strong>{day.day_name || ''}</strong> {formatDisplayDate(day.date)}
                    </span>
                    <span className={`plan-comparison-day-status-badge plan-comparison-badge-${dayStatus.color}`}>
                      {dayStatus.label}
                    </span>
                    <div className="plan-comparison-day-accordion-summary">
                      <span className="plan-comparison-tag planned">Plan: {day.total_planned}h</span>
                      <span className="plan-comparison-tag actual">Actual: {day.total_actual}h</span>
                      <span className={`plan-comparison-tag variance ${day.variance >= 0 ? 'over' : 'under'}`}>
                        {day.variance >= 0 ? '+' : ''}{day.variance}h
                      </span>
                      <span className="plan-comparison-tag employees">
                        {day.employee_breakdown?.length || 0} employees
                      </span>
                    </div>
                  </div>
                  {expandedDays[day.date] && (
                    <div className="plan-comparison-day-accordion-body">
                      {day.employee_breakdown?.length ? (
                        <div className="plan-comparison-employee-day-list">
                          {sortEmployeeBreakdown(day.employee_breakdown).map((emp) => (
                            <div key={emp.employee_name} className="plan-comparison-employee-day-item">
                              <div 
                                className={`plan-comparison-employee-day-row ${expandedDayEmployees[`${day.date}:${emp.employee_name}`] ? 'expanded' : ''}`}
                                onClick={() => toggleDayEmployeeExpand(day.date, emp.employee_name)}
                              >
                                <span className="plan-comparison-emp-expand-icon">
                                  {expandedDayEmployees[`${day.date}:${emp.employee_name}`] ? '▼' : '▶'}
                                </span>
                                <span className="plan-comparison-emp-name-cell">{emp.employee_name}</span>
                                <span className="plan-comparison-emp-hours planned">{emp.planned_hours}h planned</span>
                                <span className="plan-comparison-emp-hours actual">{emp.actual_hours}h actual</span>
                                <span className={`plan-comparison-emp-hours variance ${emp.variance >= 0 ? 'over' : 'under'}`}>
                                  {emp.variance >= 0 ? '+' : ''}{emp.variance}h
                                </span>
                                <span className="plan-comparison-emp-status">
                                  {emp.actual_hours === 0 ? (
                                    <span className="plan-comparison-badge plan-comparison-badge-warning">No timesheet</span>
                                  ) : emp.variance > 0 ? (
                                    <span className="plan-comparison-badge plan-comparison-badge-over">Over</span>
                                  ) : emp.variance < 0 ? (
                                    <span className="plan-comparison-badge plan-comparison-badge-under">Under</span>
                                  ) : (
                                    <span className="plan-comparison-badge plan-comparison-badge-match">On track</span>
                                  )}
                                </span>
                              </div>
                              {expandedDayEmployees[`${day.date}:${emp.employee_name}`] && (
                                <div className="plan-comparison-employee-day-details">
                                  <div className="plan-comparison-detail-grid">
                                    <div className="plan-comparison-detail-section">
                                      <h5>Planned Tasks</h5>
                                      {emp.planned_tasks?.length ? (
                                        <ul className="plan-comparison-task-list">
                                          {emp.planned_tasks.map((t, i) => (
                                            <li key={i}>
                                              <span className="plan-comparison-task-hours">{t.hours}h</span>
                                              {t.ticket_id ? (
                                                <span>
                                                  <Link to={`/tickets?ticket=${t.ticket_id}`} className="plan-comparison-ticket-link" onClick={(ev) => ev.stopPropagation()}>
                                                    #{t.ticket_id}
                                                  </Link>
                                                  <TicketExternalLink ticketId={t.ticket_id} />
                                                  {' '}{t.ticket_title || t.activity_description || '—'}
                                                </span>
                                              ) : (
                                                <span>{t.generic_category || '—'} · {t.activity_description || '—'}</span>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="plan-comparison-empty-small">No planned tasks</p>
                                      )}
                                    </div>
                                    <div className="plan-comparison-detail-section">
                                      <h5>Actual Entries</h5>
                                      {emp.actual_entries?.length ? (
                                        <ul className="plan-comparison-task-list">
                                          {emp.actual_entries.map((e, i) => (
                                            <li key={i}>
                                              <span className="plan-comparison-task-hours">{e.hours}h</span>
                                              <span>
                                                {e.ticket_id != null && (
                                                  <>
                                                    <Link to={`/tickets?ticket=${e.ticket_id}`} className="plan-comparison-ticket-link" onClick={(ev) => ev.stopPropagation()}>
                                                      #{e.ticket_id}
                                                    </Link>
                                                    {' '}
                                                  </>
                                                )}
                                                {e.task_description || '—'}
                                                {e.project_name && ` · ${e.project_name}`}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="plan-comparison-empty-small">No timesheet entries</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="plan-comparison-empty">No employee data for this day.</p>
                      )}
                    </div>
                  )}
                </div>
              );
              })}
            </section>
          )}

          {viewMode === 'employee' && (
          <section className="plan-comparison-employees">
            <div className="plan-comparison-employees-header">
              <h3 className="plan-comparison-section-title">Employee Comparison</h3>
              <div className="plan-comparison-filters">
                <input
                  type="search"
                  placeholder="Search employee, role, lead…"
                  className="plan-comparison-search"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                />
                <label className="plan-comparison-filter-check">
                  <input
                    type="checkbox"
                    checked={showNoTimesheetOnly}
                    onChange={(e) => setShowNoTimesheetOnly(e.target.checked)}
                  />
                  <span>No timesheet only</span>
                </label>
              </div>
            </div>

            <div className="plan-comparison-table-wrap">
              <table className="plan-comparison-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableHeader columnKey="employee_name" onSort={handleSort} sortConfig={sortConfig}>Employee</SortableHeader>
                    <SortableHeader columnKey="planned_task_count" onSort={handleSort} sortConfig={sortConfig} className="num">Tasks</SortableHeader>
                    <SortableHeader columnKey="actual_ticket_count" onSort={handleSort} sortConfig={sortConfig} className="num">Tickets</SortableHeader>
                    <SortableHeader columnKey="planned_hours" onSort={handleSort} sortConfig={sortConfig} className="num">Planned (h)</SortableHeader>
                    <SortableHeader columnKey="actual_hours" onSort={handleSort} sortConfig={sortConfig} className="num">Actual (h)</SortableHeader>
                    <SortableHeader columnKey="variance" onSort={handleSort} sortConfig={sortConfig} className="num">Variance</SortableHeader>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((emp) => (
                    <React.Fragment key={emp.employee_name}>
                      <tr
                        className="plan-comparison-row-main"
                        onClick={() => toggleEmployee(emp.employee_name)}
                      >
                        <td className="plan-comparison-expand">
                          {expandedEmployee === emp.employee_name ? '▼' : '▶'}
                        </td>
                        <td className="plan-comparison-emp-name">{emp.employee_name}</td>
                        <td className="num plan-comparison-count">{emp.planned_task_count || 0}</td>
                        <td className="num plan-comparison-count">{emp.actual_ticket_count || 0}</td>
                        <td className="num">{emp.planned_hours}</td>
                        <td className="num">{emp.actual_hours}</td>
                        <td className={`num variance ${emp.variance >= 0 ? 'over' : 'under'}`}>
                          {emp.variance >= 0 ? '+' : ''}{emp.variance}h
                          {emp.variance_percent != null && ` (${emp.variance_percent}%)`}
                        </td>
                        <td>
                          {emp.actual_hours === 0 ? (
                            <span className="plan-comparison-badge plan-comparison-badge-warning">
                              No timesheet
                            </span>
                          ) : emp.variance > 0 ? (
                            <span className="plan-comparison-badge plan-comparison-badge-over">
                              Over
                            </span>
                          ) : emp.variance < 0 ? (
                            <span className="plan-comparison-badge plan-comparison-badge-under">
                              Under
                            </span>
                          ) : (
                            <span className="plan-comparison-badge plan-comparison-badge-match">
                              On track
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedEmployee === emp.employee_name && (
                        <tr className="plan-comparison-row-detail">
                          <td colSpan={8}>
                            <div className="plan-comparison-detail">
                              <div className="plan-comparison-detail-section">
                                <h4>Planned Tasks</h4>
                                {emp.planned_tasks?.length ? (
                                  <table className="plan-comparison-detail-table">
                                    <thead>
                                      <tr>
                                        <th>Ticket / Activity</th>
                                        <th className="num">Hours</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {emp.planned_tasks.map((t) => (
                                        <tr key={t.task_id}>
                                          <td>
                                            {t.ticket_id ? (
                                              <span>
                                                <Link to={`/tickets?ticket=${t.ticket_id}`} className="plan-comparison-ticket-link" onClick={(ev) => ev.stopPropagation()}>
                                                  #{t.ticket_id}
                                                </Link>
                                                {' '}{t.ticket_title || t.activity_description || ''}
                                              </span>
                                            ) : (
                                              <span>
                                                {t.generic_category || '—'} · {t.activity_description || '—'}
                                              </span>
                                            )}
                                          </td>
                                          <td className="num">{t.planned_hours}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="plan-comparison-empty">No planned tasks for this week.</p>
                                )}
                              </div>
                              <div className="plan-comparison-detail-section">
                                <h4>Actual (Timesheet)</h4>
                                {emp.actual_entries?.length ? (
                                  <table className="plan-comparison-detail-table">
                                    <thead>
                                      <tr>
                                        <th>Date</th>
                                        <th>Ticket / Description</th>
                                        <th className="num">Hours</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {emp.actual_entries.map((e, i) => (
                                        <tr key={i}>
                                          <td>{formatDisplayDate(e.date)}</td>
                                          <td>
                                            {e.ticket_id != null && (
                                              <>
                                                <Link to={`/tickets?ticket=${e.ticket_id}`} className="plan-comparison-ticket-link" onClick={(ev) => ev.stopPropagation()}>
                                                  #{e.ticket_id}
                                                </Link>
                                                {' '}
                                              </>
                                            )}
                                            {e.task_description || '—'}
                                          </td>
                                          <td className="num">{e.hours}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="plan-comparison-empty">
                                    No timesheet entries. Ensure timesheet is synced for this employee.
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredEmployees.length === 0 && (
              <div className="plan-comparison-empty-state">
                {employeeSearch || showNoTimesheetOnly
                  ? 'No employees match the current filters.'
                  : 'No active employees found for this team.'}
              </div>
            )}
          </section>
          )}
        </>
      )}
    </div>
  );
}

export default PlanComparison;
