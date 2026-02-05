import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatAPIDate, formatDateRange, formatDisplayDateWithDay } from './dateUtils';
import './CalendarModule.css';
import './TimeSheetModule.css';
import { apiFetch, API_BASE } from './api';
import { useAuth } from './AuthContext';
import { TicketExternalLink } from './ticketUtils';

const BACKEND_BASE = (API_BASE || 'http://localhost:8000').replace(/\/$/, '');
const TIMESHEET_HEALTH_URL = `${BACKEND_BASE}/timesheet/health`;

const ACTIVITY_TYPES = [
  'Development',
  'QA',
  'Code Review',
  'Planning',
  'Support',
  'Other'
];

const TASK_CATEGORIES = ['Ticket', 'Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Miscellaneous'];

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SUBMISSION_STATUS = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  LEAD_APPROVED: 'Lead Approved',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION: 'Revision Required'
};

const MIN_HOURS_REQUIRED = 36;

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

const buildEntriesByDate = (entries = []) => {
  const map = {};
  entries.forEach((entry) => {
    const key = entry.date;
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(entry);
  });
  Object.values(map).forEach((list) => {
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
  });
  return map;
};

const getDefaultActivityType = (team) => {
  const teamUpper = (team || '').toUpperCase();
  if (teamUpper.includes('QA')) return 'QA';
  if (teamUpper.includes('DEV')) return 'Development';
  return ACTIVITY_TYPES[0];
};

const getPlannedActivityType = (task, fallback) => {
  const category = (task?.generic_category || '').toLowerCase();
  if (category.includes('review')) return 'Code Review';
  if (category.includes('plan')) return 'Planning';
  if (task?.source === 'qa') return 'QA';
  if (task?.source === 'dev') return 'Development';
  return fallback;
};

const getHoursColorClass = (hours) => {
  if (hours >= 8) return 'hours-full';
  if (hours >= 4) return 'hours-half';
  if (hours > 0) return 'hours-low';
  return 'hours-zero';
};

