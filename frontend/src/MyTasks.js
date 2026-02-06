import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import { formatDisplayDate, formatDisplayDateWithDay, formatAPIDate } from './dateUtils';
import { getTicketTrackingUrl, TicketExternalLink } from './ticketUtils';
import './dashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  ChartDataLabels
);

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:8000`;

const CHART_COLORS = {
  ongoing: 'rgba(59, 130, 246, 0.85)',
  future: 'rgba(245, 158, 11, 0.85)',
  completed: 'rgba(34, 197, 94, 0.85)',
  work: 'rgba(139, 92, 246, 0.85)',
  priority: {
    URGENT: 'rgba(239, 68, 68, 0.9)',
    'High (Bugs)': 'rgba(249, 115, 22, 0.9)',
    High: 'rgba(245, 158, 11, 0.9)',
    Medium: 'rgba(59, 130, 246, 0.9)',
    Low: 'rgba(34, 197, 94, 0.9)',
    Unspecified: 'rgba(148, 163, 184, 0.9)',
  },
};

function formatPlanningWeek(weekStart) {
  if (!weekStart) return '';
  const d = new Date(weekStart + 'T12:00:00');
  const end = new Date(d);
  end.setDate(end.getDate() + 4);
  const fmt = (x) => `${x.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]} ${x.getFullYear()}`;
  return `${fmt(d)} – ${fmt(end)}`;
}

function formatMonthLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`;
}

function StatCard({ icon, label, value, subtext, accent }) {
  return (
    <div className={`my-tasks-stat-card ${accent ? `accent-${accent}` : ''}`}>
      <div className="my-tasks-stat-icon">{icon}</div>
      <div className="my-tasks-stat-content">
        <span className="my-tasks-stat-value">{value}</span>
        <span className="my-tasks-stat-label">{label}</span>
        {subtext != null && <span className="my-tasks-stat-subtext">{subtext}</span>}
      </div>
    </div>
  );
}

function TaskCard({ task, type }) {
  const label = task.ticket_id ? `#${task.ticket_id}` : (task.generic_category || 'Task');
  const url = getTicketTrackingUrl(task.ticket_id);
  const totalHours = task.total_hours ?? task.total_planned_hours ?? 0;
  return (
    <div className={`my-tasks-card my-tasks-card-${type}`}>
      <div className="my-tasks-card-header">
        <span className="my-tasks-card-id">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">{label}</a>
          ) : (
            label
          )}
          {task.ticket_id && <TicketExternalLink ticketId={task.ticket_id} className="my-tasks-ext-link" />}
        </span>
        <span className="my-tasks-card-hours">{totalHours}h</span>
      </div>
      <p className="my-tasks-card-desc">{task.activity_description || (task.ticket_title || '') || '—'}</p>
      <div className="my-tasks-card-dates">
        {task.start_date && task.end_date && task.start_date !== task.end_date
          ? `${formatDisplayDateWithDay(task.start_date)} → ${formatDisplayDateWithDay(task.end_date)}`
          : task.start_date ? formatDisplayDateWithDay(task.start_date) : '—'}
      </div>
      {task.ticket_priority && <span className="my-tasks-priority">{task.ticket_priority}</span>}
    </div>
  );
}

function WorkEntryCard({ entry }) {
  return (
    <div className="my-tasks-card my-tasks-card-work">
      <div className="my-tasks-card-header">
        <span className="my-tasks-card-id">
          {entry.ticket_id ? (
            getTicketTrackingUrl(entry.ticket_id) ? (
              <a href={getTicketTrackingUrl(entry.ticket_id)} target="_blank" rel="noopener noreferrer">
                #{entry.ticket_id}
              </a>
            ) : (
              `#${entry.ticket_id}`
            )
          ) : (
            entry.leave_type || entry.project_name || 'Work'
          )}
        </span>
        <span className="my-tasks-card-hours">{entry.hours}h</span>
      </div>
      {(entry.task_description || entry.project_name) && (
        <p className="my-tasks-card-desc">{entry.task_description || entry.project_name}</p>
      )}
      <div className="my-tasks-card-dates">{formatDisplayDateWithDay(entry.date)}</div>
    </div>
  );
}

