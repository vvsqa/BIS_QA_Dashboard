import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatAPIDate, formatDateRange } from './dateUtils';
import { TicketExternalLink } from './ticketUtils';
import { useTableSort, SortableHeader } from './useTableSort';
import AppSidebar from './AppSidebar';
import './CalendarModule.css';
import './TimeSheetModule.css';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';

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

const ACTIVITY_TYPES = [
  'Development',
  'QA',
  'Code Review',
  'Planning',
  'Support',
  'Other'
];

const TASK_CATEGORIES = ['Ticket', 'Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Half Day Leave', 'Miscellaneous'];

const VARIANCE_REASON_TYPES = [
  { value: '', label: '— Select reason (optional) —' },
  { value: 'unplanned_task', label: 'Unplanned task' },
  { value: 'estimate_ineffective', label: 'Estimate wasn\'t effective' },
  { value: 'other', label: 'Other' },
];

const toOptionalTrimmedString = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
};

function TimeSheetModule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // State
  const [team, setTeam] = useState('QA'); // 'QA' or 'DEVELOPMENT'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [timesheetData, setTimesheetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Entry form state
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [entryForm, setEntryForm] = useState({
    date: formatAPIDate(new Date()),
    task_category: 'Ticket',
    activity_type: 'QA',
    hours: '',
    ticket_id: '',
    task_description: '',
    project_name: '',
  });
  const [entryFormErrors, setEntryFormErrors] = useState({});
  // Planned tasks for add-log modal (for selected date + employee)
  const [plannedTasksForDay, setPlannedTasksForDay] = useState([]);
  const [loadingPlannedTasks, setLoadingPlannedTasks] = useState(false);
  // "Add with my time" sub-form (one planned task at a time)
  const [addWithMyTimeTask, setAddWithMyTimeTask] = useState(null);
  const [addWithMyTimeHours, setAddWithMyTimeHours] = useState('');
  const [addWithMyTimeVarianceNotes, setAddWithMyTimeVarianceNotes] = useState('');
  const [addWithMyTimeReasonType, setAddWithMyTimeReasonType] = useState('');
  const [addWithMyTimeError, setAddWithMyTimeError] = useState('');
  // My submissions (for submit button and My submissions tab)
  const [mySubmissions, setMySubmissions] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // Tab: 'log' | 'submissions'
  const [activeTab, setActiveTab] = useState('log');
  // My submissions detail (read-only)
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [submissionDetail, setSubmissionDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // My week summary (for 40h rule and summary when viewing current week)
  const [myWeekSummary, setMyWeekSummary] = useState(null);
  // Plan vs actual tab
  const [planVsActualTeam, setPlanVsActualTeam] = useState('QA');
  const [planVsActualWeekStart, setPlanVsActualWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d);
    mon.setDate(diff);
    return mon.toISOString().slice(0, 10);
  });
  const [planVsActualData, setPlanVsActualData] = useState(null);
  const [planVsActualLoading, setPlanVsActualLoading] = useState(false);
  // Timesheet Approvals (for leads/managers)
  const canApproveTimesheets = user?.role === 'ADMIN' || (user?.role && (user.role.includes('MANAGER') || user.role.includes('LEAD')));
  const [activeApprovalsSubTab, setActiveApprovalsSubTab] = useState('pending'); // 'pending' | 'completed'
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [completedApprovals, setCompletedApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalsTeam, setApprovalsTeam] = useState(team);
  const [selectedApprovalSubmissionId, setSelectedApprovalSubmissionId] = useState(null);
  const [approvalDetail, setApprovalDetail] = useState(null);
  const [approvalDetailLoading, setApprovalDetailLoading] = useState(false);
  const [approvalActionLoading, setApprovalActionLoading] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approvalEntryReviews, setApprovalEntryReviews] = useState({}); // { "manual-123": "approved" | "rejected" | "revision_required" }
  const [approvalProductiveHours, setApprovalProductiveHours] = useState({}); // { "manual-123": "7.5" }
  const [selectedApprovalIds, setSelectedApprovalIds] = useState([]);
  const [bulkApprovalActionLoading, setBulkApprovalActionLoading] = useState(false);
  const [managerSummaryPeriod, setManagerSummaryPeriod] = useState('week');
  const [managerSummary, setManagerSummary] = useState(null);
  const [managerSummaryLoading, setManagerSummaryLoading] = useState(false);

  const approvalsList = activeApprovalsSubTab === 'pending' ? pendingApprovals : completedApprovals;
  const { sortedData: sortedApprovalsList, sortConfig: approvalsSortConfig, handleSort: handleApprovalsSort } = useTableSort(approvalsList, { defaultSortKey: 'submitted_on', defaultSortDirection: 'desc' });
  const { sortedData: sortedMySubmissions, sortConfig: mySubmissionsSortConfig, handleSort: handleMySubmissionsSort } = useTableSort(mySubmissions, { defaultSortKey: 'week_start', defaultSortDirection: 'desc' });
  const approvalEntries = approvalDetail?.entries || [];
  const { sortedData: sortedApprovalEntries, sortConfig: approvalEntriesSortConfig, handleSort: handleApprovalEntriesSort } = useTableSort(approvalEntries, { defaultSortKey: 'date', defaultSortDirection: 'asc' });
  const submissionEntries = submissionDetail?.entries || [];
  const { sortedData: sortedSubmissionEntries, sortConfig: submissionEntriesSortConfig, handleSort: handleSubmissionEntriesSort } = useTableSort(submissionEntries, { defaultSortKey: 'date', defaultSortDirection: 'asc' });

  // Calculate week boundaries
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Fetch team timesheet data
  const fetchTimesheetData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const dateStr = formatAPIDate(currentDate);
      const url = `/timesheet/team-weekly?team=${team}&date_str=${dateStr}`;
      
      const response = await apiFetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch timesheet data: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      setTimesheetData(data);
      // Keep team in sync when non-manager gets their actual team from backend
      if (data.viewer_can_see_all === false && data.team && data.team !== team) {
        setTeam(data.team);
      }
    } catch (err) {
      const isNetworkError = err.name === 'TypeError' && (err.message === 'Failed to fetch' || err.message.includes('fetch'));
      setError(isNetworkError
        ? 'Cannot connect to the backend. Please ensure the server is running.'
        : (err.message || 'Failed to load timesheet data'));
    } finally {
      setLoading(false);
    }
  }, [team, currentDate]);

  useEffect(() => {
    fetchTimesheetData();
  }, [fetchTimesheetData]);

  // Fetch planned tasks when add-log modal opens (for this date + employee)
  useEffect(() => {
    if (!showEntryForm || editingEntry || !entryForm.date || !selectedEmployeeId) {
      setPlannedTasksForDay([]);
      return;
    }
    let cancelled = false;
    setLoadingPlannedTasks(true);
    const url = `/timesheet/planned-tasks?date_str=${encodeURIComponent(entryForm.date)}&employee_id=${encodeURIComponent(selectedEmployeeId)}`;
    apiFetch(url)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to load planned tasks')))
      .then((data) => {
        if (!cancelled) setPlannedTasksForDay(data.planned_tasks || []);
      })
      .catch(() => {
        if (!cancelled) setPlannedTasksForDay([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlannedTasks(false);
      });
    return () => { cancelled = true; };
  }, [showEntryForm, editingEntry, entryForm.date, selectedEmployeeId]);

  // Fetch my submissions (for submit button state and My submissions tab)
  const fetchMySubmissions = useCallback(async () => {
    if (!user?.employee_id) return;
    try {
      const res = await apiFetch('/timesheet/my-submissions');
      if (res.ok) {
        const data = await res.json();
        setMySubmissions(Array.isArray(data) ? data : []);
      }
    } catch {
      setMySubmissions([]);
    }
  }, [user?.employee_id]);

  useEffect(() => {
    fetchMySubmissions();
  }, [fetchMySubmissions]);

  // Fetch my week summary when viewing current week (for 40h check and summary)
  useEffect(() => {
    if (!user?.employee_id || activeTab !== 'log') {
      setMyWeekSummary(null);
      return;
    }
    const dateStr = formatAPIDate(weekStart);
    let cancelled = false;
    apiFetch(`/timesheet/my-week-summary?date_str=${encodeURIComponent(dateStr)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setMyWeekSummary(data); })
      .catch(() => { if (!cancelled) setMyWeekSummary(null); });
    return () => { cancelled = true; };
  }, [user?.employee_id, activeTab, weekStart]);

  // Fetch plan-vs-actual when tab is active
  useEffect(() => {
    if (activeTab !== 'plan-vs-actual' || !planVsActualWeekStart) return;
    let cancelled = false;
    setPlanVsActualLoading(true);
    const teamParam = planVsActualTeam === 'DEVELOPMENT' ? 'dev' : 'qa';
    apiFetch(`/planning/comparison/planning?team=${teamParam}&week_start=${encodeURIComponent(planVsActualWeekStart)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setPlanVsActualData(data); })
      .catch(() => { if (!cancelled) setPlanVsActualData(null); })
      .finally(() => { if (!cancelled) setPlanVsActualLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, planVsActualTeam, planVsActualWeekStart]);

  // Fetch pending/completed approvals when on Approvals tab
  const fetchPendingApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const url = approvalsTeam ? `/timesheet/pending-approvals?team=${encodeURIComponent(approvalsTeam)}` : '/timesheet/pending-approvals';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load pending approvals');
      const data = await res.json();
      setPendingApprovals(data.pending_timesheets || []);
    } catch {
      setPendingApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  }, [approvalsTeam]);

  const fetchCompletedApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const url = approvalsTeam ? `/timesheet/completed-approvals?team=${encodeURIComponent(approvalsTeam)}` : '/timesheet/completed-approvals';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load completed approvals');
      const data = await res.json();
      setCompletedApprovals(data.completed_timesheets || []);
    } catch {
      setCompletedApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  }, [approvalsTeam]);

  useEffect(() => {
    if (!canApproveTimesheets || activeTab !== 'approvals') return;
    if (activeApprovalsSubTab === 'pending') fetchPendingApprovals();
    else fetchCompletedApprovals();
  }, [canApproveTimesheets, activeTab, activeApprovalsSubTab, fetchPendingApprovals, fetchCompletedApprovals]);

  useEffect(() => {
    setSelectedApprovalIds([]);
  }, [activeApprovalsSubTab, approvalsTeam]);

  // Fetch approval detail when a submission is selected in Approvals
  useEffect(() => {
    if (!selectedApprovalSubmissionId) {
      setApprovalDetail(null);
      setApprovalEntryReviews({});
      setApprovalProductiveHours({});
      return;
    }
    let cancelled = false;
    setApprovalDetailLoading(true);
    setApprovalEntryReviews({});
    setApprovalProductiveHours({});
    apiFetch(`/timesheet/submission/${selectedApprovalSubmissionId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((data) => {
        if (!cancelled) {
          setApprovalDetail(data);
          const rev = {};
          const prod = {};
          (data.entries || []).forEach((e) => {
            const key = `${e.source}-${e.id}`;
            if (e.review_status) rev[key] = e.review_status;
            const initialProductive = e.review_productive_hours ?? e.productive_hours ?? e.time_spent_hours ?? e.hours ?? 0;
            prod[key] = Number(initialProductive).toFixed(1);
          });
          setApprovalEntryReviews(rev);
          setApprovalProductiveHours(prod);
        }
      })
      .catch(() => { if (!cancelled) setApprovalDetail(null); })
      .finally(() => { if (!cancelled) setApprovalDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApprovalSubmissionId]);

  const handleApprovalAction = async (action) => {
    if (!selectedApprovalSubmissionId) return;
    const entry_reviews = approvalDetail?.entries?.length
      ? approvalDetail.entries
          .filter((e) => approvalEntryReviews[`${e.source}-${e.id}`])
          .map((e) => ({
            entry_source: e.source,
            entry_id: e.id,
            status: approvalEntryReviews[`${e.source}-${e.id}`],
            productive_hours: approvalEntryReviews[`${e.source}-${e.id}`] === 'approved'
              ? (Number(approvalProductiveHours[`${e.source}-${e.id}`]) || Number(e.time_spent_hours ?? e.hours ?? 0))
              : null,
            notes: ['rejected', 'revision_required'].includes(approvalEntryReviews[`${e.source}-${e.id}`])
              ? (approvalNotes || null)
              : null,
          }))
      : undefined;
    const payload = { notes: approvalNotes || null, entry_reviews: entry_reviews && entry_reviews.length > 0 ? entry_reviews : null };
    const endpoint = action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'request-revision';
    setApprovalActionLoading(true);
    try {
      const res = await apiFetch(`/timesheet/${endpoint}/${selectedApprovalSubmissionId}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to ${action}`);
      }
      setSelectedApprovalSubmissionId(null);
      setApprovalDetail(null);
      setApprovalNotes('');
      setApprovalEntryReviews({});
      setApprovalProductiveHours({});
      if (activeApprovalsSubTab === 'pending') fetchPendingApprovals();
      else fetchCompletedApprovals();
    } catch (err) {
      setError(err.message || `Failed to ${action}`);
    } finally {
      setApprovalActionLoading(false);
    }
  };

  const toggleApprovalSelection = (submissionId) => {
    setSelectedApprovalIds((prev) => (
      prev.includes(submissionId) ? prev.filter((id) => id !== submissionId) : [...prev, submissionId]
    ));
  };

  const handleToggleSelectAllApprovals = () => {
    if (!sortedApprovalsList.length) return;
    const visibleIds = sortedApprovalsList.map((s) => s.id);
    const allSelected = visibleIds.every((id) => selectedApprovalIds.includes(id));
    setSelectedApprovalIds(allSelected ? [] : visibleIds);
  };

  const handleBulkApprovalAction = async (action) => {
    if (!selectedApprovalIds.length) return;
    const actionLabel = action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'request revision for';
    if (!window.confirm(`Are you sure you want to ${actionLabel} ${selectedApprovalIds.length} selected submission(s)?`)) return;
    setBulkApprovalActionLoading(true);
    try {
      const res = await apiFetch('/timesheet/approvals/bulk', {
        method: 'POST',
        body: JSON.stringify({
          submission_ids: selectedApprovalIds,
          action,
          notes: approvalNotes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Bulk action failed');
      }
      const data = await res.json();
      const failed = (data.results || []).filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(`Processed ${data.successful}/${data.processed}. Failed: ${failed.map((f) => `#${f.submission_id}: ${f.error}`).join(', ')}`);
      }
      setSelectedApprovalIds([]);
      if (activeApprovalsSubTab === 'pending') fetchPendingApprovals();
      else fetchCompletedApprovals();
      fetchManagerSummary();
    } catch (err) {
      setError(err.message || 'Bulk action failed');
    } finally {
      setBulkApprovalActionLoading(false);
    }
  };

  const fetchManagerSummary = useCallback(async () => {
    if (!canApproveTimesheets) return;
    setManagerSummaryLoading(true);
    try {
      const weekRef = formatAPIDate(currentDate);
      const monthRef = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const params = new URLSearchParams({
        period: managerSummaryPeriod,
        team: approvalsTeam || 'ALL',
        category: 'ALL',
      });
      if (managerSummaryPeriod === 'month') params.set('month', monthRef);
      else params.set('date_str', weekRef);
      const res = await apiFetch(`/timesheet/manager-summary?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load manager summary');
      const data = await res.json();
      setManagerSummary(data);
    } catch {
      setManagerSummary(null);
    } finally {
      setManagerSummaryLoading(false);
    }
  }, [canApproveTimesheets, currentDate, managerSummaryPeriod, approvalsTeam]);

  useEffect(() => {
    if (activeTab !== 'approvals') return;
    fetchManagerSummary();
  }, [activeTab, fetchManagerSummary]);

  // Fetch submission detail when a row is clicked (My submissions tab)
  useEffect(() => {
    if (!selectedSubmissionId) {
      setSubmissionDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    apiFetch(`/timesheet/submission/${selectedSubmissionId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((data) => {
        if (!cancelled) setSubmissionDetail(data);
      })
      .catch(() => {
        if (!cancelled) setSubmissionDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => { cancelled = true; };
  }, [selectedSubmissionId]);

  // Navigation handlers
  const goToPreviousWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Get hours color class
  const getHoursColorClass = (hours) => {
    if (hours >= 8) return 'hours-full';
    if (hours >= 4) return 'hours-half';
    if (hours > 0) return 'hours-low';
    return 'hours-zero';
  };

  // Open entry form for a specific day and employee
  const openEntryForm = (dateStr, employeeId, entry = null) => {
    // Regular employees can only add logs for themselves
    const targetEmployeeId = canAddLogsForOthers ? employeeId : (user?.employee_id || employeeId);
    setSelectedEmployeeId(targetEmployeeId);
    setEditingEntry(entry);
    setEntryForm({
      date: dateStr,
      task_category: entry?.task_category || 'Ticket',
      activity_type: entry?.activity_type || (team === 'QA' ? 'QA' : 'Development'),
      hours: entry?.hours || '',
      ticket_id: entry?.ticket_id || '',
      task_description: entry?.task_description || '',
      project_name: entry?.project_name || '',
    });
    setEntryFormErrors({});
    setShowEntryForm(true);
  };

  const closeEntryForm = () => {
    setShowEntryForm(false);
    setEditingEntry(null);
    setSelectedEmployeeId('');
    setPlannedTasksForDay([]);
    setAddWithMyTimeTask(null);
    setAddWithMyTimeHours('');
    setAddWithMyTimeVarianceNotes('');
    setAddWithMyTimeReasonType('');
    setAddWithMyTimeError('');
  };

  // Save manual entry (no planned task)
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
    if (
      !entryForm.task_description?.trim() &&
      !entryForm.ticket_id &&
      entryForm.task_category !== 'Leave' &&
      entryForm.task_category !== 'Half Day Leave'
    ) errs.task_description = 'Task description or Ticket ID is required';
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
      employee_id: selectedEmployeeId || user?.employee_id,
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
      await fetchTimesheetData();
    } catch (err) {
      setError(err.message || 'Failed to save entry');
    }
  };

  // Add entry from planned task as-is (same hours as planned)
  const handleAddFromPlannedAsIs = async (task) => {
    const activityType = (task.task_type && ACTIVITY_TYPES.includes(task.task_type)) ? task.task_type : (team === 'QA' ? 'QA' : 'Development');
    const payload = {
      activity_type: activityType,
      task_category: task.category || 'Ticket',
      date: entryForm.date,
      hours: Number(task.hours),
      ticket_id: toOptionalTrimmedString(task.ticket_id),
      task_description: toOptionalTrimmedString(task.activity_description || task.ticket_title),
      project_name: null,
      employee_id: selectedEmployeeId || user?.employee_id,
      planned_task_id: task.id,
      planned_task_source: task.source,
    };
    try {
      const res = await apiFetch('/timesheet/entry', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to add entry');
      }
      closeEntryForm();
      await fetchTimesheetData();
    } catch (err) {
      setError(err.message || 'Failed to add entry');
    }
  };

  // Add entry from planned task with user-entered hours (variance comment required if different)
  const handleAddWithMyTime = async () => {
    if (!addWithMyTimeTask) return;
    const hoursNum = parseFloat(addWithMyTimeHours);
    const plannedHours = parseFloat(addWithMyTimeTask.hours);
    const needsVariance = Math.abs(hoursNum - plannedHours) > 0.01;
    if (hoursNum <= 0 || isNaN(hoursNum)) {
      setAddWithMyTimeError('Enter valid hours');
      return;
    }
    if (needsVariance && !(addWithMyTimeVarianceNotes && addWithMyTimeVarianceNotes.trim())) {
      setAddWithMyTimeError('Comment (variance reason) is required when your hours differ from planned.');
      return;
    }
    setAddWithMyTimeError('');
    const activityType = (addWithMyTimeTask.task_type && ACTIVITY_TYPES.includes(addWithMyTimeTask.task_type)) ? addWithMyTimeTask.task_type : (team === 'QA' ? 'QA' : 'Development');
    const payload = {
      activity_type: activityType,
      task_category: addWithMyTimeTask.category || 'Ticket',
      date: entryForm.date,
      hours: hoursNum,
      ticket_id: toOptionalTrimmedString(addWithMyTimeTask.ticket_id),
      task_description: toOptionalTrimmedString(addWithMyTimeTask.activity_description || addWithMyTimeTask.ticket_title),
      project_name: null,
      employee_id: selectedEmployeeId || user?.employee_id,
      planned_task_id: addWithMyTimeTask.id,
      planned_task_source: addWithMyTimeTask.source,
      variance_notes: needsVariance ? addWithMyTimeVarianceNotes.trim() : null,
      variance_reason_type: addWithMyTimeReasonType?.trim() || null,
    };
    try {
      const res = await apiFetch('/timesheet/entry', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to add entry');
      }
      closeEntryForm();
      await fetchTimesheetData();
    } catch (err) {
      setAddWithMyTimeError(err.message || 'Failed to add entry');
    }
  };

  // Delete entry
  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    
    try {
      const res = await apiFetch(`/timesheet/entry/${entryId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to delete entry');
      }
      await fetchTimesheetData();
    } catch (err) {
      setError(err.message || 'Failed to delete entry');
    }
  };

  // Calculate daily totals
  const dailyTotals = useMemo(() => {
    if (!timesheetData?.employees) return [];
    return weekDays.map((day) => {
      const dayKey = formatAPIDate(day);
      let total = 0;
      let count = 0;
      timesheetData.employees.forEach(emp => {
        const dayData = emp.days?.[dayKey];
        if (dayData) {
          total += (dayData.total_hours || 0) + (dayData.leave_hours || 0);
          if ((dayData.total_hours || 0) + (dayData.leave_hours || 0) > 0) count++;
        }
      });
      return { total, count, average: count > 0 ? total / count : 0 };
    });
  }, [timesheetData, weekDays]);

  // Calculate grand totals
  const grandTotals = useMemo(() => {
    if (!timesheetData?.employees) return { total: 0, averagePerDay: 0, averagePerEmployee: 0 };
    const total = timesheetData.employees.reduce((sum, emp) => sum + (emp.weekly_total || 0), 0);
    const avgPerDay = dailyTotals.filter(d => d.count > 0).length > 0
      ? dailyTotals.reduce((sum, d) => sum + d.total, 0) / dailyTotals.filter(d => d.count > 0).length
      : 0;
    const avgPerEmployee = timesheetData.employees.length > 0
      ? total / timesheetData.employees.length
      : 0;
    return { total, averagePerDay: avgPerDay, averagePerEmployee: avgPerEmployee };
  }, [timesheetData, dailyTotals]);

  // Current week (Mon–Sun) for submit: is the viewed week the current week?
  const weekEndDate = weekDays[6];
  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = weekEndDate ? new Date(weekEndDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    return end && today >= start && today <= end;
  }, [weekStart, weekEndDate]);

  const submissionForThisWeek = useMemo(() => {
    const ws = formatAPIDate(weekStart);
    return mySubmissions.find((s) => s.week_start === ws);
  }, [mySubmissions, weekStart]);

  const submittedStatus = submissionForThisWeek?.status;
  const myWeekTotal = myWeekSummary?.total_hours ?? 0;
  const meets40h = myWeekTotal >= 40;
  const canSubmitThisWeek = Boolean(
    user?.employee_id && isCurrentWeek && meets40h && submittedStatus !== 'Pending' && submittedStatus !== 'Lead Approved' && submittedStatus !== 'Approved'
  );

  const submitDueDate = useMemo(() => {
    if (!weekEndDate) return null;
    const d = new Date(weekEndDate);
    d.setDate(d.getDate() + 2);
    return d;
  }, [weekEndDate]);

  const handleSubmitWeek = async () => {
    if (!canSubmitThisWeek) return;
    const we = formatAPIDate(weekDays[6]);
    if (!window.confirm(`Submit timesheet for the week ending ${we}?`)) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/timesheet/submit', {
        method: 'POST',
        body: JSON.stringify({ week_ending: we }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to submit');
      }
      await fetchMySubmissions();
      await fetchTimesheetData();
    } catch (err) {
      setError(err.message || 'Failed to submit timesheet');
    } finally {
      setSubmitting(false);
    }
  };

  // Check if user can add logs (must have employee_id or be manager/lead/admin)
  const canAddLogs = user?.employee_id || user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD');

  // Only managers (and admin) see all team data; rest see only their own and can add log only for themselves
  const isManagerView = timesheetData?.viewer_can_see_all === true;
  const myDisplayName = !isManagerView && timesheetData?.employees?.length === 1
    ? timesheetData.employees[0].employee_name
    : null;

  // Check if user can add logs for other employees (managers/admin only - not leads per requirement)
  const canAddLogsForOthers = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');

  return (
    <div className="calendar-module timesheet-module">
      <AppSidebar />

      <main className="main-content">
        <header className="page-header">
          <div className="header-title">
            <h1>{myDisplayName ? `⏱ Your timesheet – ${myDisplayName}` : '⏱ Team Timesheet'}</h1>
            <p>{myDisplayName ? 'View and log your daily time entries' : 'View and log daily time entries by team'}</p>
          </div>
        </header>

        {/* Main tabs: Log time | My submissions */}
        <div className="timesheet-main-tabs">
          <button
            type="button"
            className={`main-tab ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            Log time
          </button>
          <button
            type="button"
            className={`main-tab ${activeTab === 'submissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('submissions')}
          >
            My submissions
          </button>
          <button
            type="button"
            className={`main-tab ${activeTab === 'plan-vs-actual' ? 'active' : ''}`}
            onClick={() => setActiveTab('plan-vs-actual')}
          >
            Plan vs actual
          </button>
          {canApproveTimesheets && (
            <button
              type="button"
              className={`main-tab ${activeTab === 'approvals' ? 'active' : ''}`}
              onClick={() => setActiveTab('approvals')}
            >
              Timesheet Approvals
            </button>
          )}
        </div>

        {activeTab === 'plan-vs-actual' && (
          <div className="plan-vs-actual-panel">
            <div className="plan-vs-actual-controls">
              <label>
                Team
                <select value={planVsActualTeam} onChange={(e) => setPlanVsActualTeam(e.target.value)}>
                  <option value="QA">QA</option>
                  <option value="DEVELOPMENT">DEV</option>
                </select>
              </label>
              <label>
                Week (Monday)
                <input
                  type="date"
                  value={planVsActualWeekStart}
                  onChange={(e) => setPlanVsActualWeekStart(e.target.value)}
                />
              </label>
            </div>
            {planVsActualLoading && <p className="loading-inline">Loading…</p>}
            {!planVsActualLoading && planVsActualData && (
              <>
                <div className="plan-vs-actual-summary">
                  <span>Planned: {planVsActualData.summary?.total_planned_hours ?? 0}h</span>
                  <span>Actual: {planVsActualData.summary?.total_actual_hours ?? 0}h</span>
                  <span>Variance: {(planVsActualData.summary?.total_actual_hours ?? 0) - (planVsActualData.summary?.total_planned_hours ?? 0)}h</span>
                </div>
                <table className="plan-vs-actual-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Planned (h)</th>
                      <th>Actual (h)</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(planVsActualData.employees || []).map((emp, idx) => (
                      <tr key={idx}>
                        <td>{emp.employee_name}</td>
                        <td>{emp.planned_hours}</td>
                        <td>{emp.actual_hours}</td>
                        <td className={emp.variance >= 0 ? 'variance-ok' : 'variance-under'}>{emp.variance}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="plan-vs-actual-entries">
                  <h4>Actual entries (with variance reason when present)</h4>
                  {(planVsActualData.employees || []).map((emp, idx) => (
                    <div key={idx} className="plan-vs-actual-employee-block">
                      <strong>{emp.employee_name}</strong>
                      <ul>
                        {(emp.actual_entries || []).map((entry, eidx) => (
                          <li key={eidx}>
                            {entry.date} – {entry.ticket_id ? `#${entry.ticket_id}` : entry.task_description || 'Task'} – {entry.hours}h
                            {(entry.variance_reason_type || entry.variance_notes) && (
                              <span className="variance-reason">
                                {' '}({[
                                  entry.variance_reason_type ? (VARIANCE_REASON_TYPES.find(o => o.value === entry.variance_reason_type)?.label || entry.variance_reason_type) : '',
                                  entry.variance_notes || '',
                                ].filter(Boolean).join(' – ')})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!planVsActualLoading && activeTab === 'plan-vs-actual' && !planVsActualData && <p className="text-muted">No data for this week.</p>}
          </div>
        )}

        {activeTab === 'approvals' && canApproveTimesheets && (
          <div className="timesheet-approvals-panel">
            <div className="approvals-sub-tabs">
              <button
                type="button"
                className={`sub-tab ${activeApprovalsSubTab === 'pending' ? 'active' : ''}`}
                onClick={() => setActiveApprovalsSubTab('pending')}
              >
                Pending approvals
              </button>
              <button
                type="button"
                className={`sub-tab ${activeApprovalsSubTab === 'completed' ? 'active' : ''}`}
                onClick={() => setActiveApprovalsSubTab('completed')}
              >
                Completed approvals
              </button>
            </div>
            <div className="approvals-team-filter">
              <label>
                Team
                <select value={approvalsTeam} onChange={(e) => setApprovalsTeam(e.target.value)}>
                  <option value="">All (by role)</option>
                  <option value="QA">QA</option>
                  <option value="DEVELOPMENT">DEV</option>
                </select>
              </label>
              <label>
                Summary period
                <select value={managerSummaryPeriod} onChange={(e) => setManagerSummaryPeriod(e.target.value)}>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
            </div>
            {managerSummaryLoading ? (
              <p className="loading-inline">Loading manager summary…</p>
            ) : managerSummary?.totals ? (
              <>
                <div className="plan-vs-actual-summary">
                  <span>Expected: {Number(managerSummary.totals.expected_hours || 0).toFixed(1)}h</span>
                  <span>Productive: {Number(managerSummary.totals.productive_hours || 0).toFixed(1)}h</span>
                  <span>Leave: {Number(managerSummary.totals.leave_hours || 0).toFixed(1)}h</span>
                  <span>Working days: {Number(managerSummary.totals.working_days || 0).toFixed(0)}</span>
                  <span>Leave days: {Number(managerSummary.totals.leave_days || 0).toFixed(1)}</span>
                </div>
                <div className="plan-vs-actual-entries">
                  <h4>By Team</h4>
                  <table className="plan-vs-actual-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Employees</th>
                        <th>Expected</th>
                        <th>Productive</th>
                        <th>Leave (h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(managerSummary.by_team || {}).map(([group, stats]) => (
                        <tr key={`team-${group}`}>
                          <td>{group}</td>
                          <td>{stats.employees || 0}</td>
                          <td>{Number(stats.expected_hours || 0).toFixed(1)}h</td>
                          <td>{Number(stats.productive_hours || 0).toFixed(1)}h</td>
                          <td>{Number(stats.leave_hours || 0).toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h4>By Category</h4>
                  <table className="plan-vs-actual-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Employees</th>
                        <th>Expected</th>
                        <th>Productive</th>
                        <th>Leave (h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(managerSummary.by_category || {}).map(([group, stats]) => (
                        <tr key={`cat-${group}`}>
                          <td>{group}</td>
                          <td>{stats.employees || 0}</td>
                          <td>{Number(stats.expected_hours || 0).toFixed(1)}h</td>
                          <td>{Number(stats.productive_hours || 0).toFixed(1)}h</td>
                          <td>{Number(stats.leave_hours || 0).toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {approvalDetail ? (
              <div className="approval-detail-view">
                <button type="button" className="btn btn-ghost back-to-list" onClick={() => { setSelectedApprovalSubmissionId(null); setApprovalDetail(null); setApprovalNotes(''); setApprovalEntryReviews({}); setApprovalProductiveHours({}); }}>← Back to list</button>
                {approvalDetailLoading ? (
                  <p>Loading…</p>
                ) : (
                  <>
                    <div className="submission-detail-header">
                      <span>{approvalDetail.submission?.employee_name} · Week: {approvalDetail.submission?.week_start} – {approvalDetail.submission?.week_end}</span>
                      <span className={`status-badge status-badge--${(approvalDetail.submission?.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{approvalDetail.submission?.status}</span>
                    </div>
                    <p>Submitted: {approvalDetail.submission?.submitted_on || '-'} · Total: {approvalDetail.submission?.total_hours ?? 0}h · Leave: {approvalDetail.submission?.leave_hours ?? 0}h</p>
                    <div className="approval-notes-row">
                      <label>Notes (optional)</label>
                      <textarea value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} placeholder="Add notes for approval/reject/revision…" rows={2} />
                    </div>
                    <table className="submission-entries-table approval-entries-table">
                      <thead>
                        <tr>
                          <SortableHeader columnKey="date" onSort={handleApprovalEntriesSort} sortConfig={approvalEntriesSortConfig}>Date</SortableHeader>
                          <SortableHeader columnKey="activity_type" onSort={handleApprovalEntriesSort} sortConfig={approvalEntriesSortConfig}>Type</SortableHeader>
                          <th>Ticket / Description</th>
                          <SortableHeader columnKey="planned_hours" onSort={handleApprovalEntriesSort} sortConfig={approvalEntriesSortConfig}>Planned</SortableHeader>
                          <SortableHeader columnKey="time_spent_hours" onSort={handleApprovalEntriesSort} sortConfig={approvalEntriesSortConfig}>Time spent</SortableHeader>
                          <th>Productive</th>
                          {activeApprovalsSubTab === 'pending' && (
                            <th>Per-entry action</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedApprovalEntries.map((entry, idx) => {
                          const key = `${entry.source}-${entry.id}`;
                          return (
                            <tr key={key}>
                              <td>{entry.date}</td>
                              <td>{entry.activity_type || entry.task_category || entry.source}</td>
                              <td>
                                <div>{entry.ticket_id ? `#${entry.ticket_id}` : (entry.task_description || '-')}</div>
                                {(entry.variance_reason_type || entry.variance_notes) && (
                                  <small className="text-muted">
                                    Variance: {[
                                      entry.variance_reason_type ? (VARIANCE_REASON_TYPES.find((o) => o.value === entry.variance_reason_type)?.label || entry.variance_reason_type) : '',
                                      entry.variance_notes || '',
                                    ].filter(Boolean).join(' - ')}
                                  </small>
                                )}
                              </td>
                              <td>{entry.planned_hours == null ? '-' : Number(entry.planned_hours || 0).toFixed(1)}</td>
                              <td>{Number(entry.time_spent_hours ?? entry.hours ?? 0).toFixed(1)}</td>
                              <td>
                                {activeApprovalsSubTab === 'pending' ? (
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={approvalProductiveHours[key] ?? Number(entry.time_spent_hours ?? entry.hours ?? 0).toFixed(1)}
                                    onChange={(e) => setApprovalProductiveHours((prev) => ({ ...prev, [key]: e.target.value }))}
                                  />
                                ) : (
                                  Number(entry.review_productive_hours ?? entry.productive_hours ?? entry.time_spent_hours ?? entry.hours ?? 0).toFixed(1)
                                )}
                              </td>
                              {activeApprovalsSubTab === 'pending' && (
                                <td>
                                  <select
                                    value={approvalEntryReviews[key] || ''}
                                    onChange={(e) => setApprovalEntryReviews((prev) => ({ ...prev, [key]: e.target.value || undefined }))}
                                  >
                                    <option value="">—</option>
                                    <option value="approved">Approve</option>
                                    <option value="revision_required">Revision required</option>
                                    <option value="rejected">Reject</option>
                                  </select>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {activeApprovalsSubTab === 'pending' && (
                      <div className="approval-actions">
                        <p className="approval-actions-hint">Set per-entry decisions and productive time. If any entry is rejected/revision-required, this submission will stay non-final for employee correction.</p>
                        <div className="approval-buttons">
                          <button type="button" className="btn btn-primary" disabled={approvalActionLoading} onClick={() => handleApprovalAction('approve')}>Approve</button>
                          <button type="button" className="btn btn-danger" disabled={approvalActionLoading} onClick={() => handleApprovalAction('reject')}>Reject</button>
                          <button type="button" className="btn btn-secondary" disabled={approvalActionLoading} onClick={() => handleApprovalAction('revision')}>Request revision</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                {approvalsLoading ? (
                  <p className="loading-inline">Loading…</p>
                ) : (
                  <>
                    <h3>{activeApprovalsSubTab === 'pending' ? 'Pending approvals' : 'Completed approvals'}</h3>
                    {activeApprovalsSubTab === 'pending' && sortedApprovalsList.length > 0 && (
                      <div className="approval-actions">
                        <p className="approval-actions-hint">Select multiple submissions for bulk processing.</p>
                        <div className="approval-buttons">
                          <button type="button" className="btn btn-primary" disabled={bulkApprovalActionLoading || selectedApprovalIds.length === 0} onClick={() => handleBulkApprovalAction('approve')}>Approve selected</button>
                          <button type="button" className="btn btn-danger" disabled={bulkApprovalActionLoading || selectedApprovalIds.length === 0} onClick={() => handleBulkApprovalAction('reject')}>Reject selected</button>
                          <button type="button" className="btn btn-secondary" disabled={bulkApprovalActionLoading || selectedApprovalIds.length === 0} onClick={() => handleBulkApprovalAction('revision')}>Request revision selected</button>
                        </div>
                      </div>
                    )}
                    {sortedApprovalsList.length === 0 ? (
                      <p className="text-muted">No {activeApprovalsSubTab === 'pending' ? 'pending' : 'completed'} approvals.</p>
                    ) : (
                      <table className="my-submissions-table">
                        <thead>
                          <tr>
                            {activeApprovalsSubTab === 'pending' && (
                              <th>
                                <input
                                  type="checkbox"
                                  checked={sortedApprovalsList.length > 0 && sortedApprovalsList.every((s) => selectedApprovalIds.includes(s.id))}
                                  onChange={handleToggleSelectAllApprovals}
                                />
                              </th>
                            )}
                            <SortableHeader columnKey="employee_name" onSort={handleApprovalsSort} sortConfig={approvalsSortConfig}>Employee</SortableHeader>
                            <SortableHeader columnKey="week_start" onSort={handleApprovalsSort} sortConfig={approvalsSortConfig}>Week (Mon–Fri)</SortableHeader>
                            <SortableHeader columnKey="submitted_on" onSort={handleApprovalsSort} sortConfig={approvalsSortConfig}>Submitted</SortableHeader>
                            <SortableHeader columnKey="status" onSort={handleApprovalsSort} sortConfig={approvalsSortConfig}>Status</SortableHeader>
                            <SortableHeader columnKey="total_hours" onSort={handleApprovalsSort} sortConfig={approvalsSortConfig}>Total hours</SortableHeader>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedApprovalsList.map((s) => {
                            const mon = s.week_start ? new Date(s.week_start + 'T12:00:00') : null;
                            let fri = null;
                            if (mon) { fri = new Date(mon); fri.setDate(fri.getDate() + 4); }
                            const weekLabel = mon && fri ? `${mon.getDate()} ${MONTH_NAMES[mon.getMonth()].slice(0, 3)} – ${fri.getDate()} ${MONTH_NAMES[fri.getMonth()].slice(0, 3)}` : (s.week_start || '') + ' – ' + (s.week_end || '');
                            return (
                              <tr key={s.id} className="submission-row" onClick={() => setSelectedApprovalSubmissionId(s.id)}>
                                {activeApprovalsSubTab === 'pending' && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedApprovalIds.includes(s.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={() => toggleApprovalSelection(s.id)}
                                    />
                                  </td>
                                )}
                                <td>{s.employee_name}</td>
                                <td>{weekLabel}</td>
                                <td>{s.submitted_on ? new Date(s.submitted_on).toLocaleDateString() : '-'}</td>
                                <td><span className={`status-badge status-badge--${(s.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{s.status}</span></td>
                                <td>{(s.total_hours ?? 0) + (s.leave_hours ?? 0)}h</td>
                                <td><button type="button" className="btn btn-ghost btn-small" onClick={(e) => { e.stopPropagation(); setSelectedApprovalSubmissionId(s.id); }}>View</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'submissions' && (
          <div className="my-submissions-panel">
            {!user?.employee_id ? (
              <p className="text-muted">You need an employee account to see submissions.</p>
            ) : (
              <>
                {submissionDetail ? (
                  <div className="submission-detail-view">
                    <button type="button" className="btn btn-ghost back-to-list" onClick={() => { setSelectedSubmissionId(null); setSubmissionDetail(null); }}>← Back to list</button>
                    {loadingDetail ? (
                      <p>Loading…</p>
                    ) : (
                      <>
                        <div className="submission-detail-header">
                          <span>Week: {submissionDetail.submission?.week_start} – {submissionDetail.submission?.week_end}</span>
                          <span className={`status-badge status-badge--${(submissionDetail.submission?.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{submissionDetail.submission?.status}</span>
                        </div>
                        <p>Submitted: {submissionDetail.submission?.submitted_on || '-'} · Total: {submissionDetail.submission?.total_hours ?? 0}h · Leave: {submissionDetail.submission?.leave_hours ?? 0}h</p>
                        <table className="submission-entries-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Ticket / Description</th>
                              <th>Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {submissionDetail.entries?.map((entry, idx) => (
                              <tr key={`${entry.source}-${entry.id}-${idx}`}>
                                <td>{entry.date}</td>
                                <td>{entry.activity_type || entry.task_category || entry.source}</td>
                                <td>{entry.ticket_id ? `#${entry.ticket_id}` : (entry.task_description || '-')}</td>
                                <td>{Number(entry.hours || 0).toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <h3>My submissions</h3>
                    {sortedMySubmissions.length === 0 ? (
                      <p className="text-muted">No submissions yet.</p>
                    ) : (
                      <table className="my-submissions-table">
                        <thead>
                          <tr>
                            <SortableHeader columnKey="week_start" onSort={handleMySubmissionsSort} sortConfig={mySubmissionsSortConfig}>Week (Mon–Fri)</SortableHeader>
                            <SortableHeader columnKey="submitted_on" onSort={handleMySubmissionsSort} sortConfig={mySubmissionsSortConfig}>Submitted</SortableHeader>
                            <SortableHeader columnKey="status" onSort={handleMySubmissionsSort} sortConfig={mySubmissionsSortConfig}>Status</SortableHeader>
                            <SortableHeader columnKey="total_hours_logged" onSort={handleMySubmissionsSort} sortConfig={mySubmissionsSortConfig}>Total hours</SortableHeader>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMySubmissions.map((s) => {
                            const mon = s.week_start ? new Date(s.week_start + 'T12:00:00') : null;
                            let fri = null;
                            if (mon) {
                              fri = new Date(mon);
                              fri.setDate(fri.getDate() + 4);
                            }
                            const weekLabel = mon && fri ? `${mon.getDate()} ${MONTH_NAMES[mon.getMonth()].slice(0, 3)} – ${fri.getDate()} ${MONTH_NAMES[fri.getMonth()].slice(0, 3)}` : s.week_start + ' – ' + s.week_end;
                            return (
                              <tr key={s.id} className="submission-row" onClick={() => setSelectedSubmissionId(s.id)}>
                                <td>{weekLabel}</td>
                                <td>{s.submitted_on ? new Date(s.submitted_on).toLocaleDateString() : '-'}</td>
                                <td><span className={`status-badge status-badge--${(s.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{s.status}</span></td>
                                <td>{(s.total_hours_logged ?? 0) + (s.leave_hours ?? 0)}h</td>
                                <td><button type="button" className="btn btn-ghost btn-small" onClick={(e) => { e.stopPropagation(); setSelectedSubmissionId(s.id); }}>View</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <>
        {/* Team Tabs – only for managers who can see all team data */}
        {isManagerView && (
          <div className="team-tabs">
            <button 
              className={`team-tab ${team === 'QA' ? 'active' : ''}`}
              onClick={() => setTeam('QA')}
            >
              QA Team
            </button>
            <button 
              className={`team-tab ${team === 'DEVELOPMENT' ? 'active' : ''}`}
              onClick={() => setTeam('DEVELOPMENT')}
            >
              DEV Team
            </button>
          </div>
        )}

        {/* Calendar Controls */}
        <div className="calendar-controls">
          <div className="date-navigation">
            <button className="nav-btn" onClick={goToPreviousWeek}>←</button>
            <button className="today-btn" onClick={goToToday}>Today</button>
            <span className="current-period">
              {weekDays[0] && weekDays[4] ? `${DAY_NAMES[0]} ${weekDays[0].getDate()} ${MONTH_NAMES[weekDays[0].getMonth()].slice(0, 3)} – ${DAY_NAMES[4]} ${weekDays[4].getDate()} ${MONTH_NAMES[weekDays[4].getMonth()].slice(0, 3)}` : formatDateRange(weekDays[0], weekDays[6])}
            </span>
            <button className="nav-btn" onClick={goToNextWeek}>→</button>
          </div>
          {user?.employee_id && (
            <>
              <div className="timesheet-submit-row">
                <span className="submit-by-text">Submit by next Tuesday{submitDueDate ? ` (${submitDueDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })})` : ''}</span>
                {isCurrentWeek && (
                  submittedStatus && submittedStatus !== 'Rejected' && submittedStatus !== 'Revision Required' ? (
                    <span className="submission-status-badge">{submittedStatus}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-submit"
                      onClick={handleSubmitWeek}
                      disabled={!canSubmitThisWeek || submitting}
                    >
                      {submitting ? 'Submitting…' : 'Submit timesheet'}
                    </button>
                  )
                )}
              </div>
              {isCurrentWeek && myWeekSummary && (
                <div className="weekly-summary-card">
                  {myWeekTotal < 40 && (
                    <p className="weekly-summary-min-msg">Minimum 40 hours (including leave) required. Current total: {myWeekTotal.toFixed(1)}h.</p>
                  )}
                  <div className="weekly-summary-stats">
                    <span><strong>Total:</strong> {myWeekSummary.total_hours.toFixed(1)}h</span>
                    <span><strong>Daily avg:</strong> {(myWeekSummary.total_hours / 5).toFixed(1)}h</span>
                    <span><strong>Tickets:</strong> {myWeekSummary.ticket_count ?? 0}</span>
                    {myWeekSummary.by_category && Object.keys(myWeekSummary.by_category).length > 0 && (
                      <span className="by-category">
                        <strong>By category:</strong>{' '}
                        {Object.entries(myWeekSummary.by_category)
                          .filter(([, h]) => h > 0)
                          .map(([cat, h]) => `${cat}: ${Number(h).toFixed(1)}h`)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Calendar Content */}
        <div className="calendar-content">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading timesheet data…</p>
            </div>
          )}
          
          {error && (
            <div className="error-state">
              <p>⚠️ {error}</p>
              <button type="button" className="sync-btn" onClick={fetchTimesheetData}>Retry</button>
            </div>
          )}

          {!loading && !error && timesheetData && (
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
                  {timesheetData.employees.map((emp, empIdx) => (
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
                        const dayKey = formatAPIDate(day);
                        const dayData = emp.days?.[dayKey] || { entries: [], total_hours: 0, leave_hours: 0 };
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        const totalHours = (dayData.total_hours || 0) + (dayData.leave_hours || 0);
                        
                        return (
                          <td 
                            key={dayIdx} 
                            className={`day-cell ${isWeekend ? 'weekend' : ''} ${getHoursColorClass(totalHours)}`}
                          >
                            {dayData.leave_hours > 0 && (
                              <span className="leave-badge">Leave: {dayData.leave_hours.toFixed(1)}h</span>
                            )}
                            {dayData.entries && dayData.entries.length > 0 && (
                              <div className="day-entries">
                                {dayData.entries.map((entry, idx) => {
                                  const isTicket = entry.ticket_id && /^\d+$/.test(String(entry.ticket_id));
                                  return (
                                    <div 
                                      key={idx} 
                                      className={`entry-ticket ${isTicket ? 'clickable-ticket' : ''}`}
                                      title={entry.task_description || entry.ticket_id}
                                    >
                                      {isTicket ? (
                                        <div className="ticket-actions">
                                          <Link 
                                            to={`/tickets?ticket=${entry.ticket_id}`} 
                                            className="ticket-id ticket-link"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            #{entry.ticket_id}
                                          </Link>
                                          <TicketExternalLink ticketId={entry.ticket_id} />
                                        </div>
                                      ) : (
                                        <span className="ticket-id">
                                          {(entry.task_description || entry.activity_type || 'Task').slice(0, 12)}
                                        </span>
                                      )}
                                      <span className="ticket-hours">{parseFloat(entry.hours || 0).toFixed(1)}h</span>
                                      {entry.source === 'manual' && canAddLogs && (
                                        <button
                                          className="entry-delete-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteEntry(entry.id);
                                          }}
                                          title="Delete entry"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className={`day-total ${getHoursColorClass(totalHours)}`}>
                              <strong>{totalHours > 0 ? `${totalHours.toFixed(1)}h` : '-'}</strong>
                            </div>
                            {canAddLogs && !isWeekend && (canAddLogsForOthers || emp.employee_id === user?.employee_id) && (
                              <button 
                                type="button" 
                                className="add-log-btn" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEntryForm(dayKey, emp.employee_id);
                                }}
                                title="Add time log"
                              >
                                + Add Log
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className={`total-cell ${getHoursColorClass(emp.weekly_total / 5)}`}>
                        <strong>{parseFloat(emp.weekly_total || 0).toFixed(1)}h</strong>
                        <div className="weekly-avg">
                          Avg: {((emp.weekly_total || 0) / 5).toFixed(1)}h/day
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totals-row daily-totals-row">
                    <td className="totals-label">Daily Totals</td>
                    {dailyTotals.map((dayTotal, idx) => (
                      <td key={idx} className="totals-cell">
                        <div className="totals-breakdown">
                          <span className="total-time-spent">{dayTotal.total.toFixed(1)}h</span>
                          <span className="total-avg">Avg: {dayTotal.average.toFixed(1)}h</span>
                        </div>
                      </td>
                    ))}
                    <td className="totals-cell grand-total">
                      <strong>{grandTotals.total.toFixed(1)}h</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!loading && !error && timesheetData && (
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

        {/* Entry Form Modal */}
        {showEntryForm && (
          <div className="timesheet-modal-overlay" onClick={closeEntryForm}>
            <div className="timesheet-modal timesheet-add-log-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{editingEntry ? 'Edit time entry' : 'Add time entry'}</h3>

              {editingEntry ? (
                <>
                  <div className="timesheet-form">
                    <label>
                      Task category *
                      <select
                        value={entryForm.task_category || 'Ticket'}
                        onChange={(e) => {
                          const nextCategory = e.target.value;
                          setEntryForm((prev) => ({
                            ...prev,
                            task_category: nextCategory,
                            ticket_id: nextCategory !== 'Ticket' ? '' : prev.ticket_id,
                            hours: nextCategory === 'Half Day Leave' ? '4' : prev.hours,
                          }));
                        }}
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
                        disabled={entryForm.task_category === 'Half Day Leave'}
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
                </>
              ) : (
                <>
                  {/* Section 1: Planned tasks for this day */}
                  <div className="add-log-section planned-tasks-section">
                    <h4>Planned tasks for this day</h4>
                    {loadingPlannedTasks ? (
                      <p className="planned-tasks-loading">Loading planned tasks…</p>
                    ) : plannedTasksForDay.length === 0 ? (
                      <p className="planned-tasks-empty">No planned tasks for this date.</p>
                    ) : (
                      <ul className="planned-tasks-list">
                        {plannedTasksForDay.map((task, idx) => (
                          <li key={`${task.source}-${task.id}-${idx}`} className="planned-task-item">
                            <div className="planned-task-info">
                              <span className="planned-task-ticket">{task.ticket_id ? `#${task.ticket_id}` : (task.activity_description || task.generic_category || 'Task').slice(0, 30)}</span>
                              <span className="planned-task-desc">{task.activity_description || task.ticket_title || ''}</span>
                              <span className="planned-task-hours">{task.hours}h planned</span>
                            </div>
                            <div className="planned-task-actions">
                              <button type="button" className="btn btn-small btn-ghost" onClick={() => handleAddFromPlannedAsIs(task)}>Add as-is</button>
                              <button type="button" className="btn btn-small" onClick={() => { setAddWithMyTimeTask(task); setAddWithMyTimeHours(String(task.hours)); setAddWithMyTimeVarianceNotes(''); setAddWithMyTimeReasonType(''); setAddWithMyTimeError(''); }}>Add with my time</button>
                            </div>
                            {addWithMyTimeTask && addWithMyTimeTask.id === task.id && (
                              <div className="add-with-my-time-form">
                                <label>
                                  Hours
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={addWithMyTimeHours}
                                    onChange={(e) => setAddWithMyTimeHours(e.target.value)}
                                  />
                                </label>
                                {Math.abs(parseFloat(addWithMyTimeHours || 0) - parseFloat(task.hours)) > 0.01 && (
                                  <>
                                    <label>
                                      Comment (variance reason) *
                                      <input
                                        type="text"
                                        value={addWithMyTimeVarianceNotes}
                                        onChange={(e) => setAddWithMyTimeVarianceNotes(e.target.value)}
                                        placeholder="Why do hours differ from planned?"
                                      />
                                    </label>
                                    <label>
                                      Reason type (optional)
                                      <select
                                        value={addWithMyTimeReasonType}
                                        onChange={(e) => setAddWithMyTimeReasonType(e.target.value)}
                                      >
                                        {VARIANCE_REASON_TYPES.map((opt) => (
                                          <option key={opt.value || 'empty'} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                    </label>
                                  </>
                                )}
                                {addWithMyTimeError && <span className="form-error">{addWithMyTimeError}</span>}
                                <div className="add-with-my-time-actions">
                                  <button type="button" className="btn btn-primary" onClick={handleAddWithMyTime}>Save</button>
                                  <button type="button" className="btn btn-ghost" onClick={() => { setAddWithMyTimeTask(null); setAddWithMyTimeHours(''); setAddWithMyTimeVarianceNotes(''); setAddWithMyTimeReasonType(''); setAddWithMyTimeError(''); }}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Section 2: Add manual log */}
                  <div className="add-log-section manual-log-section">
                    <h4>Add manual log</h4>
                    <div className="timesheet-form">
                      <label>
                        Task category *
                        <select
                          value={entryForm.task_category || 'Ticket'}
                          onChange={(e) => {
                            const nextCategory = e.target.value;
                            setEntryForm((prev) => ({
                              ...prev,
                              task_category: nextCategory,
                              ticket_id: nextCategory !== 'Ticket' ? '' : prev.ticket_id,
                              hours: nextCategory === 'Half Day Leave' ? '4' : prev.hours,
                            }));
                          }}
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
                          disabled={entryForm.task_category === 'Half Day Leave'}
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
                  </div>

                  <div className="timesheet-modal-actions">
                    <button className="btn btn-primary" onClick={handleSaveEntry}>Save manual entry</button>
                    <button className="btn btn-ghost" onClick={closeEntryForm}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}

export default TimeSheetModule;
