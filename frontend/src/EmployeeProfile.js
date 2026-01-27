import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
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
import { formatDisplayDate, formatDisplayDateWithDay, formatAPIDate } from './dateUtils';
import './dashboard.css';
import './CalendarModule.css';

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

const API_BASE = 'http://localhost:8000';

// Circular Progress Component
function CircularProgress({ value, maxValue = 100, size = 120, strokeWidth = 10, color, label }) {
  const percentage = Math.min((value / maxValue) * 100, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="circular-progress-container">
      <svg width={size} height={size} className="circular-progress">
        <circle
          className="circular-progress-bg"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className="circular-progress-fill"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            stroke: color,
          }}
        />
      </svg>
      <div className="circular-progress-text">
        <span className="circular-value" style={{ color }}>{value?.toFixed?.(0) || value}</span>
        {label && <span className="circular-label">{label}</span>}
      </div>
    </div>
  );
}

// Mini Metric Card Component
function MetricCard({ icon, value, label, trend, trendValue, color = 'primary', size = 'normal' }) {
  return (
    <div className={`emp-metric-card ${color} ${size}`}>
      <div className="emp-metric-icon">{icon}</div>
      <div className="emp-metric-content">
        <span className="emp-metric-value">{value}</span>
        <span className="emp-metric-label">{label}</span>
      </div>
      {trend && (
        <div className={`emp-metric-trend ${trend}`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
        </div>
      )}
    </div>
  );
}

function EmployeeProfile() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [employee, setEmployee] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [goals, setGoals] = useState({ goals: [], strengths: [], improvements: [] });
  const [reviews, setReviews] = useState([]);
  const [ragHistory, setRagHistory] = useState(null);
  const [kpiRatings, setKpiRatings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('past_quarter');
  const [activeTab, setActiveTab] = useState('performance');
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoal, setNewGoal] = useState({ goal_type: 'goal', title: '', description: '', created_by: 'Manager' });
  const [calendarData, setCalendarData] = useState(null);
  const [calendarPeriod, setCalendarPeriod] = useState('week');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [kpiQuarter, setKpiQuarter] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.floor((now.getMonth()) / 3) + 1;
    return `${year}-Q${quarter}`;
  });
  const [kpiRatingsData, setKpiRatingsData] = useState({});
  const [reportees, setReportees] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    role: '',
    location: '',
    team: '',
    category: '',
    employment_status: '',
    lead: '',
    manager: '',
    previous_experience: null,
    bis_introduced_date: null,
    platform: '',
    photo_url: '',
    is_active: true
  });

  const [theme] = useState(() => {
    try {
      return localStorage.getItem('dashboard-theme') || 'dark';
    } catch (e) {
      return 'dark';
    }
  });

  useEffect(() => {
    loadEmployeeData();
  }, [employeeId, period, kpiQuarter]);

  const loadEmployeeData = async () => {
    setLoading(true);
    try {
      console.log('Loading employee data for:', employeeId);
      
      const [empRes, perfRes, goalsRes, reviewsRes, ragRes, kpiRes, reporteesRes] = await Promise.all([
        fetch(`${API_BASE}/employees/${employeeId}`).catch(err => {
          console.error('Failed to fetch employee:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/performance?period=${period}`).catch(err => {
          console.error('Failed to fetch performance:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/goals`).catch(err => {
          console.error('Failed to fetch goals:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/reviews`).catch(err => {
          console.error('Failed to fetch reviews:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/rag-history`).catch(err => {
          console.error('Failed to fetch rag-history:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/kpi-ratings?quarter=${kpiQuarter}`).catch(err => {
          console.error('Failed to fetch kpi-ratings:', err);
          return { ok: false };
        }),
        fetch(`${API_BASE}/employees/${employeeId}/reportees`).catch(err => {
          console.error('Failed to fetch reportees:', err);
          return { ok: false };
        })
      ]);

      console.log('Employee response:', empRes.status, empRes.ok);
      
      if (empRes.ok) {
        const empData = await empRes.json();
        console.log('Employee data:', empData);
        console.log('Previous experience value:', empData.previous_experience, 'Type:', typeof empData.previous_experience);
        setEmployee(empData);
      } else {
        console.error('Employee fetch failed with status:', empRes.status);
      }
      
      if (perfRes.ok) setPerformance(await perfRes.json());
      if (goalsRes.ok) setGoals(await goalsRes.json());
      if (reviewsRes.ok) setReviews(await reviewsRes.json());
      if (ragRes.ok) setRagHistory(await ragRes.json());
      if (kpiRes.ok) {
        const kpiData = await kpiRes.json();
        setKpiRatings(kpiData);
        // Initialize ratings data
        const ratingsMap = {};
        kpiData.kpis?.forEach(kpi => {
          ratingsMap[kpi.kpi_id] = {
            self_rating: kpi.self_rating || '',
            lead_rating: kpi.lead_rating || '',
            manager_rating: kpi.manager_rating || kpi.rating || '',
            self_comments: kpi.self_comments || '',
            lead_comments: kpi.lead_comments || '',
            manager_comments: kpi.manager_comments || ''
          };
        });
        setKpiRatingsData(ratingsMap);
      }
      if (reporteesRes.ok) {
        const reporteesData = await reporteesRes.json();
        setReportees(reporteesData);
      }
    } catch (error) {
      console.error('Error loading employee data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper functions for calendar
  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const getWeekDays = (weekStart) => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];

  // Calculate week boundaries
  const weekStart = useMemo(() => getWeekStart(calendarDate), [calendarDate]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Calculate month boundaries
  const monthStart = useMemo(() => {
    return new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
  }, [calendarDate]);

  const monthEnd = useMemo(() => {
    return new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
  }, [calendarDate]);

  // Fetch calendar data for employee
  const fetchCalendarData = async () => {
    if (!employeeId) return;
    try {
      const dateStr = formatAPIDate(calendarDate);
      const url = `${API_BASE}/calendar/employee/${employeeId}?period=${calendarPeriod}&date_str=${dateStr}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setCalendarData(data);
      }
    } catch (error) {
      console.error('Error fetching calendar data:', error);
    }
  };

  // Fetch calendar when tab is active or period/date changes
  useEffect(() => {
    if (activeTab === 'calendar' && employeeId) {
      fetchCalendarData();
    }
  }, [activeTab, calendarPeriod, calendarDate, employeeId]);

  // Get hours color class
  const getHoursColorClass = (hours) => {
    if (hours >= 8) return 'hours-full';
    if (hours >= 4) return 'hours-half';
    if (hours > 0) return 'hours-low';
    return 'hours-zero';
  };

  // Get leave badge color
  const getLeaveBadgeClass = (leaveType) => {
    if (!leaveType) return '';
    const type = leaveType.toLowerCase();
    if (type.includes('wfh') || type.includes('work from home')) return 'leave-wfh';
    if (type.includes('holiday')) return 'leave-holiday';
    if (type.includes('sick')) return 'leave-sick';
    return 'leave-regular';
  };

  // Render weekly view for employee
  const renderEmployeeWeeklyView = () => {
    if (!calendarData?.days) return null;

    return (
      <div className="calendar-weekly">
        <table className="calendar-table">
          <thead>
            <tr>
              <th className="employee-col">Date</th>
              {weekDays.map((day, idx) => {
                const dayKey = formatAPIDate(day);
                const dayData = calendarData.days?.[dayKey] || {};
                const isWeekend = dayData.is_weekend !== undefined ? dayData.is_weekend : (day.getDay() === 0 || day.getDay() === 6);
                const isHoliday = dayData.is_holiday || false;
                const holiday = isHoliday ? { name: dayData.holiday_name, category: dayData.holiday_category } : null;
                
                return (
                  <th key={idx} className={`day-header ${isWeekend ? 'weekend' : ''} ${isHoliday ? 'holiday' : ''}`}>
                    <div className="day-name">{DAY_NAMES[idx]}</div>
                    <div className="day-date">{day.getDate()}</div>
                    <div className="day-month">{MONTH_NAMES[day.getMonth()].slice(0, 3)}</div>
                    {holiday && (
                      <div className="holiday-indicator" title={holiday.name}>
                        {holiday.category === 'Optional Holiday' ? '⚪' : '🔴'}
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="total-col">Weekly Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="employee-row">
              <td className="employee-cell">
                <div className="employee-info">
                  <span className="employee-name">{calendarData.employee_name}</span>
                  <span className="employee-team">{calendarData.team}</span>
                </div>
              </td>
              {weekDays.map((day, dayIdx) => {
                const dayKey = formatAPIDate(day);
                const dayData = calendarData.days?.[dayKey] || { actual_entries: [], total_actual_hours: 0, leave_type: null };
                const isWeekend = dayData.is_weekend !== undefined ? dayData.is_weekend : (day.getDay() === 0 || day.getDay() === 6);
                const isHoliday = dayData.is_holiday || false;
                const holidayName = dayData.holiday_name;
                const holidayCategory = dayData.holiday_category;
                
                // Check if date is in the past
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                const isPastDate = dayDate < today;
                
                // Check if no entries and no leave for past dates (only for working days)
                const isWorkingDay = dayData.is_working_day !== undefined ? dayData.is_working_day : (!isWeekend && !isHoliday);
                const hasNoEntry = !dayData.leave_type && 
                                  (!dayData.actual_entries || dayData.actual_entries.length === 0) && 
                                  (!dayData.total_actual_hours || dayData.total_actual_hours === 0);
                const showNoEntryIndicator = isPastDate && hasNoEntry && isWorkingDay;
                
                return (
                  <td 
                    key={dayIdx} 
                    className={`day-cell ${isWeekend ? 'weekend' : ''} ${isHoliday ? 'holiday' : ''} ${dayData.leave_type ? 'has-leave' : ''} ${showNoEntryIndicator ? 'no-entry-past' : ''}`}
                    title={isHoliday ? holidayName : (isWeekend ? 'Weekend' : '')}
                  >
                    {isHoliday && (
                      <span className="holiday-badge" title={holidayName}>
                        {holidayCategory === 'Optional Holiday' ? '⚪' : '🔴'} {holidayName}
                      </span>
                    )}
                    {dayData.leave_type && (
                      <span className={`leave-badge ${getLeaveBadgeClass(dayData.leave_type)}`}>
                        {dayData.leave_type}
                      </span>
                    )}
                    {showNoEntryIndicator && (
                      <div className="no-entry-indicator" title="No time entry for this past date">
                        <span className="no-entry-icon">!</span>
                      </div>
                    )}
                    {dayData.actual_entries && dayData.actual_entries.length > 0 && (
                      <div className="day-entries">
                        {dayData.actual_entries.slice(0, 3).map((entry, idx) => {
                          const isTicket = entry.ticket_id && 
                            entry.ticket_id !== 'LEAVE' && 
                            entry.ticket_id !== 'UNASSIGNED' &&
                            /^\d+$/.test(entry.ticket_id);
                          
                          return (
                            <div 
                              key={idx} 
                              className={`entry-ticket ${isTicket ? 'clickable-ticket' : ''}`}
                              title={entry.task_description || entry.ticket_id}
                              onClick={(e) => {
                                if (isTicket) {
                                  e.stopPropagation();
                                  navigate(`/tickets?ticket=${entry.ticket_id}`);
                                }
                              }}
                            >
                              <span className={`ticket-id ${isTicket ? 'ticket-link' : ''}`}>
                                {isTicket 
                                  ? `#${entry.ticket_id}`
                                  : (entry.task_description 
                                      ? (entry.task_description.length > 12 
                                          ? entry.task_description.slice(0, 12) + '...' 
                                          : entry.task_description)
                                      : entry.ticket_id || 'Task')}
                              </span>
                              <span className="ticket-hours">{parseFloat(entry.hours || 0).toFixed(1)}h</span>
                            </div>
                          );
                        })}
                        {dayData.actual_entries.length > 3 && (
                          <div className="more-entries">+{dayData.actual_entries.length - 3} more</div>
                        )}
                      </div>
                    )}
                    <div className={`day-total ${getHoursColorClass(dayData.total_actual_hours)}`}>
                      <strong>{dayData.total_actual_hours > 0 ? `${parseFloat(dayData.total_actual_hours).toFixed(1)}h` : '-'}</strong>
                    </div>
                  </td>
                );
              })}
              <td className={`total-cell ${getHoursColorClass(calendarData.summary?.total_actual_hours / 5)}`}>
                <strong>{parseFloat(calendarData.summary?.total_actual_hours || 0).toFixed(1)}h</strong>
                <div className="weekly-avg">
                  Avg: {((calendarData.summary?.total_actual_hours || 0) / (calendarData.summary?.working_days || 5)).toFixed(1)}h/day
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // Render monthly view for employee
  const renderEmployeeMonthlyView = () => {
    if (!calendarData?.days) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysInMonth = monthEnd.getDate();
    const firstDayOfMonth = monthStart.getDay();
    const firstDayMonday = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Convert Sunday=0 to Monday=0
    const shortDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Get all days to display (including empty cells for alignment)
    const calendarDays = [];
    
    // Add empty cells for days before month starts
    for (let i = 0; i < firstDayMonday; i++) {
      calendarDays.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day);
      calendarDays.push(date);
    }

    // Calculate average productive hours
    const pastDays = Object.entries(calendarData.days || {}).filter(([dayKey, dayData]) => {
      const dayDate = new Date(dayKey);
      dayDate.setHours(0, 0, 0, 0);
      return dayDate <= today && dayData.is_working_day && !dayData.leave_type;
    });
    const avgProductive = pastDays.length > 0
      ? pastDays.reduce((sum, [_, dayData]) => {
          const productive = dayData.total_productive_hours || dayData.total_actual_hours || 0;
          return sum + productive;
        }, 0) / pastDays.length
      : 0;

    return (
      <div className="calendar-monthly-employee">
        <div className="monthly-calendar-container">
          <div className="monthly-calendar-scroll">
            <div className="monthly-calendar-grid">
              {/* Header Row */}
              <div className="monthly-row header-row">
                <div className="employee-col header-cell">Employee</div>
                <div className="stats-col header-cell">Avg</div>
                <div className="stats-col header-cell">Days</div>
                <div className="stats-col header-cell">Leave</div>
                {calendarDays.map((day, idx) => {
                  if (!day) return <div key={idx} className="day-col header-cell empty"></div>;
                  const dayOfWeek = (day.getDay() + 6) % 7; // Monday = 0
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  return (
                    <div key={idx} className={`day-col header-cell ${isWeekend ? 'weekend' : ''}`}>
                      <span className="day-name-short">{shortDayNames[dayOfWeek]}</span>
                      <span className="day-number">{day.getDate()}</span>
                    </div>
                  );
                })}
              </div>

              {/* Employee Data Row */}
              <div className="monthly-row data-row">
                <div className="employee-col">
                  <span className="employee-name">{calendarData.employee_name}</span>
                  <span className="employee-team">{calendarData.team}</span>
                </div>
                <div className="stats-col">
                  <span className="stat-value">{avgProductive.toFixed(1)}h</span>
                </div>
                <div className="stats-col">
                  <span className="stat-value">{calendarData.summary?.working_days || 0}</span>
                </div>
                <div className="stats-col">
                  <span className="stat-value">{calendarData.summary?.leave_days || 0}</span>
                </div>
                {calendarDays.map((day, dayIdx) => {
                  if (!day) return <div key={dayIdx} className="day-col heatmap-cell empty"></div>;
                  
                  const dayKey = formatAPIDate(day);
                  const dayData = calendarData.days?.[dayKey];
                  const dayDate = new Date(day);
                  dayDate.setHours(0, 0, 0, 0);
                  const isPastDate = dayDate <= today;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  
                  // Future dates
                  if (!isPastDate) {
                    return (
                      <div 
                        key={dayIdx} 
                        className={`day-col heatmap-cell future ${isWeekend ? 'weekend' : ''}`}
                        title={`${formatDisplayDate(day)} - Future date`}
                      >
                        <span className="future-icon">-</span>
                      </div>
                    );
                  }
                  
                  // Get display hours (productive if available, otherwise actual)
                  const productiveHours = dayData?.total_productive_hours || 0;
                  const hoursLogged = dayData?.total_actual_hours || 0;
                  const displayHours = productiveHours > 0 ? productiveHours : hoursLogged;
                  
                  // Leave detection
                  const leaveType = dayData?.leave_type || '';
                  const hasLeave = !!leaveType;
                  const isFullDayLeave = hasLeave && !leaveType.toLowerCase().includes('half');
                  const isHalfDayLeave = hasLeave && leaveType.toLowerCase().includes('half');
                  
                  // Low hours detection
                  const isLowHoursNoLeave = !hasLeave && !isWeekend && displayHours > 0 && displayHours < 7;
                  
                  // Check if no entries
                  const hasNoEntries = !dayData || (displayHours === 0 && !hasLeave);
                  
                  // Holiday info
                  const isHoliday = dayData?.is_holiday || false;
                  
                  // No entries for past date
                  if (hasNoEntries && !isWeekend && !isHoliday) {
                    return (
                      <div 
                        key={dayIdx} 
                        className="day-col heatmap-cell no-entries"
                        title={`${formatDisplayDate(day)} - No entries recorded`}
                      >
                        <span className="no-entries-icon">!</span>
                      </div>
                    );
                  }
                  
                  // Full day leave
                  if (isFullDayLeave) {
                    return (
                      <div 
                        key={dayIdx} 
                        className="day-col heatmap-cell full-leave"
                        title={`${formatDisplayDate(day)} - ${leaveType} (Full Day)`}
                      >
                        <span className="leave-icon-full">L</span>
                      </div>
                    );
                  }
                  
                  // Half day leave
                  if (isHalfDayLeave) {
                    return (
                      <div 
                        key={dayIdx} 
                        className={`day-col heatmap-cell half-leave ${getHoursColorClass(displayHours)}`}
                        title={`${formatDisplayDate(day)} - ${leaveType} + ${displayHours.toFixed(1)}h worked`}
                      >
                        <span className="heatmap-hours">{displayHours > 0 ? displayHours.toFixed(1) : ''}</span>
                        <span className="leave-icon-half">½</span>
                      </div>
                    );
                  }
                  
                  // Low hours without leave
                  if (isLowHoursNoLeave) {
                    return (
                      <div 
                        key={dayIdx} 
                        className={`day-col heatmap-cell low-hours-no-leave ${getHoursColorClass(displayHours)}`}
                        title={`${formatDisplayDate(day)}: ${displayHours.toFixed(1)}h - Below 7 hours, no leave applied`}
                      >
                        <span className="heatmap-hours">{displayHours.toFixed(1)}</span>
                        <span className="warning-indicator">⚠</span>
                      </div>
                    );
                  }
                  
                  // Holiday
                  if (isHoliday) {
                    return (
                      <div 
                        key={dayIdx} 
                        className={`day-col heatmap-cell holiday ${isWeekend ? 'weekend' : ''}`}
                        title={`${formatDisplayDate(day)} - ${dayData.holiday_name}`}
                      >
                        <span className="holiday-indicator">{dayData.holiday_category === 'Optional Holiday' ? '⚪' : '🔴'}</span>
                      </div>
                    );
                  }
                
                  return (
                    <div 
                      key={dayIdx} 
                      className={`day-col heatmap-cell ${getHoursColorClass(displayHours)} ${isWeekend ? 'weekend' : ''}`}
                      title={`${formatDisplayDate(day)}: ${displayHours.toFixed(1)}h ${productiveHours > 0 ? '(Productive)' : '(Time Spent)'}`}
                    >
                      {displayHours > 0 && <span className="heatmap-hours">{displayHours.toFixed(1)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Populate edit form when employee data loads
  useEffect(() => {
    if (employee) {
      setEditForm({
        name: employee.name || '',
        email: employee.email || '',
        role: employee.role || '',
        location: employee.location || '',
        team: employee.team || '',
        category: employee.category || '',
        employment_status: employee.employment_status || 'Ongoing Employee',
        lead: employee.lead || '',
        manager: employee.manager || '',
        previous_experience: employee.previous_experience !== null && employee.previous_experience !== undefined ? employee.previous_experience : null,
        bis_introduced_date: employee.bis_introduced_date || null,
        platform: employee.platform || '',
        photo_url: employee.photo_url || '',
        is_active: employee.is_active !== undefined ? employee.is_active : true
      });
    }
  }, [employee]);

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/employees/${employeeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      
      if (res.ok) {
        setShowEditModal(false);
        loadEmployeeData(); // Reload employee data
        alert('Employee profile updated successfully');
      } else {
        const error = await res.json();
        alert(error.detail || 'Failed to update employee');
      }
    } catch (error) {
      alert('Error updating employee: ' + error.message);
    }
  };

  const handleExportProfile = async () => {
    try {
      const response = await fetch(`${API_BASE}/employees/${employeeId}/export`);
      if (!response.ok) {
        throw new Error('Failed to export profile');
      }
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `Employee_Profile_${employeeId}_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert('Error exporting profile: ' + error.message);
    }
  };

  const handleAddGoal = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/employees/${employeeId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGoal)
      });
      if (res.ok) {
        setShowGoalModal(false);
        setNewGoal({ goal_type: 'goal', title: '', description: '', created_by: 'Manager' });
        loadEmployeeData();
      }
    } catch (error) {
      alert('Error adding goal: ' + error.message);
    }
  };

  const handleSubmitKPIRatings = async (e) => {
    e.preventDefault();
    if (!kpiRatings || !kpiRatings.kpis || !employee) return;
    
    // Determine who is submitting (self, lead, or manager)
    const ratingType = e.target.dataset.ratingType || e.target.closest('form')?.dataset.ratingType || 'manager';
    
    try {
      const isLeadManagerSame = employee.lead && employee.manager && 
        employee.lead.trim().toUpperCase() === employee.manager.trim().toUpperCase();
      
      const ratings = kpiRatings.kpis.map(kpi => {
        const ratingData = kpiRatingsData[kpi.kpi_id] || {};
        const ratingPayload = {
          kpi_id: kpi.kpi_id,
          quarter: kpiQuarter,
          rated_by: ratingType,
          reviewed_by: ratingType === 'self' ? employee.name : 
                      ratingType === 'lead' ? employee.lead : 
                      employee.manager || employee.lead || 'Manager'
        };
        
        if (ratingType === 'self') {
          ratingPayload.self_rating = ratingData.self_rating || null;
          ratingPayload.self_comments = ratingData.self_comments || null;
        } else if (ratingType === 'lead') {
          ratingPayload.lead_rating = ratingData.lead_rating || null;
          ratingPayload.lead_comments = ratingData.lead_comments || null;
          // If lead and manager are same, also set manager fields
          if (isLeadManagerSame) {
            ratingPayload.manager_rating = ratingData.lead_rating || null;
            ratingPayload.manager_comments = ratingData.lead_comments || null;
          }
        } else if (ratingType === 'manager') {
          ratingPayload.manager_rating = ratingData.manager_rating || null;
          ratingPayload.manager_comments = ratingData.manager_comments || null;
          // If lead and manager are same, also set lead fields
          if (isLeadManagerSame) {
            ratingPayload.lead_rating = ratingData.manager_rating || null;
            ratingPayload.lead_comments = ratingData.manager_comments || null;
          }
        }
        
        return ratingPayload;
      });

      const res = await fetch(`${API_BASE}/employees/${employeeId}/kpi-ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ratings)
      });

      if (res.ok) {
        alert(`KPI ratings saved successfully as ${ratingType}!`);
        loadEmployeeData();
      } else {
        const error = await res.json();
        alert('Error saving ratings: ' + (error.detail || 'Unknown error'));
      }
    } catch (error) {
      alert('Error submitting KPI ratings: ' + error.message);
    }
  };

  const getRatingColor = (score) => {
    if (score === null || score === undefined) return 'neutral';
    if (score >= 4.5) return 'excellent';
    if (score >= 4.0) return 'good';
    if (score >= 3.0) return 'fair';
    if (score >= 2.0) return 'poor';
    return 'critical';
  };

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm('Delete this item?')) return;
    try {
      await fetch(`${API_BASE}/goals/${goalId}`, { method: 'DELETE' });
      loadEmployeeData();
    } catch (error) {
      alert('Error deleting goal: ' + error.message);
    }
  };

  const getRAGColor = (status) => {
    if (status === 'GREEN') return '#10b981';
    if (status === 'AMBER') return '#f59e0b';
    return '#ef4444';
  };

  const getRAGBgColor = (status) => {
    if (status === 'GREEN') return 'rgba(16, 185, 129, 0.15)';
    if (status === 'AMBER') return 'rgba(245, 158, 11, 0.15)';
    return 'rgba(239, 68, 68, 0.15)';
  };

  // Get initials for avatar
  const getInitials = (name) => {
    if (!name) return '??';
    const parts = name.split(' ');
    return parts.length > 1 
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : name.substring(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-screen">
          <div className="loading-spinner-large"></div>
          <p>Loading employee profile...</p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="dashboard">
        <div className="error-screen">
          <h2>Employee not found</h2>
          <button onClick={() => navigate('/employees')} className="btn-primary">
            Back to Employees
          </button>
        </div>
      </div>
    );
  }

  const isDev = employee.team === 'DEVELOPMENT';
  const metrics = performance?.metrics || {};
  const ragStatus = performance?.rag_status || {};
  const bugs = metrics.bugs || {};
  const tickets = metrics.tickets || {};
  const tests = metrics.tests || {};
  const timesheet = metrics.timesheet || {};

  // RAG trend chart data
  const ragTrendData = ragHistory?.rag_trend ? {
    labels: ragHistory.rag_trend.map(r => r.label),
    datasets: [{
      label: 'RAG Score',
      data: ragHistory.rag_trend.map(r => r.score),
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: ragHistory.rag_trend.map(r => getRAGColor(r.status)),
      pointBorderColor: ragHistory.rag_trend.map(r => getRAGColor(r.status)),
      pointRadius: 6,
      pointHoverRadius: 8,
    }]
  } : null;

  // Bug types chart data
  const bugTypesData = bugs.bug_types ? {
    labels: Object.keys(bugs.bug_types),
    datasets: [{
      data: Object.values(bugs.bug_types),
      backgroundColor: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'],
      borderWidth: 0,
    }]
  } : null;

  // Severity breakdown data
  const severityData = bugs.severity ? {
    labels: ['Critical', 'Major', 'Minor', 'Low'],
    datasets: [{
      label: 'Bugs',
      data: [
        bugs.severity?.critical || 0,
        bugs.severity?.major || 0,
        bugs.severity?.minor || 0,
        bugs.severity?.low || 0
      ],
      backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'],
      borderWidth: 0,
      borderRadius: 6,
    }]
  } : null;

  // Calculate variance status
  const hasEstimate = tickets.estimate_hours && tickets.estimate_hours > 0;
  const variancePercent = hasEstimate 
    ? ((tickets.actual_hours - tickets.estimate_hours) / tickets.estimate_hours * 100) 
    : null;
  const varianceStatus = variancePercent === null 
    ? 'not-estimated'
    : Math.abs(variancePercent) < 10 
      ? 'green' 
      : Math.abs(variancePercent) < 30 
        ? 'amber' 
        : 'red';

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">QA</div>
          <span className="logo-text">Bug Tracker</span>
        </div>
        <nav className="nav-menu">
          <Link to="/" className="nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Ticket Dashboard
          </Link>
          <Link to="/all-bugs" className="nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4l2 2"/>
            </svg>
            All Bugs Dashboard
          </Link>
          <Link to="/tickets" className="nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            Tickets Overview
          </Link>
          <Link to="/employees" className={`nav-item ${location.pathname.startsWith('/employees') ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
            Employees
          </Link>
          <Link to="/calendar" className={`nav-item ${location.pathname === '/calendar' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            Calendar
          </Link>
          <Link to="/planning" className={`nav-item ${location.pathname === '/planning' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
            </svg>
            Task Planning
          </Link>
          <Link to="/comparison" className={`nav-item ${location.pathname === '/comparison' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18"/>
              <path d="M18 9l-5 5-4-4-3 3"/>
            </svg>
            Plan vs Actual
          </Link>
          <Link to="/reports" className={`nav-item ${location.pathname === '/reports' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Reports
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content emp-profile-main">
        {/* Header Section */}
        <div className="emp-profile-header">
          <div className="emp-header-left">
            <button className="btn-back" onClick={() => navigate('/')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
              </svg>
              Dashboard
            </button>
            <button className="btn-back" onClick={() => navigate('/employees')} style={{ marginLeft: '8px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Employees
            </button>
          </div>
        </div>

        {/* Employee Profile Top Section */}
        <div className="emp-profile-top-section">
          <div className="emp-profile-top-left">
            {/* Photo Upload Section */}
            <div className="emp-photo-section">
              {employee.photo_url ? (
                <img 
                  src={employee.photo_url} 
                  alt={employee.name}
                  className="emp-photo"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    const avatar = e.target.parentElement.querySelector('.emp-avatar-large');
                    if (avatar) avatar.style.display = 'flex';
                  }}
                />
              ) : null}
              <div 
                className="emp-avatar-large" 
                style={{ 
                  backgroundColor: isDev ? '#3b82f6' : '#10b981',
                  display: employee.photo_url ? 'none' : 'flex'
                }}
              >
                {getInitials(employee.name)}
              </div>
              <button 
                className="btn-upload-photo"
                onClick={() => document.getElementById('photo-upload-input')?.click()}
                title="Upload Photo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </button>
              <input
                type="file"
                id="photo-upload-input"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  // TODO: Implement photo upload
                  const file = e.target.files[0];
                  if (file) {
                    // For now, just show a message
                    alert('Photo upload functionality will be implemented. Please update photo_url in edit form.');
                  }
                }}
              />
            </div>

            {/* Basic Info */}
            <div className="emp-basic-info">
              <h1 className="emp-name">{employee.name}</h1>
              <div className="emp-meta-row">
                <span className={`team-badge ${isDev ? 'dev' : 'qa'}`}>
                  {isDev ? 'DEV' : 'QA'} TEAM
                </span>
                <span className={`employment-status-badge ${employee.employment_status === 'Resigned' ? 'resigned' : 'ongoing'}`}>
                  {employee.employment_status || 'Ongoing Employee'}
                </span>
                {employee.platform && (
                  <span className="platform-badge" style={{
                    backgroundColor: employee.platform === 'Web' ? '#3b82f6' : '#8b5cf6',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}>
                    {employee.platform}
                  </span>
                )}
              </div>
              <div className="emp-role-location">
                <span className="emp-role">{employee.role || 'N/A'}</span>
                {employee.location && (
                  <>
                    <span className="separator">•</span>
                    <span className="emp-location">{employee.location}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Experience Details Card - Top Section */}
        <div className="emp-experience-card-top">
          <h3 className="section-title">Experience Details</h3>
          <div className="experience-grid">
            <div className="experience-item">
              <span className="experience-label">Previous Experience</span>
              <span className="experience-value">
                {(employee.previous_experience !== null && employee.previous_experience !== undefined)
                  ? `${parseFloat(employee.previous_experience || 0).toFixed(1)} years` 
                  : 'N/A'}
              </span>
            </div>
            <div className="experience-item">
              <span className="experience-label">Experience with Techversant</span>
              <span className="experience-value highlight">
                {employee.techversant_experience !== null && employee.techversant_experience !== undefined
                  ? `${parseFloat(employee.techversant_experience).toFixed(1)} years` 
                  : '0.0 years'}
              </span>
            </div>
            <div className="experience-item">
              <span className="experience-label">Total Experience</span>
              <span className="experience-value highlight-bold">
                {employee.total_experience !== null && employee.total_experience !== undefined
                  ? `${parseFloat(employee.total_experience).toFixed(1)} years` 
                  : '0.0 years'}
              </span>
            </div>
            <div className="experience-item">
              <span className="experience-label">BIS Status</span>
              <span className="experience-value" style={{
                color: employee.category === 'BILLED' ? '#10b981' : '#6b7280',
                fontWeight: '600'
              }}>
                {employee.bis_status || (employee.category === 'BILLED' ? 'Billed' : 'Un-Billed')}
              </span>
            </div>
            {employee.category === 'BILLED' && employee.bis_introduced_date && (
              <>
                <div className="experience-item">
                  <span className="experience-label">BIS Introduced Date</span>
                  <span className="experience-value">
                    {formatDisplayDate(employee.bis_introduced_date)}
                  </span>
                </div>
                {employee.bis_experience !== null && employee.bis_experience !== undefined && (
                  <div className="experience-item">
                    <span className="experience-label">BIS Experience</span>
                    <span className="experience-value highlight" style={{ color: '#10b981' }}>
                      {parseFloat(employee.bis_experience).toFixed(1)} years
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Action Buttons Section */}
        <div className="emp-header-right">
          <div className="period-selector">
            <label>Time Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="past_week">Past Week</option>
              <option value="past_month">Past Month</option>
              <option value="past_quarter">Past Quarter</option>
              <option value="one_year">One Year</option>
              <option value="overall">Overall</option>
            </select>
          </div>
          <button className="btn-action" onClick={handleExportProfile}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Excel
          </button>
          <button className="btn-action" onClick={() => setShowEditModal(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit Profile
          </button>
          <button className="btn-action" onClick={() => navigate(`/employees/${employeeId}/review/new`)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            New Review
          </button>
        </div>

        {/* Key Metrics Row - Different for DEV vs QA */}
        <div className="emp-key-metrics">
          {isDev ? (
            // DEV Team Key Metrics
            <>
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>}
                value={tickets.count || 0}
                label="Tickets Worked"
                color="indigo"
              />
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
                value={bugs.total || 0}
                label="Bugs Assigned"
                color="purple"
              />
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>}
                value={`${bugs.closure_rate || 0}%`}
                label="Bug Closure Rate"
                trend={bugs.closure_rate >= 70 ? 'up' : 'down'}
                color="emerald"
              />
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
                value={`${timesheet.total_hours || 0}h`}
                label="Hours Logged"
                trend={timesheet.utilization_percent >= 80 ? 'up' : 'down'}
                trendValue={`${timesheet.utilization_percent || 0}%`}
                color="cyan"
              />
            </>
          ) : (
            // QA Team Key Metrics - Focused on Testing & Bug Finding
            <>
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>}
                value={tickets.count || 0}
                label="Tickets Tested"
                color="indigo"
              />
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
                value={bugs.total || 0}
                label="Bugs Found"
                trend={bugs.total > 0 ? 'up' : 'neutral'}
                trendValue={bugs.severity?.critical > 0 ? `${bugs.severity.critical} Critical` : ''}
                color="purple"
              />
              <MetricCard
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>}
                value={`${(100 - (bugs.rejected_percent || 0)).toFixed(1)}%`}
                label="Valid Bug Rate"
                trend={(100 - (bugs.rejected_percent || 0)) >= 85 ? 'up' : 'down'}
                color="cyan"
              />
            </>
          )}
        </div>

        {/* RAG Status & Performance Section */}
        <div className="emp-rag-section">
          {/* RAG Score Card */}
          <div className="emp-rag-card" style={{ borderColor: getRAGColor(ragStatus.status), backgroundColor: getRAGBgColor(ragStatus.status) }}>
            <div className="emp-rag-main">
              <CircularProgress
                value={ragStatus.score || 0}
                maxValue={100}
                size={140}
                strokeWidth={12}
                color={getRAGColor(ragStatus.status)}
                label="%"
              />
              <div className="emp-rag-info">
                <h3 className="emp-rag-title" style={{ color: getRAGColor(ragStatus.status) }}>
                  {ragStatus.status || 'N/A'} STATUS
                </h3>
                <p className="emp-rag-desc">
                  {ragStatus.status === 'GREEN' ? 'Excellent performance' :
                   ragStatus.status === 'AMBER' ? 'Needs improvement' : 'Requires attention'}
                </p>
                {ragHistory?.rag_trend?.[1] && (
                  <div className="emp-rag-comparison">
                    {ragStatus.score > ragHistory.rag_trend[1].score ? (
                      <span className="trend-positive">+{(ragStatus.score - ragHistory.rag_trend[1].score).toFixed(0)} from last period</span>
                    ) : ragStatus.score < ragHistory.rag_trend[1].score ? (
                      <span className="trend-negative">{(ragStatus.score - ragHistory.rag_trend[1].score).toFixed(0)} from last period</span>
                    ) : (
                      <span className="trend-neutral">No change from last period</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RAG Trend Chart */}
          <div className="emp-rag-trend">
            <h4>RAG Score Trend</h4>
            {ragTrendData ? (
              <div className="rag-trend-chart">
                <Line
                  data={ragTrendData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#e5e7eb',
                        bodyColor: '#e5e7eb',
                        padding: 12,
                        cornerRadius: 8,
                      }
                    },
                    scales: {
                      y: {
                        min: 0,
                        max: 100,
                        ticks: { color: '#9ca3af' },
                        grid: { color: 'rgba(75, 85, 99, 0.3)' }
                      },
                      x: {
                        ticks: { color: '#9ca3af' },
                        grid: { display: false }
                      }
                    }
                  }}
                />
              </div>
            ) : (
              <div className="chart-empty">No trend data available</div>
            )}
          </div>
        </div>

        {/* Performance Metrics Grid - Completely different for DEV vs QA */}
        <div className="emp-perf-grid">
          {isDev ? (
            // DEV Team Metrics - Focus on bug resolution quality
            <>
              <div className="emp-perf-card">
                <h4>Critical Bugs %</h4>
                <CircularProgress
                  value={bugs.severity?.critical_percent || 0}
                  size={100}
                  strokeWidth={8}
                  color={bugs.severity?.critical_percent > 20 ? '#ef4444' : bugs.severity?.critical_percent > 10 ? '#f59e0b' : '#22c55e'}
                  label="%"
                />
                <div className="perf-hint negative">Lower is better</div>
              </div>
              <div className="emp-perf-card">
                <h4>Reopened Bugs %</h4>
                <CircularProgress
                  value={bugs.reopened_percent || 0}
                  size={100}
                  strokeWidth={8}
                  color={bugs.reopened_percent > 15 ? '#ef4444' : bugs.reopened_percent > 5 ? '#f59e0b' : '#22c55e'}
                  label="%"
                />
                <div className="perf-hint negative">Lower is better</div>
              </div>
              <div className="emp-perf-card">
                <h4>Closure Rate</h4>
                <CircularProgress
                  value={bugs.closure_rate || 0}
                  size={100}
                  strokeWidth={8}
                  color={bugs.closure_rate >= 70 ? '#22c55e' : bugs.closure_rate >= 50 ? '#f59e0b' : '#ef4444'}
                  label="%"
                />
                <div className="perf-hint positive">Higher is better</div>
              </div>
              <div className="emp-perf-card">
                <h4>Avg Resolution</h4>
                <div className="perf-stat-value">{bugs.avg_resolution_days || 0}</div>
                <div className="perf-stat-label">days</div>
                <div className="perf-hint negative">Lower is better</div>
              </div>
            </>
          ) : (
            // QA Team Metrics - Focus on testing effectiveness & bug detection
            <>
              <div className="emp-perf-card qa-metric qa-pass-rate">
                <h4>Test Pass Rate</h4>
                <CircularProgress
                  value={tests.pass_rate || 0}
                  size={120}
                  strokeWidth={10}
                  color="#3b82f6"
                  label="%"
                />
                <div className="perf-subtext">{tests.passed || 0} / {tests.total_executed || 0} passed</div>
              </div>
              <div className="emp-perf-card qa-metric qa-detection-rate">
                <h4>Bug Detection Rate</h4>
                <div className="detection-rate-display">
                  <div className="detection-number orange">{Math.floor(metrics.bugs_per_ticket || 0)}</div>
                  {metrics.bugs_per_ticket && metrics.bugs_per_ticket % 1 !== 0 && (
                    <div className="detection-number purple">.{((metrics.bugs_per_ticket % 1) * 10).toFixed(0)}</div>
                  )}
                </div>
                <div className="perf-stat-label">bugs/ticket</div>
                <div className="perf-hint positive">Higher is better</div>
              </div>
              <div className="emp-perf-card qa-metric qa-valid-rate">
                <h4>Valid Bug Rate</h4>
                <CircularProgress
                  value={100 - (bugs.rejected_percent || 0)}
                  size={120}
                  strokeWidth={10}
                  color="#22c55e"
                  label="%"
                />
                <div className="perf-subtext">{bugs.rejected || 0} rejected of {bugs.total || 0}</div>
                <div className="perf-hint positive">Higher is better</div>
              </div>
              <div className="emp-perf-card qa-metric qa-critical-bugs">
                <h4>Critical Bugs Found</h4>
                <div className="perf-stat-value critical-highlight">{bugs.severity?.critical || 0}</div>
                <div className="perf-stat-label">critical bugs</div>
                <div className="perf-subtext">{bugs.severity?.critical_percent || 0}% of total</div>
                <div className="perf-hint positive">Finding critical bugs early is valuable</div>
              </div>
              <div className="emp-perf-card qa-metric qa-blocked-rate">
                <h4>Test Blocked Rate</h4>
                <CircularProgress
                  value={tests.blocked_percent || 0}
                  size={120}
                  strokeWidth={10}
                  color="#22c55e"
                  label="%"
                />
                <div className="perf-subtext">{tests.blocked || 0} tests blocked</div>
              </div>
              <div className="emp-perf-card qa-metric qa-bug-age">
                <h4>Avg Bug Age</h4>
                <div className="perf-stat-value">{bugs.avg_ageing_days?.toFixed(1) || 0}</div>
                <div className="perf-stat-label">days open</div>
                <div className="perf-hint subtle">Time bugs remain open</div>
              </div>
            </>
          )}
        </div>

        {/* Estimate vs Actual Section */}
        <div className="emp-estimate-section">
          <h3 className="section-title-sm">Estimate vs Actual</h3>
          <div className="emp-estimate-grid">
            <div className="estimate-card">
              <div className="estimate-label">Estimated Hours</div>
              <div className="estimate-value">
                {hasEstimate ? `${tickets.estimate_hours}h` : (
                  <span className="not-estimated-badge">NOT ESTIMATED</span>
                )}
              </div>
            </div>
            <div className="estimate-card">
              <div className="estimate-label">Actual Hours</div>
              <div className="estimate-value">{tickets.actual_hours || 0}h</div>
            </div>
            <div className={`estimate-card variance ${varianceStatus}`}>
              <div className="estimate-label">Variance</div>
              <div className="estimate-value">
                {variancePercent !== null ? (
                  <>
                    {variancePercent > 0 ? '+' : ''}{variancePercent.toFixed(1)}%
                  </>
                ) : (
                  <span className="na-text">N/A</span>
                )}
              </div>
              {varianceStatus === 'not-estimated' && (
                <div className="variance-warning">No estimate provided</div>
              )}
            </div>
            <div className="estimate-card">
              <div className="estimate-label">Accuracy</div>
              <div className="estimate-value">
                {tickets.estimate_accuracy ? `${tickets.estimate_accuracy}%` : 'N/A'}
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section - Different for DEV vs QA */}
        <div className="emp-charts-section">
          {isDev ? (
            // DEV Charts
            <>
              {/* Bug Types Chart */}
              <div className="emp-chart-card">
                <h4>Bug Types Distribution</h4>
                {bugTypesData && Object.keys(bugs.bug_types || {}).length > 0 ? (
                  <div className="chart-container pie-chart">
                    <Doughnut
                      data={bugTypesData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '60%',
                        plugins: {
                          legend: {
                            position: 'right',
                            labels: { color: '#9ca3af', padding: 15 }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="chart-empty">No bug type data</div>
                )}
              </div>

              {/* Severity Breakdown */}
              <div className="emp-chart-card">
                <h4>Severity Breakdown</h4>
                {severityData ? (
                  <div className="chart-container bar-chart">
                    <Bar
                      data={severityData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false }
                        },
                        scales: {
                          y: {
                            beginAtZero: true,
                            ticks: { color: '#9ca3af' },
                            grid: { color: 'rgba(75, 85, 99, 0.3)' }
                          },
                          x: {
                            ticks: { color: '#9ca3af' },
                            grid: { display: false }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="chart-empty">No severity data</div>
                )}
              </div>

              {/* Modules Expertise */}
              <div className="emp-chart-card">
                <h4>Modules Worked On</h4>
                <div className="modules-tags">
                  {(bugs.modules_expertise || []).map((module, idx) => (
                    <span key={idx} className="module-tag">{module}</span>
                  ))}
                  {(bugs.modules_expertise || []).length === 0 && (
                    <div className="chart-empty">No module data</div>
                  )}
                </div>
              </div>

              {/* Recent Tickets */}
              <div className="emp-chart-card">
                <h4>Recent Tickets</h4>
                <div className="tickets-list">
                  {(tickets.ticket_ids || []).slice(0, 10).map((id, idx) => (
                    <div 
                      key={idx} 
                      className="ticket-item" 
                      onClick={() => navigate(`/?ticket=${id}`)}
                    >
                      #{id}
                    </div>
                  ))}
                  {(tickets.ticket_ids || []).length === 0 && (
                    <div className="chart-empty">No tickets in this period</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            // QA Charts - Focus on Testing & Bug Finding Quality
            <>
              {/* Bug Severity Found - QA finding critical bugs is GOOD */}
              <div className="emp-chart-card qa-chart">
                <h4>Bugs Found by Severity</h4>
                <p className="chart-subtitle">Finding critical bugs early saves cost</p>
                {severityData ? (
                  <div className="chart-container bar-chart">
                    <Bar
                      data={{
                        labels: ['Critical', 'Major', 'Minor', 'Low'],
                        datasets: [{
                          label: 'Bugs Found',
                          data: [
                            bugs.severity?.critical || 0,
                            bugs.severity?.major || 0,
                            bugs.severity?.minor || 0,
                            bugs.severity?.low || 0
                          ],
                          backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'],
                          borderWidth: 0,
                          borderRadius: 6,
                        }]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        plugins: {
                          legend: { display: false }
                        },
                        scales: {
                          x: {
                            beginAtZero: true,
                            ticks: { color: '#9ca3af' },
                            grid: { color: 'rgba(75, 85, 99, 0.3)' }
                          },
                          y: {
                            ticks: { color: '#9ca3af' },
                            grid: { display: false }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="chart-empty">No severity data</div>
                )}
              </div>

              {/* Environment Distribution - Where bugs were found */}
              <div className="emp-chart-card qa-chart">
                <h4>Bugs Found by Environment</h4>
                <p className="chart-subtitle">Early detection (Staging) is preferred</p>
                {bugs.environment ? (
                  <div className="chart-container pie-chart">
                    <Doughnut
                      data={{
                        labels: ['Staging', 'Pre-Production', 'Live'],
                        datasets: [{
                          data: [
                            bugs.environment?.staging || 0,
                            bugs.environment?.pre || 0,
                            bugs.environment?.live || 0
                          ],
                          backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
                          borderWidth: 0,
                        }]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '60%',
                        plugins: {
                          legend: {
                            position: 'bottom',
                            labels: { color: '#9ca3af', padding: 15 }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="chart-empty">No environment data</div>
                )}
                <div className="env-summary">
                  <span className="env-stat good">{bugs.environment?.staging_percent || 0}% in Staging</span>
                  <span className="env-stat warning">{bugs.environment?.live_percent || 0}% in Live</span>
                </div>
              </div>

              {/* Modules Tested */}
              <div className="emp-chart-card qa-chart">
                <h4>Modules Tested</h4>
                <p className="chart-subtitle">Areas where bugs were reported</p>
                <div className="modules-tags">
                  {(bugs.modules_expertise || []).map((module, idx) => (
                    <span key={idx} className="module-tag qa">{module}</span>
                  ))}
                  {(bugs.modules_expertise || []).length === 0 && (
                    <div className="chart-empty">No module data</div>
                  )}
                </div>
              </div>

              {/* Recent Tickets Tested */}
              <div className="emp-chart-card qa-chart full-width">
                <h4>Recently Tested Tickets</h4>
                <div className="tickets-list horizontal">
                  {(tickets.ticket_ids || []).slice(0, 15).map((id, idx) => (
                    <div 
                      key={idx} 
                      className="ticket-item" 
                      onClick={() => navigate(`/?ticket=${id}`)}
                    >
                      #{id}
                    </div>
                  ))}
                  {(tickets.ticket_ids || []).length === 0 && (
                    <div className="chart-empty">No tickets tested in this period</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Tabs Section */}
        <div className="emp-tabs">
          <button 
            className={`emp-tab ${activeTab === 'performance' ? 'active' : ''}`}
            onClick={() => setActiveTab('performance')}
          >
            Performance Details
          </button>
          <button 
            className={`emp-tab ${activeTab === 'goals' ? 'active' : ''}`}
            onClick={() => setActiveTab('goals')}
          >
            Goals & Development
          </button>
          <button 
            className={`emp-tab ${activeTab === 'reviews' ? 'active' : ''}`}
            onClick={() => setActiveTab('reviews')}
          >
            Reviews History
          </button>
          <button 
            className={`emp-tab ${activeTab === 'kpi' ? 'active' : ''}`}
            onClick={() => setActiveTab('kpi')}
          >
            KPI Ratings
          </button>
          <button 
            className={`emp-tab ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setActiveTab('calendar')}
          >
            Calendar & Timesheet
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'performance' && (
          <div className="emp-tab-content">
            <div className="emp-detail-grid">
              <div className="emp-detail-card">
                <h4>Employee Details</h4>
                <div className="detail-row">
                  <span className="detail-label">Employee ID</span>
                  <span className="detail-value">{employee.employee_id}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Email</span>
                  <span className="detail-value">{employee.email}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Location</span>
                  <span className="detail-value">{employee.location || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Category</span>
                  <span className={`category-badge ${employee.category?.toLowerCase().replace('-', '')}`}>
                    {employee.category}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Employment Status</span>
                  <span className={`employment-status-badge ${employee.employment_status === 'Resigned' ? 'resigned' : 'ongoing'}`}>
                    {employee.employment_status || 'Ongoing Employee'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Reporting To (Lead)</span>
                  <span className="detail-value">{employee.lead || 'N/A'}</span>
                </div>
                {employee.manager && (
                  <div className="detail-row">
                    <span className="detail-label">Manager</span>
                    <span className="detail-value">{employee.manager}</span>
                  </div>
                )}
              </div>


              {reportees.length > 0 && (
                <div className="emp-detail-card">
                  <h4>Direct Reportees ({reportees.length})</h4>
                  <div className="reportees-list">
                    {reportees.map((reportee) => (
                      <div 
                        key={reportee.employee_id} 
                        className="reportee-item clickable-name"
                        onClick={() => navigate(`/employees/${reportee.employee_id}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="reportee-info">
                          <span className="reportee-name">{reportee.name}</span>
                          <span className="reportee-role">{reportee.role}</span>
                          <span className="reportee-team">{reportee.team}</span>
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="reportee-arrow">
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="emp-detail-card">
                <h4>Timesheet Summary</h4>
                <div className="detail-row">
                  <span className="detail-label">Hours Logged</span>
                  <span className="detail-value">{timesheet.total_hours || 0}h</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Expected Hours</span>
                  <span className="detail-value">{timesheet.expected_hours || 0}h</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Utilization</span>
                  <span className={`detail-value ${timesheet.utilization_percent >= 80 ? 'text-green' : 'text-amber'}`}>
                    {timesheet.utilization_percent || 0}%
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Avg Daily</span>
                  <span className="detail-value">{timesheet.avg_daily_hours || 0}h</span>
                </div>
              </div>

              <div className="emp-detail-card">
                <h4>{isDev ? 'Bug Resolution Metrics' : 'Bug Detection Metrics'}</h4>
                <div className="detail-row">
                  <span className="detail-label">{isDev ? 'Bugs Assigned' : 'Bugs Found'}</span>
                  <span className="detail-value">{bugs.total || 0}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">{isDev ? 'Open Bugs' : 'Still Open'}</span>
                  <span className="detail-value">{bugs.open || 0}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Closed Bugs</span>
                  <span className="detail-value">{bugs.closed || 0}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Avg Age (Open)</span>
                  <span className="detail-value">{bugs.avg_ageing_days || 0} days</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'goals' && (
          <div className="emp-tab-content">
            <div className="goals-header">
              <h3>Goals & Development</h3>
              <button className="btn-action" onClick={() => setShowGoalModal(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Add Item
              </button>
            </div>
            
            <div className="goals-grid">
              {/* Strengths */}
              <div className="goal-column strengths">
                <h4>Strengths</h4>
                {goals.strengths.map(item => (
                  <div key={item.id} className="goal-item">
                    <span className="goal-icon">✓</span>
                    <span className="goal-title">{item.title}</span>
                    <button className="btn-delete-small" onClick={() => handleDeleteGoal(item.id)}>×</button>
                  </div>
                ))}
                {goals.strengths.length === 0 && <div className="no-items">No strengths added</div>}
              </div>

              {/* Areas of Improvement */}
              <div className="goal-column improvements">
                <h4>Areas of Improvement</h4>
                {goals.improvements.map(item => (
                  <div key={item.id} className="goal-item">
                    <span className="goal-icon">!</span>
                    <span className="goal-title">{item.title}</span>
                    <button className="btn-delete-small" onClick={() => handleDeleteGoal(item.id)}>×</button>
                  </div>
                ))}
                {goals.improvements.length === 0 && <div className="no-items">No improvements added</div>}
              </div>

              {/* Active Goals */}
              <div className="goal-column active-goals">
                <h4>Active Goals</h4>
                {goals.goals.map(item => (
                  <div key={item.id} className="goal-item with-progress">
                    <div className="goal-main">
                      <span className="goal-title">{item.title}</span>
                      {item.target_date && <span className="goal-date">Target: {item.target_date}</span>}
                    </div>
                    <div className="goal-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${item.progress || 0}%` }}></div>
                      </div>
                      <span className="progress-text">{item.progress || 0}%</span>
                    </div>
                    <button className="btn-delete-small" onClick={() => handleDeleteGoal(item.id)}>×</button>
                  </div>
                ))}
                {goals.goals.length === 0 && <div className="no-items">No goals set</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reviews' && (
          <div className="emp-tab-content">
            <div className="reviews-header">
              <h3>Performance Reviews</h3>
              <button className="btn-action" onClick={() => navigate(`/employees/${employeeId}/review/new`)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                New Review
              </button>
            </div>
            
            {reviews.length > 0 ? (
              <div className="reviews-list">
                {reviews.map(review => (
                  <div key={review.id} className="review-card">
                    <div className="review-header">
                      <span className="review-period">{review.review_period}</span>
                      <span className="review-date">{review.review_date}</span>
                      <span 
                        className="review-rag"
                        style={{ backgroundColor: getRAGBgColor(review.rag_status), color: getRAGColor(review.rag_status) }}
                      >
                        {review.rag_status} ({review.rag_score})
                      </span>
                    </div>
                    <div className="review-ratings">
                      <div className="rating-item">
                        <span>Technical:</span>
                        <span className="stars">{'★'.repeat(review.technical_rating)}{'☆'.repeat(5-review.technical_rating)}</span>
                      </div>
                      <div className="rating-item">
                        <span>Productivity:</span>
                        <span className="stars">{'★'.repeat(review.productivity_rating)}{'☆'.repeat(5-review.productivity_rating)}</span>
                      </div>
                      <div className="rating-item">
                        <span>Quality:</span>
                        <span className="stars">{'★'.repeat(review.quality_rating)}{'☆'.repeat(5-review.quality_rating)}</span>
                      </div>
                      <div className="rating-item">
                        <span>Communication:</span>
                        <span className="stars">{'★'.repeat(review.communication_rating)}{'☆'.repeat(5-review.communication_rating)}</span>
                      </div>
                    </div>
                    <div className="review-footer">
                      <span className={`recommendation-badge ${review.recommendation}`}>
                        {review.recommendation?.toUpperCase()}
                      </span>
                      {review.salary_hike_percent && (
                        <span className="hike-badge">+{review.salary_hike_percent}% Hike</span>
                      )}
                    </div>
                    {review.manager_comments && (
                      <div className="review-comments">
                        <strong>Comments:</strong> {review.manager_comments}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-reviews">No reviews yet. Create the first review.</div>
            )}
          </div>
        )}

        {activeTab === 'kpi' && (
          <div className="emp-tab-content">
            {/* Consolidated Overall Rating Card */}
            {kpiRatings && kpiRatings.overall_score > 0 && (
              <div className="kpi-overall-card">
                <div className="kpi-overall-header">
                  <h3>Overall KPI Performance</h3>
                  <span className="kpi-quarter-badge">{kpiRatings.quarter}</span>
                </div>
                <div className="kpi-overall-content">
                  <div className="kpi-overall-score">
                    <div className="kpi-score-circle">
                      <svg className="kpi-score-svg" viewBox="0 0 120 120">
                        <circle
                          className="kpi-score-bg"
                          cx="60"
                          cy="60"
                          r="50"
                          fill="none"
                          strokeWidth="8"
                        />
                        <circle
                          className="kpi-score-fill"
                          cx="60"
                          cy="60"
                          r="50"
                          fill="none"
                          strokeWidth="8"
                          strokeDasharray={`${2 * Math.PI * 50}`}
                          strokeDashoffset={`${2 * Math.PI * 50 * (1 - kpiRatings.overall_score / 100)}`}
                          style={{
                            stroke: kpiRatings.overall_score >= 80 ? '#22c55e' : 
                                    kpiRatings.overall_score >= 60 ? '#f59e0b' : '#ef4444'
                          }}
                        />
                      </svg>
                      <div className="kpi-score-value">
                        <span className="kpi-score-number">{kpiRatings.overall_score.toFixed(1)}</span>
                        <span className="kpi-score-unit">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="kpi-overall-rating">
                    <div className={`kpi-rating-badge kpi-rating-${kpiRatings.overall_rating?.toLowerCase().replace(' ', '-')}`}>
                      {kpiRatings.overall_rating}
                    </div>
                    <div className="kpi-rating-info">
                      <span>{kpiRatings.rated_kpis_count} of {kpiRatings.total_kpis_count} KPIs Rated</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="kpi-header">
              <h3>KPI Ratings</h3>
              <div className="kpi-controls">
                <select 
                  value={kpiQuarter} 
                  onChange={(e) => setKpiQuarter(e.target.value)}
                  className="quarter-select"
                >
                  {(() => {
                    const quarters = [];
                    const currentYear = new Date().getFullYear();
                    for (let year = currentYear; year >= currentYear - 2; year--) {
                      for (let q = 4; q >= 1; q--) {
                        quarters.push(`${year}-Q${q}`);
                      }
                    }
                    return quarters;
                  })().map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            </div>

            {kpiRatings && kpiRatings.kpis ? (
              <form onSubmit={handleSubmitKPIRatings} className="kpi-ratings-form">
                <div className="kpi-ratings-grid">
                  {kpiRatings.kpis.map((kpi) => (
                    <div key={kpi.kpi_id} className="kpi-rating-card">
                      <div className="kpi-header-card">
                        <div className="kpi-title-section">
                          <h4 className="kpi-name">{kpi.kpi_name}</h4>
                          {kpi.description && (
                            <p className="kpi-description">{kpi.description}</p>
                          )}
                          <div className="kpi-meta">
                            <span className="kpi-category">{kpi.category}</span>
                            <span className="kpi-weight">Weight: {kpi.weight}x</span>
                          </div>
                        </div>
                      </div>

                      <div className="kpi-rating-section">
                        <div className="rating-display-row">
                          <div className="rating-item">
                            <label>Performance Score</label>
                            <div className="rating-value">
                              {kpi.performance_percentage !== null && kpi.performance_percentage !== undefined 
                                ? `${kpi.performance_percentage.toFixed(1)}%`
                                : kpi.performance_score !== null && kpi.performance_score !== undefined
                                ? kpi.performance_score.toFixed(1)
                                : 'N/A'}
                            </div>
                          </div>
                          <div className="rating-item">
                            <label>Final Score</label>
                            <div className={`rating-value final ${getRatingColor(kpi.final_score)}`}>
                              {kpi.final_score !== null && kpi.final_score !== undefined 
                                ? kpi.final_score.toFixed(1) 
                                : 'Not Rated'}
                            </div>
                          </div>
                        </div>

                        {/* Self Rating Section */}
                        <div className="rating-input-section">
                          <h5 className="rating-section-title">Self Rating</h5>
                          <div className="rating-input-row">
                            <div className="rating-input-group">
                              <label>Self Rating (1-5)</label>
                              <input
                                type="number"
                                min="1"
                                max="5"
                                step="0.1"
                                value={kpiRatingsData[kpi.kpi_id]?.self_rating || ''}
                                onChange={(e) => {
                                  const value = e.target.value ? parseFloat(e.target.value) : '';
                                  setKpiRatingsData({
                                    ...kpiRatingsData,
                                    [kpi.kpi_id]: {
                                      ...kpiRatingsData[kpi.kpi_id],
                                      self_rating: value
                                    }
                                  });
                                }}
                                className="rating-input"
                                placeholder="Enter rating"
                              />
                            </div>
                          </div>
                          <div className="comments-group">
                            <label>Self Comments</label>
                            <textarea
                              value={kpiRatingsData[kpi.kpi_id]?.self_comments || ''}
                              onChange={(e) => {
                                setKpiRatingsData({
                                  ...kpiRatingsData,
                                  [kpi.kpi_id]: {
                                    ...kpiRatingsData[kpi.kpi_id],
                                    self_comments: e.target.value
                                  }
                                });
                              }}
                              className="comments-textarea"
                              placeholder="Add your comments..."
                              rows="2"
                            />
                          </div>
                        </div>

                        {/* Lead Rating Section */}
                        {employee?.lead && (
                          <div className="rating-input-section">
                            <h5 className="rating-section-title">Lead Rating {employee.lead && employee.manager && employee.lead.trim().toUpperCase() === employee.manager.trim().toUpperCase() ? '(Same as Manager)' : ''}</h5>
                            <div className="rating-input-row">
                              <div className="rating-input-group">
                                <label>Lead Rating (1-5)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="5"
                                  step="0.1"
                                  value={kpiRatingsData[kpi.kpi_id]?.lead_rating || ''}
                                  onChange={(e) => {
                                    const value = e.target.value ? parseFloat(e.target.value) : '';
                                    setKpiRatingsData({
                                      ...kpiRatingsData,
                                      [kpi.kpi_id]: {
                                        ...kpiRatingsData[kpi.kpi_id],
                                        lead_rating: value
                                      }
                                    });
                                  }}
                                  className="rating-input"
                                  placeholder="Enter rating"
                                />
                              </div>
                            </div>
                            <div className="comments-group">
                              <label>Lead Comments</label>
                              <textarea
                                value={kpiRatingsData[kpi.kpi_id]?.lead_comments || ''}
                                onChange={(e) => {
                                  setKpiRatingsData({
                                    ...kpiRatingsData,
                                    [kpi.kpi_id]: {
                                      ...kpiRatingsData[kpi.kpi_id],
                                      lead_comments: e.target.value
                                    }
                                  });
                                }}
                                className="comments-textarea"
                                placeholder="Add lead comments..."
                                rows="2"
                              />
                            </div>
                          </div>
                        )}

                        {/* Manager Rating Section */}
                        {employee?.manager && employee.lead && employee.lead.trim().toUpperCase() !== employee.manager.trim().toUpperCase() && (
                          <div className="rating-input-section">
                            <h5 className="rating-section-title">Manager Rating</h5>
                            <div className="rating-input-row">
                              <div className="rating-input-group">
                                <label>Manager Rating (1-5)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="5"
                                  step="0.1"
                                  value={kpiRatingsData[kpi.kpi_id]?.manager_rating || ''}
                                  onChange={(e) => {
                                    const value = e.target.value ? parseFloat(e.target.value) : '';
                                    setKpiRatingsData({
                                      ...kpiRatingsData,
                                      [kpi.kpi_id]: {
                                        ...kpiRatingsData[kpi.kpi_id],
                                        manager_rating: value
                                      }
                                    });
                                  }}
                                  className="rating-input"
                                  placeholder="Enter rating"
                                />
                              </div>
                            </div>
                            <div className="comments-group">
                              <label>Manager Comments</label>
                              <textarea
                                value={kpiRatingsData[kpi.kpi_id]?.manager_comments || ''}
                                onChange={(e) => {
                                  setKpiRatingsData({
                                    ...kpiRatingsData,
                                    [kpi.kpi_id]: {
                                      ...kpiRatingsData[kpi.kpi_id],
                                      manager_comments: e.target.value
                                    }
                                  });
                                }}
                                className="comments-textarea"
                                placeholder="Add manager comments..."
                                rows="2"
                              />
                            </div>
                          </div>
                        )}

                        {/* If lead and manager are same, show combined manager/lead section */}
                        {employee?.lead && employee?.manager && employee.lead.trim().toUpperCase() === employee.manager.trim().toUpperCase() && (
                          <div className="rating-input-section">
                            <h5 className="rating-section-title">Lead/Manager Rating</h5>
                            <div className="rating-input-row">
                              <div className="rating-input-group">
                                <label>Lead/Manager Rating (1-5)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="5"
                                  step="0.1"
                                  value={kpiRatingsData[kpi.kpi_id]?.manager_rating || kpiRatingsData[kpi.kpi_id]?.lead_rating || ''}
                                  onChange={(e) => {
                                    const value = e.target.value ? parseFloat(e.target.value) : '';
                                    setKpiRatingsData({
                                      ...kpiRatingsData,
                                      [kpi.kpi_id]: {
                                        ...kpiRatingsData[kpi.kpi_id],
                                        lead_rating: value,
                                        manager_rating: value
                                      }
                                    });
                                  }}
                                  className="rating-input"
                                  placeholder="Enter rating"
                                />
                              </div>
                            </div>
                            <div className="comments-group">
                              <label>Lead/Manager Comments</label>
                              <textarea
                                value={kpiRatingsData[kpi.kpi_id]?.manager_comments || kpiRatingsData[kpi.kpi_id]?.lead_comments || ''}
                                onChange={(e) => {
                                  setKpiRatingsData({
                                    ...kpiRatingsData,
                                    [kpi.kpi_id]: {
                                      ...kpiRatingsData[kpi.kpi_id],
                                      lead_comments: e.target.value,
                                      manager_comments: e.target.value
                                    }
                                  });
                                }}
                                className="comments-textarea"
                                placeholder="Add lead/manager comments..."
                                rows="2"
                              />
                            </div>
                          </div>
                        )}

                        {kpi.rated_by && (
                          <div className="rating-meta">
                            <span>Rated by: {kpi.rated_by}</span>
                            {kpi.rated_on && (
                              <span>on {formatDisplayDate(kpi.rated_on)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="kpi-form-actions">
                  <button 
                    type="submit" 
                    className="btn-submit"
                    data-rating-type="self"
                    onClick={(e) => e.currentTarget.closest('form').dataset.ratingType = 'self'}
                  >
                    Save Self Rating
                  </button>
                  {employee?.lead && (
                    <button 
                      type="submit" 
                      className="btn-submit"
                      data-rating-type="lead"
                      onClick={(e) => e.currentTarget.closest('form').dataset.ratingType = 'lead'}
                    >
                      Save Lead Rating
                    </button>
                  )}
                  {employee?.manager && employee.lead && employee.lead.trim().toUpperCase() !== employee.manager.trim().toUpperCase() && (
                    <button 
                      type="submit" 
                      className="btn-submit"
                      data-rating-type="manager"
                      onClick={(e) => e.currentTarget.closest('form').dataset.ratingType = 'manager'}
                    >
                      Save Manager Rating
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="no-kpis">
                <p>No KPIs found for this employee's role. Please import KPI matrix first.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="emp-tab-content">
            <div className="calendar-header">
              <h3>Timesheet & Calendar</h3>
              <div className="calendar-controls-inline">
                <div className="view-toggle">
                  <button 
                    className={`toggle-btn ${calendarPeriod === 'week' ? 'active' : ''}`}
                    onClick={() => setCalendarPeriod('week')}
                  >
                    Weekly
                  </button>
                  <button 
                    className={`toggle-btn ${calendarPeriod === 'month' ? 'active' : ''}`}
                    onClick={() => setCalendarPeriod('month')}
                  >
                    Monthly
                  </button>
                </div>
                
                <div className="date-navigation">
                  {calendarPeriod === 'month' ? (
                    <>
                      <button 
                        className="nav-btn"
                        onClick={() => {
                          const newDate = new Date(calendarDate);
                          newDate.setMonth(newDate.getMonth() - 1);
                          setCalendarDate(newDate);
                        }}
                      >
                        ← Prev
                      </button>
                      <input
                        type="month"
                        className="month-picker"
                        value={`${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}`}
                        onChange={(e) => {
                          const [year, month] = e.target.value.split('-');
                          setCalendarDate(new Date(year, month - 1, 1));
                        }}
                      />
                      <button 
                        className="nav-btn"
                        onClick={() => {
                          const newDate = new Date(calendarDate);
                          newDate.setMonth(newDate.getMonth() + 1);
                          setCalendarDate(newDate);
                        }}
                      >
                        Next →
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        className="nav-btn"
                        onClick={() => {
                          const newDate = new Date(calendarDate);
                          newDate.setDate(newDate.getDate() - 7);
                          setCalendarDate(newDate);
                        }}
                      >
                        ← Prev Week
                      </button>
                      <input
                        type="date"
                        className="date-picker"
                        value={formatAPIDate(calendarDate)}
                        onChange={(e) => setCalendarDate(new Date(e.target.value))}
                      />
                      <button 
                        className="nav-btn"
                        onClick={() => {
                          const newDate = new Date(calendarDate);
                          newDate.setDate(newDate.getDate() + 7);
                          setCalendarDate(newDate);
                        }}
                      >
                        Next Week →
                      </button>
                    </>
                  )}
                  <button className="today-btn" onClick={() => setCalendarDate(new Date())}>
                    Today
                  </button>
                </div>
              </div>
            </div>

            {calendarData ? (
              <div className="employee-calendar-view">
                {/* Summary Cards */}
                <div className="calendar-summary-cards">
                  <div className="summary-card">
                    <span className="card-label">Total Hours</span>
                    <span className="card-value">{calendarData.summary?.total_actual_hours?.toFixed(1) || 0}h</span>
                  </div>
                  <div className="summary-card">
                    <span className="card-label">Productive Hours</span>
                    <span className="card-value">{calendarData.summary?.total_productive_hours?.toFixed(1) || 0}h</span>
                  </div>
                  <div className="summary-card">
                    <span className="card-label">Planned Hours</span>
                    <span className="card-value">{calendarData.summary?.total_planned_hours?.toFixed(1) || 0}h</span>
                  </div>
                  <div className="summary-card">
                    <span className="card-label">Leave Days</span>
                    <span className="card-value">{calendarData.summary?.leave_days || 0}</span>
                  </div>
                  <div className="summary-card">
                    <span className="card-label">Working Days</span>
                    <span className="card-value">{calendarData.summary?.working_days || 0}</span>
                  </div>
                  <div className="summary-card">
                    <span className="card-label">Daily Average</span>
                    <span className="card-value">
                      {calendarData.summary?.total_actual_hours && calendarData.summary?.working_days
                        ? (calendarData.summary.total_actual_hours / calendarData.summary.working_days).toFixed(1)
                        : 0}h
                    </span>
                  </div>
                </div>

                {/* Calendar View */}
                {calendarPeriod === 'week' ? renderEmployeeWeeklyView() : renderEmployeeMonthlyView()}
              </div>
            ) : (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading calendar data...</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Goal Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Add Goal / Strength / Improvement</h2>
            <form onSubmit={handleAddGoal}>
              <div className="form-group">
                <label>Type</label>
                <select 
                  value={newGoal.goal_type}
                  onChange={e => setNewGoal({...newGoal, goal_type: e.target.value})}
                >
                  <option value="goal">Goal</option>
                  <option value="strength">Strength</option>
                  <option value="improvement">Area of Improvement</option>
                </select>
              </div>
              <div className="form-group">
                <label>Title *</label>
                <input 
                  type="text"
                  required
                  value={newGoal.title}
                  onChange={e => setNewGoal({...newGoal, title: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newGoal.description}
                  onChange={e => setNewGoal({...newGoal, description: e.target.value})}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowGoalModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditModal && employee && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Edit Employee Profile</h2>
            <form onSubmit={handleUpdateEmployee}>
              <div className="form-row">
                <div className="form-group">
                  <label>Name *</label>
                  <input 
                    type="text" 
                    required
                    value={editForm.name}
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input 
                    type="email" 
                    required
                    value={editForm.email}
                    onChange={e => setEditForm({...editForm, email: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Role</label>
                  <input 
                    type="text"
                    value={editForm.role}
                    onChange={e => setEditForm({...editForm, role: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Location</label>
                  <input 
                    type="text"
                    value={editForm.location}
                    onChange={e => setEditForm({...editForm, location: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Team *</label>
                  <select 
                    required
                    value={editForm.team}
                    onChange={e => setEditForm({...editForm, team: e.target.value})}
                  >
                    <option value="DEVELOPMENT">Development</option>
                    <option value="QA">QA</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select 
                    value={editForm.category}
                    onChange={e => setEditForm({...editForm, category: e.target.value})}
                  >
                    <option value="BILLED">Billed</option>
                    <option value="UN-BILLED">Un-billed</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Employment Status</label>
                  <select 
                    value={editForm.employment_status}
                    onChange={e => setEditForm({...editForm, employment_status: e.target.value})}
                  >
                    <option value="Ongoing Employee">Ongoing Employee</option>
                    <option value="Resigned">Resigned</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Reporting To (Lead)</label>
                  <input 
                    type="text"
                    value={editForm.lead || ''}
                    onChange={e => setEditForm({...editForm, lead: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Manager</label>
                  <input 
                    type="text"
                    value={editForm.manager || ''}
                    onChange={e => setEditForm({...editForm, manager: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Previous Experience (Years)</label>
                  <input 
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.previous_experience || ''}
                    onChange={e => setEditForm({...editForm, previous_experience: e.target.value ? parseFloat(e.target.value) : null})}
                    placeholder="Years before joining Techversant"
                  />
                </div>
                <div className="form-group">
                  <label>BIS Introduced Date</label>
                  <input 
                    type="date"
                    value={editForm.bis_introduced_date ? editForm.bis_introduced_date.split('T')[0] : ''}
                    onChange={e => setEditForm({...editForm, bis_introduced_date: e.target.value ? new Date(e.target.value).toISOString() : null})}
                    disabled={editForm.category !== 'BILLED'}
                    title={editForm.category !== 'BILLED' ? 'Only applicable for Billed employees' : ''}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Platform</label>
                  <select 
                    value={editForm.platform}
                    onChange={e => setEditForm({...editForm, platform: e.target.value})}
                  >
                    <option value="">Select Platform</option>
                    <option value="Web">Web</option>
                    <option value="Mobile">Mobile</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Photo URL</label>
                  <input 
                    type="text"
                    value={editForm.photo_url || ''}
                    onChange={e => setEditForm({...editForm, photo_url: e.target.value})}
                    placeholder="Enter photo URL or path"
                  />
                </div>
                <div className="form-group">
                  <label>Active Status</label>
                  <select 
                    value={editForm.is_active}
                    onChange={e => setEditForm({...editForm, is_active: e.target.value === 'true'})}
                  >
                    <option value={true}>Active</option>
                    <option value={false}>Inactive</option>
                  </select>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Update Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmployeeProfile;