function MyTasks() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('my-tasks');
  const [view, setView] = useState('week');
  const [refDate, setRefDate] = useState(() => formatAPIDate(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasReportees, setHasReportees] = useState(false);
  const [teamData, setTeamData] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState(null);

  useEffect(() => {
    if (!user?.employee_id) return;
    apiFetch(`${API_BASE}/my-tasks/team/check`)
      .then((r) => r.ok ? r.json() : { has_reportees: false })
      .then((j) => setHasReportees(j.has_reportees === true))
      .catch(() => setHasReportees(false));
  }, [user?.employee_id]);

  const loadTeamData = useCallback(async () => {
    if (!user?.employee_id) return;
    setTeamLoading(true);
    setTeamError(null);
    try {
      const params = new URLSearchParams({ view });
      if (view !== 'all') params.set('date', refDate);
      const res = await apiFetch(`${API_BASE}/my-tasks/team?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setTeamData(await res.json());
    } catch (e) {
      setTeamError(e.message || 'Failed to load team data');
      setTeamData(null);
    } finally {
      setTeamLoading(false);
    }
  }, [user?.employee_id, view, refDate]);

  useEffect(() => {
    if (activeTab === 'my-team' && hasReportees) loadTeamData();
  }, [activeTab, hasReportees, loadTeamData]);

  const loadData = useCallback(async () => {
    if (!user?.employee_id) {
      setError('Employee account required');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view });
      if (view !== 'all') params.set('date', refDate);
      const res = await apiFetch(`${API_BASE}/my-tasks?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load tasks');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.employee_id, view, refDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const navPrev = () => {
    const d = new Date(refDate + 'T12:00:00');
    if (view === 'month') {
      d.setMonth(d.getMonth() - 1);
    } else {
      d.setDate(d.getDate() - 7);
    }
    setRefDate(formatAPIDate(d));
  };
  const navNext = () => {
    const d = new Date(refDate + 'T12:00:00');
    if (view === 'month') {
      d.setMonth(d.getMonth() + 1);
    } else {
      d.setDate(d.getDate() + 7);
    }
    setRefDate(formatAPIDate(d));
  };
  const goToday = () => setRefDate(formatAPIDate(new Date()));

  // Derived stats and chart data
  const stats = useMemo(() => {
    if (!data) return null;
    const ongoing = data.ongoing_tasks || [];
    const future = data.future_tasks || [];
    const completed = data.completed_planned || [];
    const work = data.completed_work || [];

    const ongoingHours = ongoing.reduce((s, t) => s + (t.total_hours ?? t.total_planned_hours ?? 0), 0);
    const futureHours = future.reduce((s, t) => s + (t.total_hours ?? t.total_planned_hours ?? 0), 0);
    const completedHours = completed.reduce((s, t) => s + (t.total_hours ?? t.total_planned_hours ?? 0), 0);
    const workHours = work.reduce((s, e) => s + (e.hours || 0), 0);
    const totalPlanned = ongoingHours + futureHours + completedHours;

    return {
      ongoingCount: ongoing.length,
      futureCount: future.length,
      completedCount: completed.length,
      workCount: work.length,
      ongoingHours,
      futureHours,
      completedHours,
      workHours,
      totalPlanned,
      totalWork: workHours,
    };
  }, [data]);

  const taskDistributionChartData = useMemo(() => {
    if (!stats || (stats.ongoingHours + stats.futureHours + stats.completedHours + stats.workHours) === 0) return null;
    const labels = ['Ongoing', 'Future', 'Completed', 'Work Logged'];
    const values = [stats.ongoingHours, stats.futureHours, stats.completedHours, stats.workHours];
    const colors = [CHART_COLORS.ongoing, CHART_COLORS.future, CHART_COLORS.completed, CHART_COLORS.work];
    const filtered = labels.map((l, i) => (values[i] > 0 ? { label: l, value: values[i], color: colors[i] } : null)).filter(Boolean);
    if (filtered.length === 0) return null;
    return {
      labels: filtered.map((x) => `${x.label} (${x.value}h)`),
      datasets: [{
        data: filtered.map((x) => x.value),
        backgroundColor: filtered.map((x) => x.color),
        borderWidth: 0,
      }],
    };
  }, [stats]);

  const hoursByDayChartData = useMemo(() => {
    if (!data?.completed_work?.length) return null;
    if (view === 'week') {
      const byDay = {};
      const start = new Date((data.start_date || refDate) + 'T12:00:00');
      for (let i = 0; i < 5; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const key = formatAPIDate(d);
        byDay[key] = { date: key, hours: 0, label: formatDisplayDate(key) };
      }
      for (const e of data.completed_work) {
        const key = e.date?.slice?.(0, 10) || e.date;
        if (byDay[key]) byDay[key].hours += e.hours || 0;
      }
      const entries = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
      if (entries.every((x) => x.hours === 0)) return null;
      return {
        labels: entries.map((x) => x.label),
        datasets: [{
          label: 'Hours logged',
          data: entries.map((x) => x.hours),
          backgroundColor: CHART_COLORS.work,
          borderRadius: 6,
        }],
      };
    }
    if (view === 'all') {
      const byWeek = {};
      for (const e of data.completed_work) {
        const d = new Date((e.date?.slice?.(0, 10) || e.date) + 'T12:00:00');
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(d);
        mon.setDate(d.getDate() + diff);
        const key = formatAPIDate(mon);
        if (!byWeek[key]) byWeek[key] = { key, hours: 0, label: `Wk ${formatDisplayDate(key)}` };
        byWeek[key].hours += e.hours || 0;
      }
      const entries = Object.values(byWeek).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
      if (entries.length === 0 || entries.every((x) => x.hours === 0)) return null;
      return {
        labels: entries.map((x) => x.label),
        datasets: [{
          label: 'Hours logged',
          data: entries.map((x) => x.hours),
          backgroundColor: CHART_COLORS.work,
          borderRadius: 6,
        }],
      };
    }
    if (view === 'month') {
      const byDay = {};
      for (const e of data.completed_work) {
        const key = e.date?.slice?.(0, 10) || e.date;
        if (!byDay[key]) byDay[key] = { date: key, hours: 0, label: formatDisplayDate(key) };
        byDay[key].hours += e.hours || 0;
      }
      const entries = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
      if (entries.length === 0 || entries.every((x) => x.hours === 0)) return null;
      return {
        labels: entries.map((x) => x.label),
        datasets: [{
          label: 'Hours logged',
          data: entries.map((x) => x.hours),
          backgroundColor: CHART_COLORS.work,
          borderRadius: 6,
        }],
      };
    }
    return null;
  }, [data, view, refDate]);

  const priorityChartData = useMemo(() => {
    if (!data) return null;
    const all = [...(data.ongoing_tasks || []), ...(data.future_tasks || []), ...(data.completed_planned || [])];
    const byPri = {};
    for (const t of all) {
      const p = (t.ticket_priority || '').trim() || 'Unspecified';
      byPri[p] = (byPri[p] || 0) + 1;
    }
    const entries = Object.entries(byPri).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    const priorityOrder = ['URGENT', 'High (Bugs)', 'High', 'Medium', 'Low', 'Unspecified'];
    entries.sort((a, b) => {
      const ia = priorityOrder.indexOf(a[0]);
      const ib = priorityOrder.indexOf(b[0]);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return b[1] - a[1];
    });
    return {
      labels: entries.map(([p]) => p),
      datasets: [{
        data: entries.map(([, c]) => c),
        backgroundColor: entries.map(([p]) => CHART_COLORS.priority[p] || CHART_COLORS.priority.Unspecified),
        borderWidth: 0,
      }],
    };
  }, [data]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', padding: 12 } },
      datalabels: {
        color: '#fff',
        font: { size: 11, weight: '600' },
        formatter: (v, ctx) => (ctx.chart.data.datasets[0]?.data?.length <= 6 ? (typeof v === 'number' && v > 0 ? (v % 1 === 0 ? v : v.toFixed(1)) : '') : ''),
      },
    },
  }), []);

  const doughnutOptions = useMemo(() => ({
    ...chartOptions,
    cutout: '58%',
    plugins: {
      ...chartOptions.plugins,
      datalabels: {
        ...chartOptions.plugins.datalabels,
        formatter: (v) => (v > 0 ? (v % 1 === 0 ? v : v.toFixed(1)) : ''),
      },
    },
  }), [chartOptions]);

  const barOptions = useMemo(() => ({
    ...chartOptions,
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'var(--text-secondary)' } },
      y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'var(--text-secondary)' }, beginAtZero: true },
    },
  }), [chartOptions]);

  if (!user?.employee_id) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content">
          <div className="my-tasks-page">
            <div className="my-tasks-header">
              <Link to="/" className="my-tasks-back">← Dashboard</Link>
              <h1>My Tasks</h1>
            </div>
            <div className="my-tasks-empty">
              <p>My Tasks is available only for employee accounts.</p>
              <Link to="/" className="btn-secondary">Back to Dashboard</Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
        <div className="my-tasks-page">
          <header className="my-tasks-header">
            <div className="my-tasks-header-left">
              <Link to="/" className="my-tasks-back">← Dashboard</Link>
              <div>
                <h1 className="my-tasks-title">My Tasks</h1>
                <p className="my-tasks-subtitle">
                  {activeTab === 'my-tasks' ? 'Your planned tasks and completed work' : 'Team tickets and task status'}
                </p>
              </div>
            </div>
            <div className="my-tasks-header-right">
              <div className="my-tasks-main-tabs">
                <button type="button" className={activeTab === 'my-tasks' ? 'active' : ''} onClick={() => setActiveTab('my-tasks')}>
                  My Tasks
                </button>
                {hasReportees && (
                  <button type="button" className={activeTab === 'my-team' ? 'active' : ''} onClick={() => setActiveTab('my-team')}>
                    My Team
                  </button>
                )}
              </div>
              <div className="my-tasks-controls">
              <div className="my-tasks-view-toggle">
                <button type="button" className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
                <button type="button" className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
                <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All</button>
              </div>
              {view !== 'all' && (
                <div className="my-tasks-date-nav">
                  <button type="button" className="my-tasks-nav-btn" onClick={navPrev} aria-label="Previous">‹</button>
                  <label className="my-tasks-date-display">
                    <input
                      type={view === 'month' ? 'month' : 'date'}
                      value={view === 'month' ? refDate.slice(0, 7) : refDate}
                      onChange={(e) => setRefDate(view === 'month' ? e.target.value + '-01' : e.target.value)}
                      className="my-tasks-date-picker"
                    />
                    <span className="my-tasks-date-label">
                      {view === 'week' ? formatPlanningWeek(refDate) : formatMonthLabel(refDate)}
                    </span>
                  </label>
                  <button type="button" className="my-tasks-nav-btn" onClick={navNext} aria-label="Next">›</button>
                  <button type="button" className="my-tasks-today-btn" onClick={goToday}>Today</button>
                </div>
              )}
              </div>
            </div>
          </header>

      {error && activeTab === 'my-tasks' && <div className="my-tasks-error">{error}</div>}
      {teamError && activeTab === 'my-team' && <div className="my-tasks-error">{teamError}</div>}
      {activeTab === 'my-tasks' && loading ? (
        <div className="my-tasks-loading">Loading your tasks…</div>
      ) : activeTab === 'my-team' && teamLoading ? (
        <div className="my-tasks-loading">Loading team data…</div>
      ) : activeTab === 'my-team' && teamData ? (
        <MyTeamContent teamData={teamData} view={view} refDate={refDate} formatPlanningWeek={formatPlanningWeek} formatMonthLabel={formatMonthLabel} doughnutOptions={doughnutOptions} barOptions={barOptions} />
      ) : activeTab === 'my-tasks' && data ? (
        <>
          {/* Summary Stats */}
          {stats && (
            <div className="my-tasks-stats-row">
              <StatCard icon="●" label="Ongoing" value={stats.ongoingCount} subtext={`${stats.ongoingHours}h`} accent="blue" />
              <StatCard icon="◐" label="Future" value={stats.futureCount} subtext={`${stats.futureHours}h`} accent="amber" />
              <StatCard icon="✓" label="Completed" value={stats.completedCount} subtext={`${stats.completedHours}h`} accent="green" />
              <StatCard icon="📋" label="Work Logged" value={stats.workCount} subtext={`${stats.totalWork}h`} accent="purple" />
              <StatCard icon="Σ" label="Total Planned" value={`${stats.totalPlanned}h`} />
            </div>
          )}

          {/* Charts */}
          {(taskDistributionChartData || hoursByDayChartData || priorityChartData) && (
            <div className="my-tasks-charts-row">
              {taskDistributionChartData && (
                <div className="my-tasks-chart-panel">
                  <h3 className="my-tasks-chart-title">Hours by Category</h3>
                  <div className="my-tasks-chart-wrap">
                    <Doughnut data={taskDistributionChartData} options={doughnutOptions} />
                  </div>
                </div>
              )}
              {hoursByDayChartData && (
                <div className="my-tasks-chart-panel my-tasks-chart-panel-wide">
                  <h3 className="my-tasks-chart-title">
                    {view === 'all' ? 'Hours Logged by Week' : view === 'month' ? 'Hours Logged by Day (last 14)' : 'Hours Logged by Day'}
                  </h3>
                  <div className="my-tasks-chart-wrap">
                    <Bar data={hoursByDayChartData} options={barOptions} />
                  </div>
                </div>
              )}
              {priorityChartData && (
                <div className="my-tasks-chart-panel">
                  <h3 className="my-tasks-chart-title">Tasks by Priority</h3>
                  <div className="my-tasks-chart-wrap">
                    <Doughnut data={priorityChartData} options={doughnutOptions} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Task Sections */}
          <div className="my-tasks-content">
            <section className="my-tasks-section my-tasks-ongoing">
              <h2 className="my-tasks-section-title">
                <span className="my-tasks-section-icon">●</span>
                Ongoing Tasks
                <span className="my-tasks-section-count">{data.ongoing_tasks?.length || 0}</span>
              </h2>
              {(!data.ongoing_tasks || data.ongoing_tasks.length === 0) ? (
                <p className="my-tasks-empty-msg">No ongoing tasks for this period.</p>
              ) : (
                <div className="my-tasks-grid">
                  {data.ongoing_tasks.map((t) => <TaskCard key={`o-${t.id}`} task={t} type="ongoing" />)}
                </div>
              )}
            </section>

            <section className="my-tasks-section my-tasks-future">
              <h2 className="my-tasks-section-title">
                <span className="my-tasks-section-icon">◐</span>
                Future Assigned
                <span className="my-tasks-section-count">{data.future_tasks?.length || 0}</span>
              </h2>
              {(!data.future_tasks || data.future_tasks.length === 0) ? (
                <p className="my-tasks-empty-msg">No tasks assigned for future.</p>
              ) : (
                <div className="my-tasks-grid">
                  {data.future_tasks.map((t) => <TaskCard key={`f-${t.id}`} task={t} type="future" />)}
                </div>
              )}
            </section>

            <section className="my-tasks-section my-tasks-completed">
              <h2 className="my-tasks-section-title">
                <span className="my-tasks-section-icon">✓</span>
                Completed (Planned)
                <span className="my-tasks-section-count">{data.completed_planned?.length || 0}</span>
              </h2>
              {(!data.completed_planned || data.completed_planned.length === 0) ? (
                <p className="my-tasks-empty-msg">No completed planned tasks in this period.</p>
              ) : (
                <div className="my-tasks-grid">
                  {data.completed_planned.map((t) => <TaskCard key={`c-${t.id}`} task={t} type="completed" />)}
                </div>
              )}
            </section>

            <section className="my-tasks-section my-tasks-work">
              <h2 className="my-tasks-section-title">
                <span className="my-tasks-section-icon">📋</span>
                Completed Work (Timesheet)
                <span className="my-tasks-section-count">{data.completed_work?.length || 0}</span>
              </h2>
              {(!data.completed_work || data.completed_work.length === 0) ? (
                <p className="my-tasks-empty-msg">No timesheet entries for this period.</p>
              ) : (
                <div className="my-tasks-grid">
                  {data.completed_work.map((e, i) => <WorkEntryCard key={`w-${e.date}-${i}`} entry={e} />)}
                </div>
              )}
            </section>
          </div>
        </>
      ) : activeTab === 'my-tasks' ? null : (
        <div className="my-tasks-empty">No team data available.</div>
      )}
        </div>
      </main>
    </div>
  );
}

// Priority color mapping
const PRIORITY_COLORS = {
  URGENT: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: '#ef4444' },
  'High (Bugs)': { bg: 'rgba(249, 115, 22, 0.15)', text: '#f97316', border: '#f97316' },
  High: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: '#f59e0b' },
  Medium: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6', border: '#3b82f6' },
  Low: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e', border: '#22c55e' },
};