function TimeSheetModule() {
  const { user, refreshLockStatus, lockStatus } = useAuth();

  const isLead = user?.role?.includes('LEAD');
  const isManager = user?.role?.includes('MANAGER');
  const isAdmin = user?.role === 'ADMIN';
  const canApprove = isLead || isManager || isAdmin;
  const canLogTime = !!user?.employee_id;

  const [activeTab, setActiveTab] = useState('my');
  const [view, setView] = useState('weekly');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  const [timesheetData, setTimesheetData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [entryForm, setEntryForm] = useState({
    date: formatAPIDate(new Date()),
    task_category: 'Ticket',
    activity_type: getDefaultActivityType(user?.team),
    hours: '',
    ticket_id: '',
    task_description: '',
    project_name: '',
    planned_task_id: '',
    planned_task_source: '',
  });
  const [entryFormErrors, setEntryFormErrors] = useState({});
  const [plannedTasks, setPlannedTasks] = useState([]);
  const [plannedLoading, setPlannedLoading] = useState(false);
  const [addTimelogDay, setAddTimelogDay] = useState(null);
  const [monthData, setMonthData] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);

  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [approvalDetails, setApprovalDetails] = useState(null);
  const [approvalDecisions, setApprovalDecisions] = useState({});
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approvalError, setApprovalError] = useState(null);

  const [teamEmployees, setTeamEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [teamTimesheetData, setTeamTimesheetData] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);

  useEffect(() => {
    if (!canApprove && activeTab === 'approvals') {
      setActiveTab('my');
    }
  }, [canApprove, activeTab]);

  useEffect(() => {
    setWeekStart(getWeekStart(currentDate));
  }, [currentDate]);

  const fetchTimesheet = useCallback(async (dateParam, employeeId, setter, setLoadingFn, setErrorFn) => {
    if (setLoadingFn) setLoadingFn(true);
    if (setErrorFn) setErrorFn(null);
    try {
      const dateStr = dateParam ? formatAPIDate(dateParam) : formatAPIDate(new Date());
      const url = employeeId
        ? `/timesheet/week?date=${encodeURIComponent(dateStr)}&employee_id=${encodeURIComponent(employeeId)}`
        : `/timesheet/week?date=${encodeURIComponent(dateStr)}`;
      const res = await apiFetch(url);
      if (!res.ok) {
        let message = 'Failed to fetch timesheet';
        try {
          const body = await res.json();
          if (body.detail) message = typeof body.detail === 'string' ? body.detail : (body.detail.msg || message);
        } catch (_) {}
        if (res.status === 404 && (message === 'Failed to fetch timesheet' || message.toLowerCase().includes('not found'))) {
          message = 'Timesheet API not found (404). 1) Start backend: in the backend folder run "python -m uvicorn main:app --reload". 2) Restart the frontend (npm start in the frontend folder) so the proxy forwards requests. 3) Check http://localhost:8000/timesheet/health — if you see {"status":"ok"}, the API is available.';
        }
        throw new Error(message);
      }
      const data = await res.json();
      setter(data);
    } catch (err) {
      if (setErrorFn) setErrorFn(err.message || 'Failed to load timesheet');
    } finally {
      if (setLoadingFn) setLoadingFn(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    if (!canApprove) return;
    setApprovalsLoading(true);
    try {
      const res = await apiFetch('/timesheet/pending-approvals');
      if (!res.ok) throw new Error('Failed to fetch approvals');
      const data = await res.json();
      setPendingApprovals(data.pending_timesheets || []);
    } catch (err) {
      console.error('Failed to fetch pending approvals', err);
    } finally {
      setApprovalsLoading(false);
    }
  }, [canApprove]);

  const fetchEmployees = useCallback(async () => {
    if (!canApprove) return;
    try {
      const params = new URLSearchParams();
      if (user?.team && !isAdmin) {
        params.set('team', user.team);
      }
      const url = params.toString() ? `/employees?${params}` : '/employees';
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setTeamEmployees(data || []);
      if (!selectedEmployeeId && data?.length) {
        const own = data.find((e) => e.employee_id === user?.employee_id);
        setSelectedEmployeeId((own && own.employee_id) || data[0].employee_id);
      }
    } catch (err) {
      console.error('Failed to fetch employees', err);
    }
  }, [canApprove, isAdmin, selectedEmployeeId, user?.employee_id, user?.team]);

  const loadPlannedTasks = useCallback(async (dateStr) => {
    if (!dateStr) return;
    setPlannedLoading(true);
    try {
      const res = await apiFetch(`/timesheet/planned-tasks?date_str=${encodeURIComponent(dateStr)}`);
      if (!res.ok) {
        setPlannedTasks([]);
        return;
      }
      const data = await res.json();
      setPlannedTasks(data.planned_tasks || []);
    } catch (err) {
      console.error('Failed to load planned tasks', err);
    } finally {
      setPlannedLoading(false);
    }
  }, []);

  const fetchMonthData = useCallback(async () => {
    const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    setMonthLoading(true);
    try {
      const res = await apiFetch(`/timesheet/month?month=${encodeURIComponent(monthStr)}`);
      if (!res.ok) throw new Error('Failed to fetch month');
      const data = await res.json();
      setMonthData(data);
    } catch (err) {
      setMonthData(null);
    } finally {
      setMonthLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    if (!canLogTime) return;
    if (!user?.employee_id) {
      setLoading(false);
      setError('Your account is not linked to an employee profile. My Timesheet is unavailable.');
      setTimesheetData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const healthRes = await fetch(TIMESHEET_HEALTH_URL, { method: 'GET' });
        if (cancelled) return;
        if (!healthRes.ok) {
          setError(
            'Backend not running or Timesheet API missing. Start the backend: open a terminal, cd to the project\'s backend folder, then run: python -m uvicorn main:app --reload. Wait for "Application startup complete", then click Retry.'
          );
          setTimesheetData(null);
          setLoading(false);
          return;
        }
        await fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
      } catch (err) {
        if (cancelled) return;
        setError(
          'Cannot reach backend. Start it first: in the backend folder run "python -m uvicorn main:app --reload". Then click Retry.'
        );
        setTimesheetData(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canLogTime, currentDate, fetchTimesheet, user?.employee_id]);

  useEffect(() => {
    if (canApprove) {
      fetchPending();
      fetchEmployees();
    }
  }, [canApprove, fetchPending, fetchEmployees]);

  useEffect(() => {
    if (selectedEmployeeId) {
      fetchTimesheet(currentDate, selectedEmployeeId, setTeamTimesheetData, setTeamLoading, null);
    }
  }, [selectedEmployeeId, currentDate, fetchTimesheet]);

  useEffect(() => {
    if (showEntryForm && entryForm.date) {
      loadPlannedTasks(entryForm.date);
    }
  }, [showEntryForm, entryForm.date, loadPlannedTasks]);

  useEffect(() => {
    if (view === 'monthly' && canLogTime) {
      fetchMonthData();
    }
  }, [view, currentDate, canLogTime, fetchMonthData]);

  const openAddTimelog = (dayKey) => {
    setAddTimelogDay(dayKey);
    loadPlannedTasks(dayKey);
  };

  const handleAddWithPlannedTime = async (task, dateStr) => {
    const payload = {
      activity_type: getPlannedActivityType(task, getDefaultActivityType(user?.team)),
      task_category: task.category || 'Ticket',
      date: dateStr,
      hours: Number(task.hours) || 0,
      ticket_id: task.ticket_id ? String(task.ticket_id) : null,
      task_description: task.activity_description || null,
      project_name: null,
      planned_task_id: task.id,
      planned_task_source: task.source || null,
    };
    try {
      const res = await apiFetch('/timesheet/entry', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to add entry');
      }
      setAddTimelogDay(null);
      await fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
      if (view === 'monthly') fetchMonthData();
      refreshLockStatus?.();
    } catch (err) {
      setError(err.message || 'Failed to add entry');
    }
  };

  const openEntryForm = (dateValue, entry = null, plannedTask = null) => {
    const dateStr = typeof dateValue === 'string' ? dateValue : formatAPIDate(dateValue);
    const activityType = entry?.activity_type || (plannedTask && getPlannedActivityType(plannedTask, getDefaultActivityType(user?.team))) || getDefaultActivityType(user?.team);
    const category = entry?.task_category || plannedTask?.category || 'Ticket';
    setEntryForm({
      date: dateStr,
      task_category: category,
      activity_type: activityType,
      hours: entry?.hours ?? (plannedTask ? plannedTask.hours : ''),
      ticket_id: entry?.ticket_id || (plannedTask?.ticket_id ? String(plannedTask.ticket_id) : ''),
      task_description: entry?.task_description || (plannedTask?.activity_description || ''),
      project_name: entry?.project_name || '',
      planned_task_id: entry?.planned_task_id || (plannedTask ? plannedTask.id : ''),
      planned_task_source: entry?.planned_task_source || (plannedTask ? plannedTask.source : ''),
    });
    setEntryFormErrors({});
    setEditingEntry(entry);
    setShowEntryForm(true);
    setAddTimelogDay(null);
    loadPlannedTasks(dateStr);
  };

  const closeEntryForm = () => {
    setShowEntryForm(false);
    setEditingEntry(null);
    setAddTimelogDay(null);
  };

  const handlePlannedTaskChange = (value) => {
    if (!value) {
      setEntryForm((prev) => ({
        ...prev,
        planned_task_id: '',
        planned_task_source: '',
        task_category: prev.task_category || 'Ticket',
      }));
      return;
    }
    const [source, id] = value.split(':');
    const task = plannedTasks.find((t) => t.source === source && String(t.id) === id);
    if (!task) return;
    setEntryForm((prev) => ({
      ...prev,
      planned_task_id: task.id,
      planned_task_source: task.source,
      task_category: task.category || 'Ticket',
      ticket_id: task.ticket_id ? String(task.ticket_id) : '',
      task_description: task.activity_description || '',
      hours: task.hours || '',
      activity_type: getPlannedActivityType(task, prev.activity_type),
    }));
  };

  const handleSaveEntry = async () => {
    const errs = {};
    if (!entryForm.date) errs.date = 'Date is required';
    if (!entryForm.task_category) errs.task_category = 'Task category is required';
    if (entryForm.task_category === 'Ticket' && !(entryForm.ticket_id && String(entryForm.ticket_id).trim())) {
      errs.ticket_id = 'Ticket ID is required when category is Ticket';
    }
    if (!entryForm.activity_type) errs.activity_type = 'Activity type is required';
    if (entryForm.hours === '' || entryForm.hours == null) errs.hours = 'Hours spent is required';
    else if (Number(entryForm.hours) <= 0) errs.hours = 'Hours must be greater than 0';
    if (!entryForm.task_description?.trim() && !entryForm.ticket_id) errs.task_description = 'Task description or Ticket ID is required';
    setEntryFormErrors(errs);
    if (Object.keys(errs).length) return;

    const payload = {
      activity_type: entryForm.activity_type,
      task_category: entryForm.task_category,
      date: entryForm.date,
      hours: Number(entryForm.hours),
      ticket_id: entryForm.ticket_id?.trim() || null,
      task_description: entryForm.task_description?.trim() || null,
      project_name: entryForm.project_name?.trim() || null,
      planned_task_id: entryForm.planned_task_id ? Number(entryForm.planned_task_id) : null,
      planned_task_source: entryForm.planned_task_source || null,
    };
    try {
      const res = await apiFetch(editingEntry ? `/timesheet/entry/${editingEntry.id}` : '/timesheet/entry', {
        method: editingEntry ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save entry');
      }
      closeEntryForm();
      await fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
      if (view === 'monthly') fetchMonthData();
      refreshLockStatus?.();
    } catch (err) {
      setError(err.message || 'Failed to save entry');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    try {
      const res = await apiFetch(`/timesheet/entry/${entryId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to delete entry');
      }
      await fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
      refreshLockStatus?.();
    } catch (err) {
      setError(err.message || 'Failed to delete entry');
    }
  };

  const handleSubmitTimesheet = async () => {
    if (!timesheetData) return;
    const total = (timesheetData.hours_logged || 0) + (timesheetData.leave_hours || 0);
    if (total < MIN_HOURS_REQUIRED) {
      setError(`Cannot submit: total hours (${total.toFixed(1)}) is less than required ${MIN_HOURS_REQUIRED} hours`);
      return;
    }
    try {
      const res = await apiFetch('/timesheet/submit', {
        method: 'POST',
        body: JSON.stringify({ week_ending: weekDays[6].toISOString().slice(0, 10) })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Submit failed');
      }
      await fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
      refreshLockStatus?.();
    } catch (err) {
      setError(err.message || 'Failed to submit timesheet');
    }
  };

  const handleSelectSubmission = async (submissionId) => {
    setSelectedSubmissionId(submissionId);
    setApprovalError(null);
    setApprovalNotes('');
    try {
      const res = await apiFetch(`/timesheet/submission/${submissionId}`);
      if (!res.ok) throw new Error('Failed to fetch submission');
      const data = await res.json();
      setApprovalDetails(data);
      const decisions = {};
      (data.entries || []).forEach((entry) => {
        const key = `${entry.source}:${entry.id}`;
        const reviewStatus = entry.review_status === 'revision_required' ? 'revision_required' : 'approved';
        decisions[key] = {
          entry_source: entry.source,
          entry_id: entry.id,
          decision: reviewStatus,
          productive_hours: entry.review_productive_hours ?? entry.productive_hours ?? entry.hours,
          notes: entry.review_notes || '',
        };
      });
      setApprovalDecisions(decisions);
    } catch (err) {
      setApprovalError(err.message || 'Failed to load submission');
    }
  };

  const updateApprovalDecision = (key, updates) => {
    setApprovalDecisions((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
      },
    }));
  };

  const buildEntryReviews = (decision) => {
    return Object.values(approvalDecisions)
      .filter((item) => item.decision === decision)
      .map((item) => ({
        entry_source: item.entry_source,
        entry_id: item.entry_id,
        status: decision,
        productive_hours: decision === 'approved' ? Number(item.productive_hours || 0) : null,
        notes: item.notes || null,
      }));
  };

  const handleApproveSubmission = async () => {
    if (!approvalDetails?.submission?.id) return;
    const hasRevision = Object.values(approvalDecisions).some((item) => item.decision === 'revision_required');
    if (hasRevision) {
      setApprovalError('Remove revision flags before approving.');
      return;
    }
    try {
      const res = await apiFetch(`/timesheet/approve/${approvalDetails.submission.id}`, {
        method: 'POST',
        body: JSON.stringify({
          notes: approvalNotes || null,
          entry_reviews: buildEntryReviews('approved'),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Approve failed');
      }
      setApprovalDetails(null);
      setSelectedSubmissionId(null);
      await fetchPending();
      refreshLockStatus?.();
    } catch (err) {
      setApprovalError(err.message || 'Failed to approve submission');
    }
  };

  const handleRequestRevision = async () => {
    if (!approvalDetails?.submission?.id) return;
    const revisions = buildEntryReviews('revision_required');
    if (!revisions.length) {
      setApprovalError('Select at least one entry for revision.');
      return;
    }
    try {
      const res = await apiFetch(`/timesheet/request-revision/${approvalDetails.submission.id}`, {
        method: 'POST',
        body: JSON.stringify({
          notes: approvalNotes || null,
          entry_reviews: revisions,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Revision request failed');
      }
      setApprovalDetails(null);
      setSelectedSubmissionId(null);
      await fetchPending();
      refreshLockStatus?.();
    } catch (err) {
      setApprovalError(err.message || 'Failed to request revision');
    }
  };

  const handleRejectSubmission = async () => {
    if (!approvalDetails?.submission?.id) return;
    try {
      const res = await apiFetch(`/timesheet/reject/${approvalDetails.submission.id}`, {
        method: 'POST',
        body: JSON.stringify({ notes: approvalNotes || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Reject failed');
      }
      setApprovalDetails(null);
      setSelectedSubmissionId(null);
      await fetchPending();
      refreshLockStatus?.();
    } catch (err) {
      setApprovalError(err.message || 'Failed to reject submission');
    }
  };

  const goToPreviousWeek = () => {
    const newDate = new Date(weekStart);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };
  const goToNextWeek = () => {
    const newDate = new Date(weekStart);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };
  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleRetry = () => {
    setError(null);
    if (canLogTime && user?.employee_id) {
      fetchTimesheet(currentDate, null, setTimesheetData, setLoading, setError);
    }
    if (view === 'monthly' && canLogTime) fetchMonthData();
  };

  const entriesByDate = useMemo(() => buildEntriesByDate(timesheetData?.entries || []), [timesheetData]);

  const dailyTotals = useMemo(() => {
    return weekDays.map((day) => {
      const dateKey = formatAPIDate(day);
      const entries = entriesByDate[dateKey] || [];
      const total = entries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
      return { date: dateKey, total, entries };
    });
  }, [entriesByDate, weekDays]);

  const submissionStatus = timesheetData?.submission?.status;
  const canEditEntries = !submissionStatus || [SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.REVISION].includes(submissionStatus);
  const canSubmitTimesheet = !submissionStatus || [SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.REVISION].includes(submissionStatus);

  const plannedTaskValue = entryForm.planned_task_id && entryForm.planned_task_source
    ? `${entryForm.planned_task_source}:${entryForm.planned_task_id}`
    : '';

  const renderEntryList = (entries, allowActions = canEditEntries) => {
    if (!entries.length) {
      return <div className="timesheet-empty">No entries yet.</div>;
    }
    return entries.map((entry) => {
      const productive = entry.review_productive_hours ?? entry.productive_hours;
      return (
        <div key={`${entry.source}-${entry.id}`} className="timesheet-entry">
          <div className="entry-main">
            <div className="entry-title">
              <span className="entry-hours">{(entry.hours || 0).toFixed(1)}h</span>
              <span className="entry-activity">{entry.activity_type}</span>
              {entry.ticket_id && <TicketExternalLink ticketId={entry.ticket_id} />}
            </div>
            <div className="entry-desc">{entry.task_description || entry.project_name || entry.ticket_id || 'No description'}</div>
            {entry.project_name && <div className="entry-project">{entry.project_name}</div>}
            {entry.review_notes && <div className="entry-review-note">Revision note: {entry.review_notes}</div>}
          </div>
          <div className="entry-meta">
            <span className={`entry-source ${entry.source}`}>{entry.source === 'manual' ? 'Manual' : 'Synced'}</span>
            {productive !== null && productive !== undefined && (
              <span className="entry-productive">Productive: {Number(productive).toFixed(1)}h</span>
            )}
            {entry.review_status && (
              <span className={`entry-review ${entry.review_status.replace(' ', '-')}`}>
                {entry.review_status.replace('_', ' ')}
              </span>
            )}
          </div>
          {allowActions && entry.source === 'manual' && (
            <div className="entry-actions">
              <button className="btn btn-secondary" onClick={() => openEntryForm(entry.date, entry)}>Edit</button>
              <button className="btn btn-ghost" onClick={() => handleDeleteEntry(entry.id)}>Delete</button>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="calendar-module timesheet-module">
      <aside className="sidebar">
        <div className="logo-section">
          <img src="/techversant-logo.png" alt="Techversant" className="company-logo" />
          <div className="logo-text">
            <span className="logo-title">QA Dashboard</span>
            <span className="logo-subtitle">TimeSheet</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <Link to="/" className="nav-item">
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </Link>
          <Link to="/tickets" className="nav-item">
            <span className="nav-icon">🎫</span>
            <span>Tickets</span>
          </Link>
          <Link to="/all-bugs" className="nav-item">
            <span className="nav-icon">🐛</span>
            <span>All Bugs</span>
          </Link>
          {(user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD')) && (
            <Link to="/employees" className="nav-item">
              <span className="nav-icon">👥</span>
              <span>Employees</span>
            </Link>
          )}
          <Link to="/calendar" className="nav-item">
            <span className="nav-icon">📅</span>
            <span>Calendar</span>
          </Link>
          <Link to="/timesheet" className="nav-item active">
            <span className="nav-icon">⏱</span>
            <span>TimeSheet</span>
          </Link>
          <Link to="/reports" className="nav-item">
            <span className="nav-icon">📈</span>
            <span>Reports</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <Link to="/" className="nav-item">
            <span className="nav-icon">←</span>
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div className="header-title">
            <h1>⏱ Team Timesheet</h1>
            <p>View daily time entries and log your time</p>
          </div>
          <div className="header-actions">
            {canLogTime && (
              <>
                <button
                  type="button"
                  className="sync-btn"
                  onClick={() => openEntryForm(formatAPIDate(currentDate))}
                  disabled={!canEditEntries}
                >
                  + Add Entry
                </button>
                <button
                  type="button"
                  className="sync-btn start"
                  onClick={handleSubmitTimesheet}
                  disabled={!canSubmitTimesheet}
                >
                  ✓ Submit Timesheet
                </button>
              </>
            )}
            {submissionStatus && (
              <div className="sync-info">
                <span className="sync-text">Status: <strong>{submissionStatus}</strong></span>
              </div>
            )}
          </div>
        </header>

        {lockStatus?.locked && (
          <div className="timesheet-lock-banner">
            {lockStatus.message || 'Timesheet action required before continuing.'}
          </div>
        )}

        <div className="timesheet-tabs-row">
          <button className={`toggle-btn ${activeTab === 'my' ? 'active' : ''}`} onClick={() => setActiveTab('my')}>My Timesheet</button>
          {canApprove && (
            <button className={`toggle-btn ${activeTab === 'approvals' ? 'active' : ''}`} onClick={() => setActiveTab('approvals')}>Approvals</button>
          )}
        </div>

        {activeTab === 'my' && (
          <>
            <div className="calendar-controls">
              <div className="control-group">
                <div className="view-toggle">
                  <button className={`toggle-btn ${view === 'weekly' ? 'active' : ''}`} onClick={() => setView('weekly')}>Weekly</button>
                  <button className={`toggle-btn ${view === 'monthly' ? 'active' : ''}`} onClick={() => setView('monthly')}>Monthly</button>
                </div>
              </div>
              <div className="date-navigation">
                {view === 'monthly' ? (
                  <>
                    <select
                      className="month-select"
                      value={currentDate.getMonth()}
                      onChange={(e) => { const d = new Date(currentDate); d.setMonth(parseInt(e.target.value)); setCurrentDate(d); }}
                    >
                      {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
                    </select>
                    <select
                      className="year-select"
                      value={currentDate.getFullYear()}
                      onChange={(e) => { const d = new Date(currentDate); d.setFullYear(parseInt(e.target.value)); setCurrentDate(d); }}
                    >
                      {[currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <button className="today-btn" onClick={goToToday}>Today</button>
                  </>
                ) : (
                  <>
                    <button className="nav-btn" onClick={goToPreviousWeek}>←</button>
                    <button className="today-btn" onClick={goToToday}>Today</button>
                    <span className="current-period">{formatDateRange(weekDays[0], weekDays[6])}</span>
                    <button className="nav-btn" onClick={goToNextWeek}>→</button>
                  </>
                )}
              </div>
            </div>

            <div className="calendar-content">
              {loading && (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Loading timesheet…</p>
                </div>
              )}
              {error && (
                <div className="error-state">
                  <p>⚠️ {error}</p>
                  <button type="button" className="sync-btn" onClick={handleRetry}>Retry</button>
                </div>
              )}
              {!loading && !error && timesheetData && view === 'weekly' && (
                <div className="calendar-weekly">
                  <table className="calendar-table">
                    <thead>
                      <tr>
                        <th className="employee-col">Employee</th>
                        {weekDays.map((day, idx) => {
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                          return (
                            <th key={idx} className={`day-header ${isWeekend ? 'weekend' : ''}`}>
                              <div className="day-name">{DAY_NAMES[idx]}</div>
                              <div className="day-date">{day.getDate()}</div>
                              <div className="day-month">{MONTH_NAMES[day.getMonth()].slice(0, 3)}</div>
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
                            <span className="employee-name">{user?.name || 'Me'}</span>
                            {user?.team && <span className="employee-team">{user.team}</span>}
                          </div>
                        </td>
                        {weekDays.map((day, idx) => {
                          const dateKey = formatAPIDate(day);
                          const dayEntries = entriesByDate[dateKey] || [];
                          const dayTotal = dailyTotals.find((d) => d.date === dateKey);
                          const totalH = dayTotal?.total ?? 0;
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const dayDate = new Date(day);
                          dayDate.setHours(0, 0, 0, 0);
                          const isPast = dayDate < today;
                          const showNoEntry = isPast && !isWeekend && dayEntries.length === 0;
                          return (
                            <td
                              key={idx}
                              className={`day-cell ${isWeekend ? 'weekend' : ''} ${showNoEntry ? 'no-entry-past' : ''}`}
                              onClick={() => canEditEntries && openAddTimelog(dateKey)}
                              title={showNoEntry ? 'No time entry for this date' : ''}
                            >
                              {showNoEntry && (
                                <div className="no-entry-indicator" title="No time entry for this past date">
                                  <span className="no-entry-icon">!</span>
                                </div>
                              )}
                              {dayEntries.length > 0 && (
                                <div className="day-entries">
                                  {dayEntries.slice(0, 3).map((entry) => {
                                    const isTicket = entry.ticket_id && /^\d+$/.test(String(entry.ticket_id));
                                    return (
                                      <div key={`${entry.source}-${entry.id}`} className={`entry-ticket ${isTicket ? 'clickable-ticket' : ''}`} title={entry.task_description || entry.ticket_id}>
                                        {isTicket ? (
                                          <div className="ticket-actions">
                                            <Link to={`/tickets?ticket=${entry.ticket_id}`} className="ticket-id ticket-link" onClick={(e) => e.stopPropagation()}>#{entry.ticket_id}</Link>
                                            <TicketExternalLink ticketId={entry.ticket_id} />
                                          </div>
                                        ) : (
                                          <span className="ticket-id">{(entry.task_description || entry.activity_type || 'Task').slice(0, 14)}</span>
                                        )}
                                        <span className="ticket-hours">{parseFloat(entry.hours || 0).toFixed(1)}h</span>
                                      </div>
                                    );
                                  })}
                                  {dayEntries.length > 3 && <div className="more-entries">+{dayEntries.length - 3} more</div>}
                                </div>
                              )}
                              <div className={`day-total ${getHoursColorClass(totalH)}`}>
                                <strong>{totalH > 0 ? `${totalH.toFixed(1)}h` : '-'}</strong>
                              </div>
                              {canEditEntries && (
                                <button type="button" className="add-timelog-btn" onClick={(e) => { e.stopPropagation(); openAddTimelog(dateKey); }}>
                                  Add timelog
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className={`total-cell ${getHoursColorClass(((timesheetData.hours_logged || 0) + (timesheetData.leave_hours || 0)) / 5)}`}>
                          <strong>{(timesheetData.hours_logged || 0) + (timesheetData.leave_hours || 0)}h</strong>
                          <div className="weekly-avg">Avg: {(((timesheetData.hours_logged || 0) + (timesheetData.leave_hours || 0)) / 5).toFixed(1)}h/day</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {view === 'monthly' && (
                <>
                  {monthLoading && (
                    <div className="loading-state">
                      <div className="spinner"></div>
                      <p>Loading month…</p>
                    </div>
                  )}
                  {!monthLoading && monthData && (
                    <div className="calendar-monthly">
                      <div className="monthly-summary">
                        <div className="summary-card">
                          <span className="summary-label">Total hours this month</span>
                          <span className="summary-value">
                            {Object.values(monthData.days || {}).reduce((sum, d) => sum + (d.total_hours || 0) + (d.leave_hours || 0), 0).toFixed(1)}h
                          </span>
                        </div>
                        <div className="summary-card">
                          <span className="summary-label">Days with entries</span>
                          <span className="summary-value">
                            {Object.values(monthData.days || {}).filter((d) => (d.total_hours || 0) + (d.leave_hours || 0) > 0).length}
                          </span>
                        </div>
                        <div className="summary-card">
                          <span className="summary-label">Status</span>
                          <span className="summary-value">{submissionStatus || 'Draft'}</span>
                        </div>
                      </div>
                      <div className="timesheet-calendar-monthly">
                        <div className="monthly-grid-header">
                          {DAY_NAMES.map((d) => (
                            <div key={d} className="monthly-day-name">{d}</div>
                          ))}
                        </div>
                        <div className="monthly-grid-body">
                          {(() => {
                            const firstDay = new Date(monthData.month_start + 'T12:00:00');
                            const startPadding = (firstDay.getDay() + 6) % 7;
                            const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
                            const cells = [];
                            for (let i = 0; i < startPadding; i++) cells.push(<div key={`p-${i}`} className="monthly-cell empty" />);
                            for (let d = 1; d <= daysInMonth; d++) {
                              const dateStr = `${monthData.month}-${String(d).padStart(2, '0')}`;
                              const dayData = monthData.days?.[dateStr];
                              const total = (dayData?.total_hours || 0) + (dayData?.leave_hours || 0);
                              const entries = dayData?.entries || [];
                              cells.push(
                                <div
                                  key={dateStr}
                                  className={`monthly-cell ${getHoursColorClass(total)}`}
                                  onClick={() => canEditEntries && openAddTimelog(dateStr)}
                                >
                                  <div className="monthly-cell-date">{d}</div>
                                  <div className="monthly-cell-total">{total > 0 ? `${total.toFixed(1)}h` : '-'}</div>
                                  {entries.length > 0 && (
                                    <div className="monthly-cell-entries">
                                      {entries.slice(0, 2).map((e) => (
                                        <span key={`${e.source}-${e.id}`} className="mini">{e.ticket_id ? `#${e.ticket_id}` : '·'}</span>
                                      ))}
                                    </div>
                                  )}
                                  {canEditEntries && (
                                    <button type="button" className="add-timelog-btn monthly" onClick={(e) => { e.stopPropagation(); openAddTimelog(dateStr); }}>+</button>
                                  )}
                                </div>
                              );
                            }
                            return cells;
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              {!loading && !error && view === 'weekly' && timesheetData && (
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
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'approvals' && (
          <div className="timesheet-approvals">
            <div className="approval-column">
              <h3>Pending approvals</h3>
              {approvalsLoading && <div className="loading-state">Loading approvals...</div>}
              {!approvalsLoading && pendingApprovals.length === 0 && (
                <div className="timesheet-empty">No pending approvals.</div>
              )}
              {!approvalsLoading && pendingApprovals.map((item) => (
                <button
                  key={item.id}
                  className={`approval-card ${selectedSubmissionId === item.id ? 'active' : ''}`}
                  onClick={() => handleSelectSubmission(item.id)}
                >
                  <div className="approval-card-title">{item.employee_name}</div>
                  <div className="approval-card-subtitle">{item.week_start} → {item.week_end}</div>
                  <div className="approval-card-meta">{item.total_hours}h • {item.status}</div>
                </button>
              ))}
            </div>

            <div className="approval-detail">
              {approvalError && <div className="error-message">{approvalError}</div>}
              {!approvalDetails && <div className="timesheet-empty">Select a submission to review.</div>}
              {approvalDetails && (
                <>
                  <div className="approval-header">
                    <div>
                      <h3>{approvalDetails.submission.employee_name}</h3>
                      <div className="approval-subtitle">{approvalDetails.submission.week_start} → {approvalDetails.submission.week_end}</div>
                    </div>
                    <div className="approval-status">{approvalDetails.submission.status}</div>
                  </div>

                  <div className="approval-entries">
                    {(approvalDetails.entries || []).map((entry) => {
                      const key = `${entry.source}:${entry.id}`;
                      const decision = approvalDecisions[key] || {};
                      return (
                        <div key={key} className="approval-entry">
                          <div className="approval-entry-main">
                            <div className="entry-title">
                              <span className="entry-hours">{(entry.hours || 0).toFixed(1)}h</span>
                              <span className="entry-activity">{entry.activity_type}</span>
                              {entry.ticket_id && <TicketExternalLink ticketId={entry.ticket_id} />}
                            </div>
                            <div className="entry-desc">{entry.task_description || entry.project_name || entry.ticket_id || 'No description'}</div>
                            <div className="entry-meta">
                              <span className={`entry-source ${entry.source}`}>{entry.source === 'manual' ? 'Manual' : 'Synced'}</span>
                            </div>
                          </div>
                          <div className="approval-entry-actions">
                            <label>
                              Decision
                              <select
                                value={decision.decision || 'approved'}
                                onChange={(e) => updateApprovalDecision(key, { decision: e.target.value })}
                              >
                                <option value="approved">Productive</option>
                                <option value="revision_required">Needs Revision</option>
                              </select>
                            </label>
                            <label>
                              Productive hours
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={decision.productive_hours ?? entry.hours}
                                onChange={(e) => updateApprovalDecision(key, { productive_hours: e.target.value })}
                                disabled={(decision.decision || 'approved') !== 'approved'}
                              />
                            </label>
                            {(decision.decision || 'approved') === 'revision_required' && (
                              <label>
                                Revision note
                                <input
                                  type="text"
                                  value={decision.notes || ''}
                                  onChange={(e) => updateApprovalDecision(key, { notes: e.target.value })}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="approval-actions">
                    <label className="approval-notes">
                      Notes (optional)
                      <textarea
                        value={approvalNotes}
                        onChange={(e) => setApprovalNotes(e.target.value)}
                        rows={3}
                      />
                    </label>
                    <div className="approval-buttons">
                      <button className="btn btn-primary" onClick={handleApproveSubmission}>Approve</button>
                      <button className="btn btn-secondary" onClick={handleRequestRevision}>Request Revision</button>
                      <button className="btn btn-ghost" onClick={handleRejectSubmission}>Reject</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="team-timesheet">
            <h3>Team timesheet view</h3>
            <div className="team-timesheet-controls">
              <label>
                Employee
                <select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
                  <option value="">Select employee</option>
                  {teamEmployees.map((emp) => (
                    <option key={emp.employee_id} value={emp.employee_id}>
                      {emp.name} ({emp.employee_id})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {teamLoading && <div className="loading-state">Loading team timesheet...</div>}
            {!teamLoading && teamTimesheetData && (
              <div className="team-timesheet-summary">
                <div className="hour-progress">
                  <strong>{teamTimesheetData.total_hours}h</strong>
                  {teamTimesheetData.submission?.status && (
                    <span className="submission-status">Status: {teamTimesheetData.submission.status}</span>
                  )}
                </div>
                <div className="entries-section">
                  {renderEntryList(teamTimesheetData.entries || [], false)}
                </div>
              </div>
            )}
          </div>
        )}

        {addTimelogDay && !showEntryForm && (
          <div className="timesheet-modal-overlay" onClick={() => setAddTimelogDay(null)}>
            <div className="timesheet-modal add-timelog-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Add timelog – {formatDisplayDateWithDay(addTimelogDay)}</h3>
              {plannedLoading && <div className="loading-state">Loading planned tasks…</div>}
              {!plannedLoading && plannedTasks.length > 0 && (
                <div className="planned-tasks-quick">
                  <p className="label">Assigned tasks for this day</p>
                  {plannedTasks.map((task) => (
                    <div key={`${task.source}-${task.id}`} className="planned-task-row">
                      <span className="task-info">
                        {task.ticket_id ? `#${task.ticket_id}` : task.category} • {(task.activity_description || '').slice(0, 40)} • {task.hours}h
                      </span>
                      <div className="task-actions">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAddWithPlannedTime(task, addTimelogDay)}>
                          Add with planned time
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { openEntryForm(addTimelogDay, null, task); }}>
                          Add with different time
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="add-new-task-row">
                <button type="button" className="btn btn-primary" onClick={() => openEntryForm(addTimelogDay)}>
                  Add new task
                </button>
              </div>
              <div className="timesheet-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setAddTimelogDay(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showEntryForm && (
          <div className="timesheet-modal-overlay" onClick={closeEntryForm}>
            <div className="timesheet-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{editingEntry ? 'Edit time entry' : 'Add time entry'}</h3>
              <div className="timesheet-form">
                <label>
                  Task category *
                  <select
                    value={entryForm.task_category || 'Ticket'}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, task_category: e.target.value, ticket_id: e.target.value !== 'Ticket' ? '' : prev.ticket_id }))}
                  >
                    {TASK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {entryFormErrors.task_category && <span className="form-error">{entryFormErrors.task_category}</span>}
                </label>
                {entryForm.task_category === 'Ticket' && (
                  <label>
                    Ticket ID *
                    <input
                      type="text"
                      value={entryForm.ticket_id}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, ticket_id: e.target.value }))}
                      placeholder="e.g. 12345"
                    />
                    {entryFormErrors.ticket_id && <span className="form-error">{entryFormErrors.ticket_id}</span>}
                  </label>
                )}
                <label>
                  Activity type *
                  <select
                    value={entryForm.activity_type}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, activity_type: e.target.value }))}
                  >
                    {ACTIVITY_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  {entryFormErrors.activity_type && <span className="form-error">{entryFormErrors.activity_type}</span>}
                </label>
                <label>
                  Planned task (optional)
                  <select
                    value={plannedTaskValue}
                    onChange={(e) => handlePlannedTaskChange(e.target.value)}
                  >
                    <option value="">Add new task</option>
                    {plannedTasks.map((task) => (
                      <option key={`${task.source}-${task.id}`} value={`${task.source}:${task.id}`}>
                        {task.ticket_id ? `#${task.ticket_id}` : task.category} • {(task.activity_description || '').slice(0, 30)} ({task.hours}h)
                      </option>
                    ))}
                  </select>
                </label>
                {plannedLoading && <div className="loading-state">Loading planned tasks…</div>}
                <label>
                  Task description *
                  <input
                    type="text"
                    value={entryForm.task_description}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, task_description: e.target.value }))}
                    placeholder="What was done?"
                  />
                  {entryFormErrors.task_description && <span className="form-error">{entryFormErrors.task_description}</span>}
                </label>
                <label>
                  Date *
                  <input
                    type="date"
                    value={entryForm.date}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, date: e.target.value }))}
                  />
                  {entryFormErrors.date && <span className="form-error">{entryFormErrors.date}</span>}
                </label>
                <label>
                  Hours spent *
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={entryForm.hours}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, hours: e.target.value }))}
                  />
                  {entryFormErrors.hours && <span className="form-error">{entryFormErrors.hours}</span>}
                </label>
                <label>
                  Project name (optional)
                  <input
                    type="text"
                    value={entryForm.project_name}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, project_name: e.target.value }))}
                  />
                </label>
              </div>
              <div className="timesheet-modal-actions">
                <button className="btn btn-primary" onClick={handleSaveEntry}>Save</button>
                <button className="btn btn-ghost" onClick={closeEntryForm}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default TimeSheetModule;
