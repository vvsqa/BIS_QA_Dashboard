import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatAPIDate, formatDisplayDate, formatDateRange, formatTime } from './dateUtils';
import './CalendarModule.css';

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

// Helper function to get week days
const getWeekDays = (weekStart) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    days.push(day);
  }
  return days;
};

// Day names
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];

function CalendarModule() {
  const navigate = useNavigate();
  
  // State
  const [view, setView] = useState('weekly'); // 'weekly' or 'monthly'
  const [team, setTeam] = useState('ALL');
  const [category, setCategory] = useState('ALL'); // BILLED, UN-BILLED, or ALL
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  // Calculate week boundaries
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  
  // Calculate month boundaries
  const monthStart = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  }, [currentDate]);
  
  const monthEnd = useMemo(() => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  }, [currentDate]);

  // Fetch calendar data
  const fetchCalendarData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      let url;
      if (view === 'weekly') {
        url = `${API_BASE}/calendar/weekly?team=${team}&category=${category}&date_str=${formatDate(currentDate)}`;
      } else {
        const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        url = `${API_BASE}/calendar/monthly?team=${team}&category=${category}&month=${monthStr}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch calendar data');
      const data = await response.json();
      setCalendarData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [view, team, category, currentDate]);

  // Fetch sync status
  const fetchSyncStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/sync/google-sheets/status`);
      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  };

  // Trigger manual sync
  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${API_BASE}/sync/google-sheets?team=${team !== 'ALL' ? team : ''}`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Sync failed');
      }
      await fetchCalendarData();
      await fetchSyncStatus(); // Refresh status
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  // Start auto-sync (real-time mode)
  const handleStartAutoSync = async (realtime = true) => {
    try {
      const url = `${API_BASE}/sync/google-sheets/start?realtime=${realtime}`;
      const response = await fetch(url, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to start auto-sync');
      }
      await fetchSyncStatus();
      // Refresh calendar data after starting sync
      setTimeout(() => fetchCalendarData(), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  // Stop auto-sync
  const handleStopAutoSync = async () => {
    try {
      const response = await fetch(`${API_BASE}/sync/google-sheets/stop`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to stop auto-sync');
      }
      await fetchSyncStatus();
    } catch (err) {
      setError(err.message);
    }
  };

  // Navigation handlers
  const goToPrevious = () => {
    if (view === 'weekly') {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() - 7);
      setCurrentDate(newDate);
    } else {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() - 1);
      setCurrentDate(newDate);
    }
  };

  const goToNext = () => {
    if (view === 'weekly') {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + 7);
      setCurrentDate(newDate);
    } else {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() + 1);
      setCurrentDate(newDate);
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Effects
  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

  // Track last sync time to detect new syncs
  const [lastKnownSyncTime, setLastKnownSyncTime] = useState(null);

  useEffect(() => {
    fetchSyncStatus();
    
    // Auto-refresh sync status every 10 seconds
    const statusInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/sync/google-sheets/status`);
        if (response.ok) {
          const status = await response.json();
          
          if (status?.scheduler?.last_sync) {
            const currentSyncTime = status.scheduler.last_sync;
            
            // If this is a new sync (different from last known), refresh calendar
            if (lastKnownSyncTime && currentSyncTime !== lastKnownSyncTime) {
              console.log('New sync detected, refreshing calendar data...');
              // Refresh calendar data
              const viewParam = view === 'weekly' ? `weekly?team=${team}&date_str=${formatDate(currentDate)}` 
                : `monthly?team=${team}&month=${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
              fetch(`${API_BASE}/calendar/${viewParam}`)
                .then(r => r.json())
                .then(data => setCalendarData(data))
                .catch(err => console.error('Failed to refresh calendar:', err));
            }
            
            setLastKnownSyncTime(currentSyncTime);
            setSyncStatus(status);
          }
        }
      } catch (err) {
        console.error('Error checking sync status:', err);
      }
    }, 10000); // Check every 10 seconds for real-time updates
    
    return () => clearInterval(statusInterval);
  }, [lastKnownSyncTime, view, team, currentDate]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

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

  // Render weekly view
  const renderWeeklyView = () => {
    if (!calendarData?.employees) return null;

    // Calculate daily totals and averages
    const dailyTotals = weekDays.map((day) => {
      const dayKey = formatDate(day);
      let totalProductive = 0;
      let totalTimeSpent = 0;
      let count = 0;
      calendarData.employees.forEach(emp => {
        const dayData = emp.days?.[dayKey];
        if (dayData) {
          totalTimeSpent += dayData.total_hours || 0;
          totalProductive += dayData.productive_hours || dayData.total_hours || 0;
          if (dayData.total_hours > 0) count++;
        }
      });
      return {
        totalProductive,
        totalTimeSpent,
        average: count > 0 ? totalTimeSpent / count : 0,
        count
      };
    });

    // Calculate grand totals for footer
    const grandTotals = {
      totalProductive: dailyTotals.reduce((sum, d) => sum + d.totalProductive, 0),
      totalTimeSpent: dailyTotals.reduce((sum, d) => sum + d.totalTimeSpent, 0),
      averagePerDay: dailyTotals.filter(d => d.count > 0).length > 0 
        ? dailyTotals.reduce((sum, d) => sum + d.totalTimeSpent, 0) / dailyTotals.filter(d => d.count > 0).length
        : 0,
      averagePerEmployee: calendarData.employees.length > 0
        ? dailyTotals.reduce((sum, d) => sum + d.totalTimeSpent, 0) / calendarData.employees.length
        : 0
    };

    return (
      <div className="calendar-weekly">
        <table className="calendar-table">
          <thead>
            <tr>
              <th className="employee-col">Employee</th>
              {weekDays.map((day, idx) => {
                const dayKey = formatDate(day);
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                // Find holiday for this day - check any employee's day data for holiday info
                let holiday = null;
                if (calendarData?.employees && calendarData.employees.length > 0) {
                  const firstEmp = calendarData.employees[0];
                  const dayData = firstEmp.days?.[dayKey];
                  if (dayData?.is_holiday) {
                    holiday = {
                      name: dayData.holiday_name,
                      category: dayData.holiday_category
                    };
                  }
                }
                
                return (
                  <th key={idx} className={`day-header ${isWeekend ? 'weekend' : ''} ${holiday ? 'holiday' : ''}`}>
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
            {calendarData.employees.map((emp, empIdx) => (
              <tr key={empIdx} className="employee-row">
                <td className="employee-cell">
                  <div className="employee-info">
                    <span 
                      className="employee-name clickable"
                      onClick={() => emp.employee_id && navigate(`/employees/${emp.employee_id}`)}
                    >
                      {emp.employee_name}
                    </span>
                    <span className="employee-team">{emp.team}</span>
                  </div>
                </td>
                {weekDays.map((day, dayIdx) => {
                  const dayKey = formatDate(day);
                  const dayData = emp.days?.[dayKey] || { entries: [], total_hours: 0, leave_type: null };
                  
                  // Use holiday/weekend info from API if available, otherwise calculate
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
                                    (!dayData.entries || dayData.entries.length === 0) && 
                                    (!dayData.total_hours || dayData.total_hours === 0);
                  const showNoEntryIndicator = isPastDate && hasNoEntry && isWorkingDay;
                  
                  return (
                    <td 
                      key={dayIdx} 
                      className={`day-cell ${isWeekend ? 'weekend' : ''} ${isHoliday ? 'holiday' : ''} ${dayData.leave_type ? 'has-leave' : ''} ${showNoEntryIndicator ? 'no-entry-past' : ''}`}
                      onClick={() => setSelectedEmployee({ ...emp, selectedDay: dayKey })}
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
                      {dayData.entries && dayData.entries.length > 0 && (
                        <div className="day-entries">
                          {dayData.entries.slice(0, 3).map((entry, idx) => {
                            const isTicket = entry.ticket_id && 
                              entry.ticket_id !== 'LEAVE' && 
                              entry.ticket_id !== 'UNASSIGNED' &&
                              /^\d+$/.test(entry.ticket_id); // Check if it's a numeric ticket ID
                            
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
                          {dayData.entries.length > 3 && (
                            <div className="more-entries">+{dayData.entries.length - 3} more</div>
                          )}
                        </div>
                      )}
                      <div className={`day-total ${getHoursColorClass(dayData.total_hours)}`}>
                        <strong>{dayData.total_hours > 0 ? `${parseFloat(dayData.total_hours).toFixed(1)}h` : '-'}</strong>
                      </div>
                    </td>
                  );
                })}
                <td className={`total-cell ${getHoursColorClass(emp.weekly_total_hours / 5)}`}>
                  <strong>{parseFloat(emp.weekly_total_hours || 0).toFixed(1)}h</strong>
                  <div className="weekly-avg">
                    Avg: {((emp.weekly_total_hours || 0) / 5).toFixed(1)}h/day
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Daily totals row */}
            <tr className="totals-row daily-totals-row">
              <td className="totals-label">Daily Totals</td>
              {dailyTotals.map((dayTotal, idx) => (
                <td key={idx} className="totals-cell">
                  <div className="totals-breakdown">
                    <span className="total-time-spent">{dayTotal.totalTimeSpent.toFixed(1)}h</span>
                    <span className="total-avg">Avg: {dayTotal.average.toFixed(1)}h</span>
                  </div>
                </td>
              ))}
              <td className="totals-cell grand-total">
                <strong>{grandTotals.totalTimeSpent.toFixed(1)}h</strong>
              </td>
            </tr>
            {/* Summary row */}
            <tr className="totals-row summary-row">
              <td colSpan={weekDays.length + 2} className="summary-cell">
                <div className="weekly-summary-stats">
                  <div className="summary-stat">
                    <span className="stat-icon">⏱️</span>
                    <span className="stat-label">Total Time Spent</span>
                    <span className="stat-value">{grandTotals.totalTimeSpent.toFixed(1)}h</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-icon">✅</span>
                    <span className="stat-label">Total Productive</span>
                    <span className="stat-value productive">{grandTotals.totalProductive.toFixed(1)}h</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-icon">📊</span>
                    <span className="stat-label">Avg per Day</span>
                    <span className="stat-value">{grandTotals.averagePerDay.toFixed(1)}h</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-icon">👤</span>
                    <span className="stat-label">Avg per Employee</span>
                    <span className="stat-value">{grandTotals.averagePerEmployee.toFixed(1)}h</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-icon">👥</span>
                    <span className="stat-label">Total Employees</span>
                    <span className="stat-value">{calendarData.employees.length}</span>
                  </div>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // Render monthly view
  const renderMonthlyView = () => {
    if (!calendarData?.employees) return null;

    // Generate calendar grid for the month
    const firstDay = new Date(monthStart);
    const startPadding = (firstDay.getDay() + 6) % 7; // Monday = 0
    const totalDays = monthEnd.getDate();
    
    const calendarDays = [];
    // Add padding days
    for (let i = 0; i < startPadding; i++) {
      calendarDays.push(null);
    }
    // Add actual days
    for (let i = 1; i <= totalDays; i++) {
      calendarDays.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
    }
    
    // Short day names for headers
    const shortDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return (
      <div className="calendar-monthly">
        {/* Summary cards */}
        <div className="monthly-summary">
          <div className="summary-card">
            <span className="summary-label">Total Employees</span>
            <span className="summary-value">{calendarData.employees.length}</span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Avg Productive Hours</span>
            <span className="summary-value">
              {calendarData.employees.length > 0 
                ? (calendarData.employees.reduce((sum, emp) => sum + (emp.avg_productive_hours || 0), 0) / calendarData.employees.length).toFixed(1)
                : '0.0'}h
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Total Leave Days</span>
            <span className="summary-value">
              {calendarData.employees.reduce((sum, emp) => sum + (emp.total_leave_days || 0), 0)}
            </span>
          </div>
        </div>
        
        {/* Monthly Calendar Table */}
        <div className="monthly-calendar-container">
          <div className="monthly-calendar-scroll">
            {/* Sticky Header Row */}
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
              
              {/* Employee Data Rows */}
              {calendarData.employees.map((emp, idx) => (
                <div key={idx} className="monthly-row data-row">
                  <div className="employee-col">
                    <span 
                      className="employee-name clickable"
                      onClick={() => emp.employee_id && navigate(`/employees/${emp.employee_id}`)}
                    >
                      {emp.employee_name}
                    </span>
                    <span className="employee-team">{emp.team}</span>
                  </div>
                  <div className="stats-col">
                    <span className="stat-value">{emp.avg_productive_hours?.toFixed(1) || '0.0'}h</span>
                  </div>
                  <div className="stats-col">
                    <span className="stat-value">{emp.working_days || 0}</span>
                  </div>
                  <div className="stats-col">
                    <span className="stat-value">{emp.total_leave_days || 0}</span>
                  </div>
                  {calendarDays.map((day, dayIdx) => {
                    if (!day) return <div key={dayIdx} className="day-col heatmap-cell empty"></div>;
                    
                    const dayKey = formatDate(day);
                    const dayData = emp.days?.[dayKey];
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const dayDate = new Date(day);
                    dayDate.setHours(0, 0, 0, 0);
                    const isPastDate = dayDate <= today;
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                    
                    // Future dates - show with distinct style
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
                    
                    // Check if no entries for this past date
                    const hasNoEntries = !dayData || (
                      (!dayData.productive_hours || dayData.productive_hours === 0) &&
                      (!dayData.hours_logged || dayData.hours_logged === 0) &&
                      !dayData.leave_type
                    );
                    
                    // Get productive hours (preferred if > 0) or hours_logged (fallback)
                    const productiveHours = dayData?.productive_hours || 0;
                    const hoursLogged = dayData?.hours_logged || 0;
                    // Use productive_hours only if it has a positive value, otherwise use hours_logged
                    const displayHours = productiveHours > 0 ? productiveHours : hoursLogged;
                    
                    // Leave detection
                    const leaveType = dayData?.leave_type || '';
                    const hasLeave = !!leaveType;
                    const isFullDayLeave = hasLeave && leaveType.toLowerCase().includes('half') === false;
                    const isHalfDayLeave = hasLeave && leaveType.toLowerCase().includes('half');
                    
                    // Low hours detection (below 7 hours without any leave)
                    const isLowHoursNoLeave = !hasLeave && !isWeekend && displayHours > 0 && displayHours < 7;
                    
                    // No entries for past date - highlight with warning
                    if (hasNoEntries && !isWeekend) {
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
                    
                    // Low hours without leave - warning style
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
              ))}
            </div>
          </div>
        </div>
        
        {/* Legend for monthly view */}
        <div className="monthly-legend">
          <div className="legend-section">
            <span className="legend-title">Hours</span>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-color hours-full"></span>
                <span>8+ hrs</span>
              </div>
              <div className="legend-item">
                <span className="legend-color hours-half"></span>
                <span>4-8 hrs</span>
              </div>
              <div className="legend-item">
                <span className="legend-color hours-low"></span>
                <span>1-4 hrs</span>
              </div>
            </div>
          </div>
          <div className="legend-divider"></div>
          <div className="legend-section">
            <span className="legend-title">Leave</span>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-icon full-leave">L</span>
                <span>Full Day</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon half-leave">½</span>
                <span>Half Day</span>
              </div>
            </div>
          </div>
          <div className="legend-divider"></div>
          <div className="legend-section">
            <span className="legend-title">Alerts</span>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-icon no-entries">!</span>
                <span>No Entry</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon low-hours-warning">⚠</span>
                <span>&lt;7h No Leave</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon future">-</span>
                <span>Future</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render employee detail modal
  const renderEmployeeModal = () => {
    if (!selectedEmployee) return null;

    const dayData = selectedEmployee.days?.[selectedEmployee.selectedDay];

    return (
      <div className="modal-overlay" onClick={() => setSelectedEmployee(null)}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{selectedEmployee.employee_name}</h3>
            <span className="modal-date">{selectedEmployee.selectedDay}</span>
            <button className="modal-close" onClick={() => setSelectedEmployee(null)}>×</button>
          </div>
          <div className="modal-body">
            {dayData?.leave_type && (
              <div className={`leave-info ${getLeaveBadgeClass(dayData.leave_type)}`}>
                <span className="leave-icon">📅</span>
                <span>{dayData.leave_type}</span>
              </div>
            )}
            {dayData?.entries?.length > 0 ? (
              <div className="entries-list">
                <h4>Time Entries</h4>
                {dayData.entries.map((entry, idx) => {
                  const isTicket = entry.ticket_id && 
                    entry.ticket_id !== 'LEAVE' && 
                    entry.ticket_id !== 'UNASSIGNED' &&
                    /^\d+$/.test(entry.ticket_id); // Check if it's a numeric ticket ID
                  
                  return (
                    <div 
                      key={idx} 
                      className={`entry-detail ${isTicket ? 'clickable-entry' : ''}`}
                      onClick={() => {
                        if (isTicket) {
                          navigate(`/tickets?ticket=${entry.ticket_id}`);
                          setSelectedEmployee(null); // Close modal
                        }
                      }}
                    >
                      <div className="entry-main">
                        <span className={`entry-ticket ${isTicket ? 'ticket-link' : ''}`}>
                          {isTicket ? `#${entry.ticket_id}` : entry.ticket_id || 'Task'}
                        </span>
                        <span className="entry-hours">{entry.hours}h</span>
                      </div>
                      {entry.task_description && (
                        <div className="entry-desc">{entry.task_description}</div>
                      )}
                      {entry.project_name && (
                        <div className="entry-project">{entry.project_name}</div>
                      )}
                    </div>
                  );
                })}
                <div className="entries-total">
                  <strong>Total: {dayData.total_hours}h</strong>
                </div>
              </div>
            ) : (
              <p className="no-entries">No time entries for this day</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="calendar-module">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <img src="/techversant-logo.png" alt="Techversant" className="company-logo" />
          <div className="logo-text">
            <span className="logo-title">QA Dashboard</span>
            <span className="logo-subtitle">Calendar</span>
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
          <a href="/calendar" className="nav-item active">
            <span className="nav-icon">📅</span>
            <span>Calendar</span>
          </a>
          <a href="/planning" className="nav-item">
            <span className="nav-icon">📋</span>
            <span>Task Planning</span>
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
            <h1>📅 Team Calendar</h1>
            <p>View daily time entries and leave for your team</p>
          </div>
          
          <div className="header-actions">
            {/* Sync Status */}
            <div className="sync-status">
              {syncStatus?.credentials_configured ? (
                <>
                  <div className="sync-controls">
                    <button 
                      className={`sync-btn ${syncing ? 'syncing' : ''}`}
                      onClick={handleSync}
                      disabled={syncing}
                      title="Manual sync"
                    >
                      {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
                    </button>
                    {syncStatus?.scheduler?.running ? (
                      <button 
                        className="sync-btn stop"
                        onClick={handleStopAutoSync}
                        title="Stop auto-sync"
                      >
                        ⏸️ Stop Auto-Sync
                      </button>
                    ) : (
                      <button 
                        className="sync-btn start"
                        onClick={handleStartAutoSync}
                        title="Start auto-sync"
                      >
                        ▶️ Start Auto-Sync
                      </button>
                    )}
                  </div>
                  {syncStatus?.scheduler && (
                    <div className="sync-info">
                      {syncStatus.scheduler.running ? (
                        <>
                          <span className={`sync-indicator ${syncStatus.scheduler.realtime_mode ? 'realtime' : 'running'}`}>
                            {syncStatus.scheduler.realtime_mode ? '⚡' : '●'}
                          </span>
                          <span className="sync-text">
                            {syncStatus.scheduler.realtime_mode ? (
                              <>
                                <strong>Real-time Sync</strong> (2 min)
                              </>
                            ) : (
                              <>
                                Auto-sync: Every {Math.round(syncStatus.scheduler.interval_minutes)} min
                              </>
                            )}
                            {syncStatus.scheduler.last_sync && (
                              <> | Last: {formatTime(syncStatus.scheduler.last_sync)}</>
                            )}
                            {syncStatus.scheduler.next_sync && (
                              <> | Next: {formatTime(syncStatus.scheduler.next_sync)}</>
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="sync-indicator stopped">●</span>
                          <span className="sync-text">Auto-sync stopped</span>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <span className="sync-warning">⚠️ Google Sheets not configured</span>
              )}
            </div>
          </div>
        </header>

        {/* Controls */}
        <div className="calendar-controls">
          <div className="control-group">
            {/* View Toggle */}
            <div className="view-toggle">
              <button 
                className={`toggle-btn ${view === 'weekly' ? 'active' : ''}`}
                onClick={() => setView('weekly')}
              >
                Weekly
              </button>
              <button 
                className={`toggle-btn ${view === 'monthly' ? 'active' : ''}`}
                onClick={() => setView('monthly')}
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

            {/* Category Filter (Billed/Un-Billed) */}
            <select 
              className="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="ALL">All Resources</option>
              <option value="BILLED">Billed</option>
              <option value="UN-BILLED">Un-Billed</option>
            </select>
          </div>

          <div className="date-navigation">
            {view === 'monthly' ? (
              <>
                <select 
                  className="month-select"
                  value={currentDate.getMonth()}
                  onChange={(e) => {
                    const newDate = new Date(currentDate);
                    newDate.setMonth(parseInt(e.target.value));
                    setCurrentDate(newDate);
                  }}
                >
                  {MONTH_NAMES.map((month, idx) => (
                    <option key={idx} value={idx}>{month}</option>
                  ))}
                </select>
                <select 
                  className="year-select"
                  value={currentDate.getFullYear()}
                  onChange={(e) => {
                    const newDate = new Date(currentDate);
                    newDate.setFullYear(parseInt(e.target.value));
                    setCurrentDate(newDate);
                  }}
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - 2 + i;
                    return <option key={year} value={year}>{year}</option>;
                  })}
                </select>
                <button className="today-btn" onClick={goToToday}>
                  Today
                </button>
              </>
            ) : (
              <>
                <button className="nav-btn" onClick={goToPrevious}>
                  ←
                </button>
                <button className="today-btn" onClick={goToToday}>
                  Today
                </button>
                <span className="current-period">
                  {formatDateRange(weekStart, weekDays[6])}
                </span>
                <button className="nav-btn" onClick={goToNext}>
                  →
                </button>
              </>
            )}
          </div>
        </div>

        {/* Calendar Content */}
        <div className="calendar-content">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading calendar data...</p>
            </div>
          )}
          
          {error && (
            <div className="error-state">
              <p>⚠️ {error}</p>
              <button onClick={fetchCalendarData}>Retry</button>
            </div>
          )}
          
          {!loading && !error && (
            <>
              {view === 'weekly' ? renderWeeklyView() : renderMonthlyView()}
            </>
          )}
        </div>

        {/* Legend */}
        <div className="calendar-legend">
          <div className="legend-item">
            <span className="legend-color hours-full"></span>
            <span>8+ hours</span>
          </div>
          <div className="legend-item">
            <span className="legend-color hours-half"></span>
            <span>4-8 hours</span>
          </div>
          <div className="legend-item">
            <span className="legend-color hours-low"></span>
            <span>1-4 hours</span>
          </div>
          <div className="legend-item">
            <span className="legend-color hours-zero"></span>
            <span>No entry</span>
          </div>
          <div className="legend-divider"></div>
          <div className="legend-item">
            <span className="legend-badge leave-regular">Leave</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge leave-wfh">WFH</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge leave-holiday">Holiday</span>
          </div>
        </div>
      </main>

      {/* Employee Detail Modal */}
      {renderEmployeeModal()}
    </div>
  );
}

export default CalendarModule;