function PriorityBadge({ priority }) {
  if (!priority) return null;
  const colors = PRIORITY_COLORS[priority] || { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: '#94a3b8' };
  return (
    <span
      className="priority-badge"
      style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
      title={`Priority: ${priority}`}
    >
      {priority}
    </span>
  );
}

function EtaBadge({ eta, etaStatus }) {
  if (!eta) return null;
  const statusClass = etaStatus === 'overdue' ? 'eta-overdue' : etaStatus === 'due_soon' ? 'eta-due-soon' : 'eta-on-track';
  const label = etaStatus === 'overdue' ? 'Overdue' : etaStatus === 'due_soon' ? 'Due Soon' : 'On Track';
  return (
    <span className={`eta-badge ${statusClass}`} title={`ETA: ${eta} (${label})`}>
      ETA: {eta}
    </span>
  );
}

function TimeStatusBadge({ timeStatus, estimateHours, actualHours }) {
  if (!timeStatus || estimateHours == null) return null;
  const exceeded = actualHours != null && estimateHours > 0 ? Math.round(((actualHours - estimateHours) / estimateHours) * 100) : 0;
  const statusClass = timeStatus === 'exceeded' ? 'time-exceeded' : timeStatus === 'at_risk' ? 'time-at-risk' : 'time-on-track';
  const label = timeStatus === 'exceeded' ? `+${exceeded}%` : timeStatus === 'at_risk' ? 'At Risk' : 'On Track';
  return (
    <span className={`time-status-badge ${statusClass}`} title={`Est: ${estimateHours}h, Actual: ${actualHours || 0}h`}>
      {actualHours || 0}h / {estimateHours}h {timeStatus !== 'on_track' && <strong>({label})</strong>}
    </span>
  );
}

function HoldDurationBadge({ daysInStatus, status }) {
  if (daysInStatus == null || !status?.toLowerCase().includes('hold')) return null;
  const isLong = daysInStatus > 3;
  return (
    <span className={`hold-duration-badge ${isLong ? 'hold-long' : ''}`} title={`On hold for ${daysInStatus} days`}>
      🕐 {daysInStatus}d on hold
    </span>
  );
}

function MyTeamContent({ teamData, view, refDate, formatPlanningWeek, formatMonthLabel, doughnutOptions, barOptions }) {
  const [expandedMember, setExpandedMember] = useState(null);
  const period = teamData.period || {};
  const current = teamData.current || {};
  const planned = teamData.planned_this_week || {};
  const members = teamData.member_activity || [];
  const qaPeriod = period.qa || {};
  const devPeriod = period.dev || {};
  const qaCurrent = current.qa || {};
  const devCurrent = current.dev || {};

  // Aggregate alert stats across all members
  const totalOverdue = members.reduce((s, m) => s + (m.overdue_count || 0), 0);
  const totalExceeded = members.reduce((s, m) => s + (m.exceeded_count || 0), 0);
  const totalAtRisk = members.reduce((s, m) => s + (m.at_risk_count || 0), 0);
  const totalOnHold = members.reduce((s, m) => s + (m.on_hold_count || 0), 0);
  const totalUrgentHigh = members.reduce((s, m) => s + (m.urgent_high_count || 0), 0);

  const qaStatusChartData = useMemo(() => {
    const pending = qaCurrent.pending?.length || 0;
    const inProgress = qaCurrent.in_progress?.length || 0;
    const onHold = qaCurrent.on_hold?.length || 0;
    const bis = qaCurrent.bis_testing?.length || 0;
    if (pending + inProgress + onHold + bis === 0) return null;
    return {
      labels: ['Pending', 'In Progress', 'On Hold', 'BIS Testing'],
      datasets: [{
        data: [pending, inProgress, onHold, bis],
        backgroundColor: ['rgba(148,163,184,0.85)', 'rgba(59,130,246,0.85)', 'rgba(245,158,11,0.85)', 'rgba(34,197,94,0.85)'],
        borderWidth: 0,
      }],
    };
  }, [qaCurrent]);

  const memberChartData = useMemo(() => {
    if (members.length === 0) return null;
    const sorted = [...members].sort((a, b) => (b.qa_count + b.dev_count) - (a.qa_count + a.dev_count)).slice(0, 8);
    if (sorted.every((m) => m.qa_count + m.dev_count === 0)) return null;
    return {
      labels: sorted.map((m) => m.name.split(' ')[0] || m.name),
      datasets: [{
        label: 'Active tickets',
        data: sorted.map((m) => m.qa_count + m.dev_count),
        backgroundColor: 'rgba(20, 184, 166, 0.7)',
        borderRadius: 6,
      }],
    };
  }, [members]);

  const totalQa = (qaCurrent.pending?.length || 0) + (qaCurrent.in_progress?.length || 0) + (qaCurrent.on_hold?.length || 0) + (qaCurrent.bis_testing?.length || 0);
  const totalDev = (devCurrent.in_progress?.length || 0) + (devCurrent.ready_for_qc?.length || 0) + (devCurrent.other?.length || 0);

  return (
    <div className="my-tasks-content my-team-content">
      <div className="my-team-top-bar">
        <Link to="/planning" className="my-team-planning-btn">Open Task Planning →</Link>
        <span className="my-team-period-badge">{view === 'all' ? 'All time' : view === 'month' ? formatMonthLabel(refDate) : formatPlanningWeek(refDate)}</span>
      </div>

      {/* Summary widgets */}
      <div className="my-team-widgets">
        <div className="my-team-widget accent-blue">
          <span className="my-team-widget-value">{totalQa}</span>
          <span className="my-team-widget-label">QA Active</span>
        </div>
        <div className="my-team-widget accent-purple">
          <span className="my-team-widget-value">{totalDev}</span>
          <span className="my-team-widget-label">DEV Active</span>
        </div>
        <div className="my-team-widget accent-green">
          <span className="my-team-widget-value">{(qaPeriod.completed || 0) + (devPeriod.completed || 0)}</span>
          <span className="my-team-widget-label">Completed (period)</span>
        </div>
        <div className="my-team-widget accent-amber">
          <span className="my-team-widget-value">{qaPeriod.moved_to_bis || 0}</span>
          <span className="my-team-widget-label">Moved to BIS</span>
        </div>
        <div className="my-team-widget">
          <span className="my-team-widget-value">{members.length}</span>
          <span className="my-team-widget-label">Team Members</span>
        </div>
      </div>

      {/* Alert widgets - show only if there are issues */}
      {(totalOverdue > 0 || totalExceeded > 0 || totalOnHold > 0 || totalUrgentHigh > 0) && (
        <div className="my-team-alerts-row">
          {totalOverdue > 0 && (
            <div className="my-team-alert-widget alert-overdue">
              <span className="my-team-alert-icon">⏰</span>
              <span className="my-team-alert-value">{totalOverdue}</span>
              <span className="my-team-alert-label">Overdue ETA</span>
            </div>
          )}
          {totalExceeded > 0 && (
            <div className="my-team-alert-widget alert-exceeded">
              <span className="my-team-alert-icon">⚠️</span>
              <span className="my-team-alert-value">{totalExceeded}</span>
              <span className="my-team-alert-label">Time Exceeded</span>
            </div>
          )}
          {totalAtRisk > 0 && (
            <div className="my-team-alert-widget alert-at-risk">
              <span className="my-team-alert-icon">📊</span>
              <span className="my-team-alert-value">{totalAtRisk}</span>
              <span className="my-team-alert-label">At Risk</span>
            </div>
          )}
          {totalOnHold > 0 && (
            <div className="my-team-alert-widget alert-on-hold">
              <span className="my-team-alert-icon">⏸️</span>
              <span className="my-team-alert-value">{totalOnHold}</span>
              <span className="my-team-alert-label">On Hold</span>
            </div>
          )}
          {totalUrgentHigh > 0 && (
            <div className="my-team-alert-widget alert-urgent">
              <span className="my-team-alert-icon">🔥</span>
              <span className="my-team-alert-value">{totalUrgentHigh}</span>
              <span className="my-team-alert-label">Urgent/High</span>
            </div>
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="my-team-charts-row">
        {qaStatusChartData && (
          <div className="my-team-chart-card">
            <h3>QA Status Distribution</h3>
            <div className="my-team-chart-inner">
              <Doughnut data={qaStatusChartData} options={doughnutOptions} />
            </div>
          </div>
        )}
        {memberChartData && (
          <div className="my-team-chart-card my-team-chart-wide">
            <h3>Tickets by Team Member</h3>
            <div className="my-team-chart-inner">
              <Bar data={memberChartData} options={{ ...barOptions, indexAxis: 'y' }} />
            </div>
          </div>
        )}
      </div>

      {/* Period metrics */}
      <section className="my-tasks-section">
        <h2 className="my-tasks-section-title">Period Metrics</h2>
        <div className="my-team-metrics-row">
          <div className="my-team-metric-card">
            <h4>QA</h4>
            <div className="my-team-metric-values">
              <span><strong>{qaPeriod.completed || 0}</strong> Done</span>
              <span><strong>{qaPeriod.in_progress || 0}</strong> In Progress</span>
              <span><strong>{qaPeriod.on_hold || 0}</strong> On Hold</span>
              <span><strong>{qaPeriod.moved_to_bis || 0}</strong> BIS</span>
            </div>
          </div>
          <div className="my-team-metric-card">
            <h4>DEV</h4>
            <div className="my-team-metric-values">
              <span><strong>{devPeriod.completed || 0}</strong> Done</span>
              <span><strong>{devPeriod.in_progress || 0}</strong> In Progress</span>
              <span><strong>{devPeriod.ready_for_qc || 0}</strong> Ready QC</span>
            </div>
          </div>
        </div>
      </section>

      {/* Team members – expandable activity */}
      <section className="my-tasks-section">
        <h2 className="my-tasks-section-title">Team Members – View Activity</h2>
        <div className="my-team-members-grid">
          {members.map((m) => {
            const hasAlerts = (m.overdue_count > 0) || (m.exceeded_count > 0) || (m.on_hold_count > 0);
            return (
              <div key={m.employee_id} className={`my-team-member-card ${expandedMember === m.employee_id ? 'expanded' : ''} ${hasAlerts ? 'has-alerts' : ''}`}>
                <button
                  type="button"
                  className="my-team-member-header"
                  onClick={() => setExpandedMember(expandedMember === m.employee_id ? null : m.employee_id)}
                >
                  <div className="my-team-member-info">
                    <Link to={`/employees/${m.employee_id}`} className="my-team-member-name" onClick={(e) => e.stopPropagation()}>
                      {m.name}
                    </Link>
                    <span className="my-team-member-team">{m.team}</span>
                  </div>
                  <div className="my-team-member-badges">
                    <span className="my-team-member-badge qa">{m.qa_count} QA</span>
                    <span className="my-team-member-badge dev">{m.dev_count} DEV</span>
                    <span className="my-team-member-badge planned">{m.planned_hours}h</span>
                    {m.overdue_count > 0 && <span className="my-team-member-badge overdue" title="Overdue tickets">⏰ {m.overdue_count}</span>}
                    {m.exceeded_count > 0 && <span className="my-team-member-badge exceeded" title="Time exceeded">⚠️ {m.exceeded_count}</span>}
                    {m.on_hold_count > 0 && <span className="my-team-member-badge on-hold" title={`On hold (max ${m.max_hold_days}d)`}>⏸️ {m.on_hold_count}</span>}
                    {m.urgent_high_count > 0 && <span className="my-team-member-badge urgent" title="Urgent/High priority">🔥 {m.urgent_high_count}</span>}
                  </div>
                  <span className="my-team-member-chevron">{expandedMember === m.employee_id ? '▼' : '▶'}</span>
                </button>
                {expandedMember === m.employee_id && (
                  <div className="my-team-member-detail">
                    <div className="my-team-member-detail-section">
                      <h5>QA Tickets ({m.qa_tickets?.length || 0})</h5>
                      <div className="my-team-ticket-list">
                        {(m.qa_tickets || []).map((t) => (
                          <div key={t.ticket_id} className="my-team-ticket-item">
                            <div className="my-team-ticket-header">
                              <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" className="my-team-ticket-id">#{t.ticket_id}</a>
                              <PriorityBadge priority={t.priority} />
                              <span className="my-team-ticket-status">{t.status}</span>
                            </div>
                            <div className="my-team-ticket-title">{t.title || '—'}</div>
                            <div className="my-team-ticket-meta">
                              <EtaBadge eta={t.eta} etaStatus={t.eta_status} />
                              <TimeStatusBadge timeStatus={t.time_status} estimateHours={t.estimate_hours} actualHours={t.actual_hours} />
                              <HoldDurationBadge daysInStatus={t.days_in_status} status={t.status} />
                              {t.days_in_status != null && !t.status?.toLowerCase().includes('hold') && (
                                <span className="days-in-status">{t.days_in_status}d in status</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {(!m.qa_tickets || m.qa_tickets.length === 0) && <div className="muted">No active QA tickets</div>}
                      </div>
                    </div>
                    <div className="my-team-member-detail-section">
                      <h5>DEV Tickets ({m.dev_tickets?.length || 0})</h5>
                      <div className="my-team-ticket-list">
                        {(m.dev_tickets || []).map((t) => (
                          <div key={t.ticket_id} className="my-team-ticket-item">
                            <div className="my-team-ticket-header">
                              <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" className="my-team-ticket-id">#{t.ticket_id}</a>
                              <PriorityBadge priority={t.priority} />
                              <span className="my-team-ticket-status">{t.status}</span>
                            </div>
                            <div className="my-team-ticket-title">{t.title || '—'}</div>
                            <div className="my-team-ticket-meta">
                              <EtaBadge eta={t.eta} etaStatus={t.eta_status} />
                              <TimeStatusBadge timeStatus={t.time_status} estimateHours={t.estimate_hours} actualHours={t.actual_hours} />
                              <HoldDurationBadge daysInStatus={t.days_in_status} status={t.status} />
                              {t.days_in_status != null && !t.status?.toLowerCase().includes('hold') && (
                                <span className="days-in-status">{t.days_in_status}d in status</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {(!m.dev_tickets || m.dev_tickets.length === 0) && <div className="muted">No active DEV tickets</div>}
                      </div>
                    </div>
                    <div className="my-team-member-detail-section">
                      <h5>Planned This Week ({m.planned_hours}h)</h5>
                      <div className="my-team-planned-list">
                        {[...(m.planned_qa || []), ...(m.planned_dev || [])].map((p, i) => (
                          <div key={i} className="my-team-planned-item">
                            <div className="my-team-planned-header">
                              {p.ticket_id ? (
                                <a href={getTicketTrackingUrl(p.ticket_id)} target="_blank" rel="noopener noreferrer" className="my-team-ticket-id">#{p.ticket_id}</a>
                              ) : (
                                <span className="my-team-generic-cat">{p.generic_category || 'Task'}</span>
                              )}
                              <PriorityBadge priority={p.priority} />
                              <span className="my-team-planned-hours">{p.total_hours}h</span>
                            </div>
                            <div className="my-team-planned-desc">{p.activity_description || '—'}</div>
                            {p.eta && <EtaBadge eta={p.eta} etaStatus={null} />}
                          </div>
                        ))}
                        {(!m.planned_qa?.length && !m.planned_dev?.length) && <div className="muted">No planned tasks this week</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default MyTasks;
