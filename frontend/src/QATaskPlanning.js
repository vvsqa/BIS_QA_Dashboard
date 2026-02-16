import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { formatDisplayDate, formatAPIDate, formatDisplayDateWithDay, formatPlanningWeek } from './dateUtils';
import { TicketExternalLink, getTicketTrackingUrl } from './ticketUtils';
import { useTableSort, SortableHeader } from './useTableSort';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import './DevelopmentTaskPlanning.css';
import './QATaskPlanning.css';
import './QATaskPlanningCalendarStyles.css';

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

const API_BASE = (process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:8000`).replace(/\/$/, '');
const HOURS_PER_WEEK = 40;
const TASK_CATEGORIES = ['Ticket', 'Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Miscellaneous', 'Generic Task', 'Regression', 'Live Testing'];
const GENERIC_CATEGORIES = ['Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Miscellaneous', 'Generic Task', 'Regression', 'Live Testing'];
const QA_TASK_TYPES = ['Manual Testing', 'Automation Testing', 'API Testing', 'Non-Functional Testing'];
const MAX_HOURS_PER_DAY_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];

function getWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// Priority colors (matches TicketsDashboard PRIORITY_ORDER)
const PRIORITY_COLORS = {
  'URGENT': '#dc2626',
  'High (Bugs)': '#ea580c',
  'High (Billable)': '#f97316',
  'EPIC!': '#d97706',
  'Medium (Bugs)': '#eab308',
  'High Level 1': '#f59e0b',
  'High Level 2': '#fbbf24',
  'High Level 3': '#facc15',
  'High Level 4': '#eab308',
  'Medium': '#22c55e',
  'Low': '#3b82f6',
  'Quote': '#8b5cf6',
  'Suggestion': '#94a3b8',
  'Unspecified': '#6b7280',
};

const TASK_CATEGORY_COLORS = {
  Ticket: '#60a5fa',
  'Team Meetings': '#a78bfa',
  'Customer Support': '#34d399',
  Training: '#fbbf24',
  KT: '#f97316',
  Leave: '#94a3b8',
  Miscellaneous: '#64748b',
  'Generic Task': '#0ea5e9',
  Regression: '#f43f5e',
  'Live Testing': '#22c55e',
  Other: '#64748b',
};

// Priority order for sorting
const PRIORITY_ORDER = [
  'URGENT', 'High (Bugs)', 'High (Billable)', 'EPIC!', 'Medium (Bugs)',
  'High Level 1', 'High Level 2', 'High Level 3', 'High Level 4',
  'Medium', 'Low', 'Quote', 'Suggestion', 'Unspecified'
];

// Status colors for cards
const STATUS_COLORS = {
  'QC Testing': '#a78bfa',
  'QC Testing in Progress': '#3b82f6',
  'QC Testing Hold': '#f59e0b',
};

function QATaskPlanning({ showParentTitle = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const urlTicketId = searchParams.get('ticket_id');
  const urlEmployeeId = searchParams.get('employee_id');

  const isEmployeeRole = user?.role === 'EMPLOYEE';
  const isLeadOrManager = user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD');
  const isLeadOnly = user?.role?.includes('LEAD') && !user?.role?.includes('MANAGER') && user?.role !== 'ADMIN';
  const isAdminOrManager = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');

  const [view, setView] = useState(isEmployeeRole ? 'my-tasks' : 'overview'); // overview | planner | calendar | my-tasks (employees only)
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Filters for overview
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [testerFilter, setTesterFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [planningFilter, setPlanningFilter] = useState(''); // 'planned' | 'not_planned' | ''

  // Selected category for dynamic table
  const [selectedCard, setSelectedCard] = useState(null); // { type: 'status'|'priority'|'tester', key: string }

  // Planner state
  const [weekStart, setWeekStart] = useState(() => formatAPIDate(getWeekMonday(new Date())));
  const [weekData, setWeekData] = useState(null);
  const [ticketsRaw, setTicketsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addTaskModalTab, setAddTaskModalTab] = useState('details'); // details | resource-blocked
  const [addTaskEmployee, setAddTaskEmployee] = useState(null);
  const [addTaskSelectedTesters, setAddTaskSelectedTesters] = useState([]); // multi-select when task_category is Ticket
  const [form, setForm] = useState({
    employee_name: '', 
    employee_id: '', 
    task_category: 'Ticket', 
    ticket_id: null, 
    ticket_id_input: '',
    task_type: '', 
    activity_description: '', 
    start_date: '', 
    total_hours: 8, 
    max_hours_per_day: 8, 
    generic_category: '',
    justification: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [lookedUpTicket, setLookedUpTicket] = useState(null);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketSearchDebounced, setTicketSearchDebounced] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState('');
  const [ticketAssigneeFilter, setTicketAssigneeFilter] = useState('');
  const [ticketUnassignedFilter, setTicketUnassignedFilter] = useState(false);
  const [hasEstimateFilter, setHasEstimateFilter] = useState(null);
  const [resourceFilter, setResourceFilter] = useState('all');
  const [plannerViewMode, setPlannerViewMode] = useState('grid');
  const [testerChartExpanded, setTesterChartExpanded] = useState(false);
  const [ticketLookupLoading, setTicketLookupLoading] = useState(false);
  const [ticketSuggestions, setTicketSuggestions] = useState([]);
  const [showTicketSuggestions, setShowTicketSuggestions] = useState(false);
  const [ticketSuggestionsCategorized, setTicketSuggestionsCategorized] = useState(null); // { next_in_queue, on_hold, for_retesting, ageing }
  const [ticketSuggestionsLoading, setTicketSuggestionsLoading] = useState(false);
  const [showInQc10List, setShowInQc10List] = useState(false);
  const ticketInputRef = useRef(null);
  const ticketSuggestionsRef = useRef(null);
  const [allocationPreview, setAllocationPreview] = useState(null);
  const [startDateAvailable, setStartDateAvailable] = useState(8);
  const [addTaskAvailabilitySummary, setAddTaskAvailabilitySummary] = useState(null); // { next_fully_available_date, partial_this_week }
  // Per-tester availability when multi-select: { [employee_id]: { availableOnStartDate, allocationError, employee_name } }
  const [selectedTestersAvailability, setSelectedTestersAvailability] = useState({});

  // Calendar day detail modal state
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [dayDetailEmployee, setDayDetailEmployee] = useState(null);
  const [dayDetailDate, setDayDetailDate] = useState(null);
  const [dayDetailTasks, setDayDetailTasks] = useState([]);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);

  // Multi-tester plan modal state
  const [multiPlanOpen, setMultiPlanOpen] = useState(false);
  const [multiPlanTicket, setMultiPlanTicket] = useState(null);
  const [multiPlanSelectedTesters, setMultiPlanSelectedTesters] = useState([]);
  const [multiPlanForm, setMultiPlanForm] = useState({
    task_type: '',
    activity_description: '',
    start_date: '',
    total_hours: 8,
    max_hours_per_day: 8,
  });
  const [multiPlanErrors, setMultiPlanErrors] = useState({});
  const [multiPlanSubmitting, setMultiPlanSubmitting] = useState(false);
  const [multiPlanResults, setMultiPlanResults] = useState(null);

  // Edit task modal (Manager / Lead)
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editTaskForm, setEditTaskForm] = useState({ start_date: '', total_hours: 8, max_hours_per_day: 8 });
  const [editTaskError, setEditTaskError] = useState(null);
  const [editTaskSubmitting, setEditTaskSubmitting] = useState(false);

  // Hold task modal state
  const [holdTaskOpen, setHoldTaskOpen] = useState(false);
  const [holdingTask, setHoldingTask] = useState(null);
  const [holdTaskForm, setHoldTaskForm] = useState({ hold_type: 'full', hold_reason: '', hold_date: '' });
  const [holdTaskError, setHoldTaskError] = useState(null);
  const [holdTaskSubmitting, setHoldTaskSubmitting] = useState(false);
  const [pmTrackerRefreshing, setPmTrackerRefreshing] = useState(false);

  // Calendar state
  const [calendarData, setCalendarData] = useState(null);
  const [calendarView, setCalendarView] = useState('weekly');
  const [plannerEmployeeSearch, setPlannerEmployeeSearch] = useState('');

  // QC Review Fail tab state
  const [qcReviewFailData, setQcReviewFailData] = useState(null);
  const [qcReviewFailLoading, setQcReviewFailLoading] = useState(false);

  const loadOverviewData = useCallback(async () => {
    setOverviewLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/overview`);
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.detail || msg;
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setOverviewData(data);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message || 'Failed to load QA overview data');
      setOverviewData((prev) => prev); // keep previous data so ETA Calendar can still show last load
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadQcReviewFailData = useCallback(async () => {
    setQcReviewFailLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/qc-review-fail`);
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.detail || msg;
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setQcReviewFailData(data);
    } catch (e) {
      setError(e.message || 'Failed to load QC Review Fail list');
      setQcReviewFailData(null);
    } finally {
      setQcReviewFailLoading(false);
    }
  }, []);

  const refreshFromPMTracker = async () => {
    setRefreshing(true);
    try {
      // Trigger PM Tracker sync
      await apiFetch(`${API_BASE}/pm-tracker/sync`, { method: 'POST' });
      // Wait a moment for sync to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Reload overview data
      await loadOverviewData();
    } catch (e) {
      setError('Failed to refresh from PM Tracker');
    } finally {
      setRefreshing(false);
    }
  };

  const loadWeekData = useCallback(async () => {
    if (!weekStart) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/week/${encodeURIComponent(weekStart)}`);
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      const data = await res.json();
      setWeekData(data);
    } catch (e) {
      setError(e.message || 'Failed to load week data');
      setWeekData(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  const loadTickets = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/tickets`);
      const data = res.ok ? await res.json() : { tickets: [] };
      setTicketsRaw(data.tickets || []);
    } catch (_) {
      setTicketsRaw([]);
    }
  }, []);

  const loadCalendarData = useCallback(async () => {
    setError(null);
    const dateParam = (weekStart || '').slice(0, calendarView === 'monthly' ? 7 : 10);
    if (!dateParam || dateParam.length < (calendarView === 'monthly' ? 7 : 10)) {
      setError('Please select a week or month.');
      return;
    }
    try {
      const params = new URLSearchParams({ view: calendarView });
      params.append(calendarView === 'weekly' ? 'date_str' : 'month_str', dateParam);
      const res = await apiFetch(`${API_BASE}/qa-planning/calendar?${params}`);
      if (!res.ok) {
        const errText = await res.text();
        let msg = errText;
        try {
          const j = JSON.parse(errText);
          msg = j.detail || msg;
        } catch (_) {}
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setCalendarData(data);
    } catch (e) {
      setCalendarData(null);
      const msg = e?.message || '';
      setError(msg.includes('fetch') ? 'Could not reach the server. Ensure the backend is running and try again.' : (msg || 'Failed to load calendar.'));
    }
  }, [calendarView, weekStart]);

  useEffect(() => {
    if (view === 'overview') loadOverviewData();
  }, [view, loadOverviewData]);
  useEffect(() => {
    if (view === 'planner' || view === 'resource-blocked' || view === 'overview' || view === 'my-tasks') loadWeekData();
  }, [view, weekStart, loadWeekData]);
  useEffect(() => {
    if (view === 'planner') loadTickets();
  }, [view, loadTickets]);
  useEffect(() => {
    const t = setTimeout(() => setTicketSearchDebounced(ticketSearch), 300);
    return () => clearTimeout(t);
  }, [ticketSearch]);
  useEffect(() => {
    if (view === 'calendar') loadCalendarData();
  }, [view, calendarView, weekStart, loadCalendarData]);
  useEffect(() => {
    if (view === 'qc-review-fail') loadQcReviewFailData();
  }, [view, loadQcReviewFailData]);

  // Sync view when user role is determined (e.g. user loads after mount)
  useEffect(() => {
    if (isEmployeeRole && view !== 'my-tasks') setView('my-tasks');
  }, [isEmployeeRole]);

  // When Add Task modal opens from a resource with Ticket category, ensure tester is pre-selected
  useEffect(() => {
    if (addTaskOpen && addTaskEmployee && form.task_category === 'Ticket' && addTaskSelectedTesters.length === 0) {
      setAddTaskSelectedTesters([addTaskEmployee.employee_id]);
    }
  }, [addTaskOpen, addTaskEmployee?.employee_id, form.task_category]);

  const ticketFilterOptions = useMemo(() => {
    const statuses = [...new Set(ticketsRaw.map((t) => t.status).filter(Boolean))].sort();
    const priorities = [...new Set(ticketsRaw.map((t) => t.priority).filter(Boolean))].sort();
    const assignees = [...new Set(ticketsRaw.map((t) => t.qc_tester).filter(Boolean))].sort();
    return { statuses, priorities, assignees };
  }, [ticketsRaw]);

  const filteredPlannerTickets = useMemo(() => {
    let list = ticketsRaw;
    const q = (ticketSearchDebounced || '').trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        String(t.ticket_id).includes(q) ||
        (t.title || '').toLowerCase().includes(q) ||
        (t.qc_tester || '').toLowerCase().includes(q)
      );
    }
    if (ticketStatusFilter) list = list.filter((t) => t.status === ticketStatusFilter);
    if (ticketPriorityFilter) list = list.filter((t) => t.priority === ticketPriorityFilter);
    if (ticketAssigneeFilter) list = list.filter((t) => t.qc_tester === ticketAssigneeFilter);
    if (ticketUnassignedFilter) list = list.filter((t) => !t.qc_tester);
    if (hasEstimateFilter !== null) {
      list = list.filter((t) => (t.qa_estimate_hours != null && t.qa_estimate_hours > 0) === hasEstimateFilter);
    }
    return list;
  }, [ticketsRaw, ticketSearchDebounced, ticketStatusFilter, ticketPriorityFilter, ticketAssigneeFilter, ticketUnassignedFilter, hasEstimateFilter]);

  // Ticket suggestions dropdown
  useEffect(() => {
    const q = (form.ticket_id_input || '').trim();
    if (!q || form.task_category !== 'Ticket') {
      setTicketSuggestions([]);
      setShowTicketSuggestions(false);
      return;
    }
    if (form.ticket_id) {
      setShowTicketSuggestions(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: q });
        if (addTaskEmployee?.employee_name) {
          params.set('assignee', addTaskEmployee.employee_name);
        }
        const res = await apiFetch(`${API_BASE}/qa-planning/tickets?${params}`);
        const data = res.ok ? await res.json() : { tickets: [] };
        const list = (data.tickets || []).slice(0, 12);
        setTicketSuggestions(list);
        setShowTicketSuggestions(list.length > 0);
      } catch (_) {
        setTicketSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [form.ticket_id_input, form.task_category, form.ticket_id, addTaskEmployee?.employee_name]);

  // Fetch categorized ticket suggestions when Add Task modal is open with Ticket category
  useEffect(() => {
    if (!addTaskOpen || form.task_category !== 'Ticket' || form.ticket_id) {
      setTicketSuggestionsCategorized(null);
      return;
    }
    const assignee = addTaskSelectedTesters.length > 0
      ? (weekData?.employees || []).find((e) => e.employee_id === addTaskSelectedTesters[0])?.employee_name
      : addTaskEmployee?.employee_name;
    setTicketSuggestionsLoading(true);
    const params = assignee ? `?assignee=${encodeURIComponent(assignee)}` : '';
    apiFetch(`${API_BASE}/qa-planning/ticket-suggestions${params}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        setTicketSuggestionsCategorized(data || { next_in_queue: [], on_hold: [], for_retesting: [], ageing: [] });
      })
      .catch(() => setTicketSuggestionsCategorized(null))
      .finally(() => setTicketSuggestionsLoading(false));
  }, [addTaskOpen, form.task_category, form.ticket_id, addTaskEmployee?.employee_name, addTaskSelectedTesters, weekData?.employees]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClick = (e) => {
      if (ticketInputRef.current?.contains(e.target) || ticketSuggestionsRef.current?.contains(e.target)) return;
      setShowTicketSuggestions(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [addTaskOpen]);

  // When Add Task opens, set default start_date to next available date for the employee
  useEffect(() => {
    if (!addTaskOpen || !addTaskEmployee || !weekStart) return;
    const emp = addTaskEmployee;
    const from = weekStart;
    let cancelled = false;
    apiFetch(`/qa-planning/next-available-date?employee_name=${encodeURIComponent(emp.employee_name)}&from_date=${from}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data?.date) return;
        setForm((f) => ({ ...f, start_date: data.date }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [addTaskOpen, addTaskEmployee, weekStart]);

  // Fetch availability summary (fully + partial this week) when Add Task opens
  useEffect(() => {
    if (!addTaskOpen || !addTaskEmployee || !weekStart) {
      setAddTaskAvailabilitySummary(null);
      return;
    }
    const emp = addTaskEmployee;
    let cancelled = false;
    apiFetch(`/qa-planning/availability-summary?employee_name=${encodeURIComponent(emp.employee_name)}&week_start=${weekStart}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        setAddTaskAvailabilitySummary(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [addTaskOpen, addTaskEmployee, weekStart]);

  // Resolve preview employee: first selected tester for Ticket, else addTaskEmployee
  const previewEmployee = form.task_category === 'Ticket' && addTaskSelectedTesters.length > 0
    ? (weekData?.employees || []).find((e) => e.employee_id === addTaskSelectedTesters[0])
    : addTaskEmployee;

  // Fetch available hours and allocation preview (single or multi-tester)
  useEffect(() => {
    if (!addTaskOpen || !form.start_date || !weekStart) {
      setStartDateAvailable(8);
      setAllocationPreview(null);
      setSelectedTestersAvailability({});
      return;
    }
    const hours = Number(form.total_hours);
    const maxPerDay = form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8;
    const isMultiTester = form.task_category === 'Ticket' && addTaskSelectedTesters.length > 0;
    const employees = weekData?.employees || [];
    const targetEmps = isMultiTester
      ? addTaskSelectedTesters.map((id) => employees.find((e) => e.employee_id === id)).filter(Boolean)
      : (previewEmployee || addTaskEmployee) ? [previewEmployee || addTaskEmployee] : [];

    if (targetEmps.length === 0) {
      setStartDateAvailable(8);
      setAllocationPreview(null);
      setSelectedTestersAvailability({});
      return;
    }

    if (form.total_hours == null || form.total_hours === '' || isNaN(hours) || hours < 0.5) {
      setAllocationPreview(null);
      if (!isMultiTester) setStartDateAvailable(8);
      return;
    }

    let cancelled = false;

    if (isMultiTester && targetEmps.length > 0) {
      // Fetch for each selected tester in parallel
      const fetchOne = async (emp) => {
        const [availRes, allocRes] = await Promise.all([
          apiFetch(`${API_BASE}/qa-planning/available-hours?employee_name=${encodeURIComponent(emp.employee_name)}&date=${form.start_date}`),
          apiFetch(`${API_BASE}/qa-planning/allocation-preview?employee_name=${encodeURIComponent(emp.employee_name)}&start_date=${form.start_date}&total_hours=${hours}&max_hours_per_day=${maxPerDay}&week_start=${weekStart}`),
        ]);
        const availData = availRes.ok ? await availRes.json() : null;
        const allocData = await allocRes.json().catch(() => ({}));
        const allocOk = allocRes.ok && !allocData.error;
        const allocationError = allocOk ? null : (allocData.error || allocData.detail || 'Cannot fit hours');
        return {
          employee_id: emp.employee_id,
          employee_name: emp.employee_name,
          availableOnStartDate: availData?.available_hours ?? 8,
          allocationError,
          distribution: allocOk ? allocData.distribution : null,
        };
      };

      Promise.all(targetEmps.map(fetchOne)).then((results) => {
        if (cancelled) return;
        const byId = {};
        let firstDistribution = null;
        const failed = [];
        results.forEach((r) => {
          byId[r.employee_id] = {
            availableOnStartDate: r.availableOnStartDate,
            allocationError: r.allocationError,
            employee_name: r.employee_name,
          };
          if (r.distribution) firstDistribution = firstDistribution || r.distribution;
          if (r.allocationError) failed.push(`${r.employee_name}: ${r.allocationError}`);
        });
        setSelectedTestersAvailability(byId);
        const minAvail = Math.min(...results.map((r) => r.availableOnStartDate));
        setStartDateAvailable(minAvail);
        if (minAvail <= 0 && firstDistribution && firstDistribution.length > 0) {
          const nextDate = firstDistribution[0]?.date;
          if (nextDate && nextDate !== form.start_date) {
            setForm((prev) => ({ ...prev, start_date: nextDate }));
          }
        }
        if (failed.length > 0) {
          setAllocationPreview({ error: failed.join('; '), distribution: firstDistribution });
        } else {
          setAllocationPreview({
            distribution: firstDistribution || [],
            total: firstDistribution ? firstDistribution.reduce((s, d) => s + (d.hours || 0), 0) : hours,
          });
        }
      }).catch(() => {
        if (!cancelled) setSelectedTestersAvailability({});
      });
    } else {
      // Single employee
      const emp = targetEmps[0];
      Promise.all([
        apiFetch(`${API_BASE}/qa-planning/available-hours?employee_name=${encodeURIComponent(emp.employee_name)}&date=${form.start_date}`).then((r) => r.ok ? r.json() : null),
        apiFetch(`${API_BASE}/qa-planning/allocation-preview?employee_name=${encodeURIComponent(emp.employee_name)}&start_date=${form.start_date}&total_hours=${hours}&max_hours_per_day=${maxPerDay}&week_start=${weekStart}`).then((r) => r.json().then((d) => ({ ok: r.ok, data: d }))),
      ]).then(([availData, allocResult]) => {
        if (cancelled) return;
        const availableOnStart = availData?.available_hours ?? 8;
        setStartDateAvailable(availableOnStart);
        if (allocResult.ok && !allocResult.data.error) {
          const distribution = allocResult.data.distribution || [];
          setAllocationPreview({ distribution, total: allocResult.data.total });
          if (availableOnStart <= 0 && distribution.length > 0) {
            const nextDate = distribution[0]?.date;
            if (nextDate && nextDate !== form.start_date) {
              setForm((prev) => ({ ...prev, start_date: nextDate }));
            }
          }
          if (allocResult.data.max_available_on_start_date != null) setStartDateAvailable(allocResult.data.max_available_on_start_date);
        } else {
          setAllocationPreview({ error: allocResult.data.error || allocResult.data.detail || 'Cannot fit hours' });
        }
      }).catch(() => {
        if (!cancelled) setAllocationPreview(null);
      });
    }

    return () => { cancelled = true; };
  }, [addTaskOpen, addTaskEmployee, previewEmployee, form.start_date, form.total_hours, form.max_hours_per_day, form.employee_name, form.task_category, form.ticket_id, addTaskSelectedTesters, weekStart, weekData?.employees]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const queue = overviewData?.queue || [];
    const priorities = [...new Set(queue.map(t => t.priority).filter(Boolean))];
    const testers = [...new Set(queue.map(t => t.qc_tester).filter(Boolean))];
    const modules = [...new Set(queue.map(t => t.module).filter(Boolean))];
    const statuses = [...new Set(queue.map(t => t.status).filter(Boolean))];
    const platforms = [...new Set(queue.map(t => t.platform || 'Web').filter(Boolean))].sort();
    return { priorities, testers, modules, statuses, platforms };
  }, [overviewData]);

  // Filter tickets based on all filters
  const filteredQueue = useMemo(() => {
    let queue = overviewData?.queue || [];
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      queue = queue.filter(t => 
        String(t.ticket_id).includes(q) ||
        (t.title || '').toLowerCase().includes(q) ||
        (t.qc_tester || '').toLowerCase().includes(q) ||
        (t.module || '').toLowerCase().includes(q)
      );
    }
    
    if (priorityFilter) {
      queue = queue.filter(t => t.priority === priorityFilter);
    }
    
    if (testerFilter) {
      queue = queue.filter(t => t.qc_tester === testerFilter);
    }
    
    if (moduleFilter) {
      queue = queue.filter(t => t.module === moduleFilter);
    }
    
    if (statusFilter) {
      queue = queue.filter(t => t.status === statusFilter);
    }
    
    if (platformFilter) {
      queue = queue.filter(t => (t.platform || 'Web') === platformFilter);
    }
    
    if (planningFilter === 'planned') {
      queue = queue.filter(t => t.qa_estimate_hours != null && t.qa_estimate_hours > 0);
    } else if (planningFilter === 'not_planned') {
      queue = queue.filter(t => t.qa_estimate_hours == null || t.qa_estimate_hours === 0);
    }
    
    if (selectedCard) {
      if (selectedCard.type === 'status') {
        queue = queue.filter(t => t.status === selectedCard.key);
      } else if (selectedCard.type === 'priority') {
        queue = queue.filter(t => t.priority === selectedCard.key);
      } else if (selectedCard.type === 'tester') {
        queue = queue.filter(t => t.qc_tester === selectedCard.key);
      } else if (selectedCard.type === 'planning') {
        if (selectedCard.key === 'not_planned') {
          queue = queue.filter(t => t.qa_estimate_hours == null || t.qa_estimate_hours === 0);
        } else if (selectedCard.key === 'planned') {
          queue = queue.filter(t => t.qa_estimate_hours != null && t.qa_estimate_hours > 0);
        }
      }
    }
    
    return queue;
  }, [overviewData, searchQuery, priorityFilter, testerFilter, moduleFilter, statusFilter, platformFilter, planningFilter, selectedCard]);

  // Ticket IDs planned in the current week (for "Active tickets for ongoing week" table)
  const activeTicketIdsThisWeek = useMemo(() => {
    const tasks = weekData?.tasks || [];
    return new Set(tasks.map((t) => t.ticket_id).filter(Boolean));
  }, [weekData?.tasks]);

  // Pending priority queue: tickets with no QC tester assigned
  const pendingQueue = useMemo(() => filteredQueue.filter((t) => !(t.qc_tester || '').trim()), [filteredQueue]);
  // Pending not yet marked as tested by Dev (show in first table)
  const pendingNotTestedByDev = useMemo(() => pendingQueue.filter((t) => !t.tested_by_dev), [pendingQueue]);
  // Pending that are marked Tested by Dev (show in second table)
  const pendingTestedByDev = useMemo(() => pendingQueue.filter((t) => t.tested_by_dev), [pendingQueue]);
  // Assigned tickets: tickets that have a QC tester
  const assignedQueue = useMemo(() => filteredQueue.filter((t) => (t.qc_tester || '').trim()), [filteredQueue]);

  const { sortedData: sortedPendingNotTestedByDev, sortConfig: sortPendingNotTested, handleSort: handleSortPendingNotTested } = useTableSort(pendingNotTestedByDev, { defaultSortKey: 'ticket_id', defaultSortDirection: 'asc' });
  const { sortedData: sortedPendingTestedByDev, sortConfig: sortPendingTested, handleSort: handleSortPendingTested } = useTableSort(pendingTestedByDev, { defaultSortKey: 'ticket_id', defaultSortDirection: 'asc' });
  const { sortedData: sortedAssignedQueue, sortConfig: sortAssigned, handleSort: handleSortAssigned } = useTableSort(assignedQueue, { defaultSortKey: 'ticket_id', defaultSortDirection: 'asc' });
  const qcReviewFailTickets = qcReviewFailData?.tickets || [];
  const { sortedData: sortedQcReviewFailTickets, sortConfig: sortQcReviewFail, handleSort: handleSortQcReviewFail } = useTableSort(qcReviewFailTickets, { defaultSortKey: 'days_in_fail', defaultSortDirection: 'desc' });

  // Active tickets for ongoing week: tickets that appear in this week's planned tasks
  const activeThisWeekQueue = useMemo(
    () => filteredQueue.filter((t) => t.ticket_id && activeTicketIdsThisWeek.has(t.ticket_id)),
    [filteredQueue, activeTicketIdsThisWeek]
  );

  // Statistics for charts
  const chartData = useMemo(() => {
    const queue = overviewData?.queue || [];
    
    const priorityCounts = {};
    queue.forEach(t => {
      const p = t.priority || 'Unspecified';
      priorityCounts[p] = (priorityCounts[p] || 0) + 1;
    });
    
    const testerCounts = {};
    queue.forEach(t => {
      const tester = t.qc_tester || 'Unassigned';
      testerCounts[tester] = (testerCounts[tester] || 0) + 1;
    });

    // Current assigned tasks from QA planner (for Tester Workload chart)
    const plannerTaskCounts = {};
    const plannerTasks = weekData?.tasks || [];
    plannerTasks.forEach(t => {
      const emp = t.employee_name || 'Unknown';
      plannerTaskCounts[emp] = (plannerTaskCounts[emp] || 0) + 1;
    });
    
    const statusCounts = {};
    queue.forEach(t => {
      const s = t.status || 'Unknown';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    
    const planned = queue.filter(t => t.qa_estimate_hours != null && t.qa_estimate_hours > 0).length;
    const notPlanned = queue.length - planned;
    
    return { priorityCounts, testerCounts, plannerTaskCounts, statusCounts, planned, notPlanned };
  }, [overviewData, weekData]);

  // Priority chart data
  const priorityChartData = useMemo(() => {
    const sortedPriorities = Object.entries(chartData.priorityCounts)
      .sort((a, b) => {
        const idxA = PRIORITY_ORDER.indexOf(a[0]);
        const idxB = PRIORITY_ORDER.indexOf(b[0]);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
    
    return {
      labels: sortedPriorities.map(([p]) => p),
      datasets: [{
        data: sortedPriorities.map(([, c]) => c),
        backgroundColor: sortedPriorities.map(([p]) => PRIORITY_COLORS[p] || '#6b7280'),
        borderWidth: 0,
      }]
    };
  }, [chartData.priorityCounts]);

  // Tester workload chart – use testerCounts (tickets by QC tester) for full QA team; fallback to plannerTaskCounts
  const testerChartData = useMemo(() => {
    const counts = Object.keys(chartData.testerCounts || {}).length > 0
      ? chartData.testerCounts
      : (chartData.plannerTaskCounts || {});
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1]);
    const limit = testerChartExpanded ? sorted.length : 8;
    const sliced = sorted.slice(0, limit);
    
    return {
      labels: sliced.map(([t]) => (t.split(' ')[0] || t).slice(0, 20)),
      datasets: [{
        label: 'Assigned tasks',
        data: sliced.map(([, c]) => c),
        backgroundColor: '#22c55e',
        borderRadius: 4,
      }]
    };
  }, [chartData.plannerTaskCounts, chartData.testerCounts, testerChartExpanded]);

  const testerChartTotalCount = Object.keys(
    Object.keys(chartData.testerCounts || {}).length > 0 ? chartData.testerCounts : (chartData.plannerTaskCounts || {})
  ).length;
  const testerChartHasMore = testerChartTotalCount > 8;

  // Planning status chart data
  const planningChartData = useMemo(() => ({
    labels: ['Planned', 'Not Planned'],
    datasets: [{
      data: [chartData.planned, chartData.notPlanned],
      backgroundColor: ['#22c55e', '#ef4444'],
      borderWidth: 0,
    }]
  }), [chartData.planned, chartData.notPlanned]);

  const handleCardClick = (type, key, label) => {
    if (selectedCard?.type === type && selectedCard?.key === key) {
      setSelectedCard(null);
    } else {
      setSelectedCard({ type, key, label });
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setPriorityFilter('');
    setTesterFilter('');
    setModuleFilter('');
    setStatusFilter('');
    setPlatformFilter('');
    setPlanningFilter('');
    setSelectedCard(null);
  };

  const goToTicket = (ticketId) => {
    navigate(`/tickets?ticket=${ticketId}`);
  };

  const setTestedByDev = async (ticketId, testedByDev) => {
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/ticket/${ticketId}/tested-by-dev`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tested_by_dev: testedByDev }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to update');
      await loadOverviewData();
    } catch (e) {
      setError(e?.message || 'Failed to update Tested by Dev flag');
    }
  };

  const releaseQAResource = async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/task/${taskId}/release-resource`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to release resource');
      await loadWeekData();
    } catch (e) {
      setError(e?.message || 'Failed to release QA resource');
    }
  };

  // Hold task - open modal for reason input
  const openHoldTaskModal = (task) => {
    setHoldingTask(task);
    setHoldTaskForm({ hold_type: 'full', hold_reason: '', hold_date: '' });
    setHoldTaskError(null);
    setHoldTaskOpen(true);
  };

  const closeHoldTaskModal = () => {
    setHoldTaskOpen(false);
    setHoldingTask(null);
    setHoldTaskForm({ hold_type: 'full', hold_reason: '', hold_date: '' });
    setHoldTaskError(null);
  };

  // Refresh PM Tracker data for a specific ticket
  const refreshPmTrackerForTicket = async (ticketId) => {
    setPmTrackerRefreshing(true);
    setHoldTaskError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/refresh-pm-tracker?ticket_id=${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to refresh PM Tracker');
      const data = await res.json();
      if (data.ticket) {
        if (data.ticket.is_hold_status) {
          setHoldTaskError(null);
        } else {
          setHoldTaskError(`Ticket status in PM Tracker is "${data.ticket.status}". Please update to "QC Testing Hold" in PM Tracker first.`);
        }
      }
      return data;
    } catch (e) {
      setHoldTaskError(e?.message || 'Failed to refresh PM Tracker');
      return null;
    } finally {
      setPmTrackerRefreshing(false);
    }
  };

  // Submit hold task
  const submitHoldTask = async (e) => {
    e.preventDefault();
    if (!holdingTask) return;
    if (!holdTaskForm.hold_reason.trim()) {
      setHoldTaskError('Please provide a reason for putting this task on hold.');
      return;
    }
    if (holdTaskForm.hold_type === 'day' && !holdTaskForm.hold_date) {
      setHoldTaskError('Please select a date for day-level hold.');
      return;
    }
    setHoldTaskSubmitting(true);
    setHoldTaskError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/task/${holdingTask.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hold_type: holdTaskForm.hold_type,
          hold_reason: holdTaskForm.hold_reason.trim(),
          hold_date: holdTaskForm.hold_type === 'day' ? holdTaskForm.hold_date : null,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to put task on hold');
      }
      closeHoldTaskModal();
      await loadWeekData();
    } catch (e) {
      setHoldTaskError(e?.message || 'Failed to put task on hold');
    } finally {
      setHoldTaskSubmitting(false);
    }
  };

  // Resume a held task
  const resumeTask = async (taskId) => {
    if (!window.confirm('Resume this task and remove it from hold?')) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/task/${taskId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to resume task');
      await loadWeekData();
    } catch (e) {
      setError(e?.message || 'Failed to resume task');
    } finally {
      setActionLoading(false);
    }
  };

  // Refresh all PM Tracker data (for refresh button in header)
  const refreshAllPmTracker = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/refresh-pm-tracker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to refresh PM Tracker');
      const data = await res.json();
      setLastRefresh(new Date());
      // Reload overview data to get fresh ticket statuses
      await loadOverviewData();
      return data;
    } catch (e) {
      setError(e?.message || 'Failed to refresh PM Tracker');
      return null;
    } finally {
      setRefreshing(false);
    }
  };

  // Open multi-plan modal for a ticket
  const openMultiPlanModal = (ticket) => {
    setMultiPlanTicket(ticket);
    setMultiPlanSelectedTesters([]);
    setMultiPlanForm({
      task_type: '',
      activity_description: ticket.title || '',
      start_date: weekStart,
      total_hours: ticket.qa_estimate_hours || 8,
      max_hours_per_day: 8,
    });
    setMultiPlanErrors({});
    setMultiPlanResults(null);
    setMultiPlanOpen(true);
  };

  const closeMultiPlanModal = () => {
    setMultiPlanOpen(false);
    setMultiPlanTicket(null);
    setMultiPlanSelectedTesters([]);
    setMultiPlanResults(null);
  };

  const toggleMultiPlanTester = (empId) => {
    setMultiPlanSelectedTesters((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const validateMultiPlanForm = () => {
    const err = {};
    if (multiPlanSelectedTesters.length === 0) err.testers = 'Select at least one tester';
    if (!(multiPlanForm.task_type || '').trim()) err.task_type = 'Task Type is required';
    if (!multiPlanForm.activity_description?.trim()) err.activity_description = 'Task description is required';
    if (!multiPlanForm.start_date) err.start_date = 'Start date is required';
    // QA Estimate and QC Tester are mandatory for ticket tasks
    if (multiPlanTicket) {
      if (multiPlanTicket.qa_estimate_hours == null || multiPlanTicket.qa_estimate_hours <= 0) {
        err.ticket = 'QA Estimate is required. Update the ticket estimate before assigning.';
      } else if (!(multiPlanTicket.qc_tester || '').trim()) {
        err.ticket = 'QC Tester is required in PM Tracker. Assign and refresh.';
      }
    }
    const totalHours = Number(multiPlanForm.total_hours);
    if (isNaN(totalHours) || totalHours < 0.5) err.total_hours = 'Duration must be at least 0.5 hours';
    const maxH = Number(multiPlanForm.max_hours_per_day);
    if (isNaN(maxH) || maxH < 0.5 || maxH > 8) err.max_hours_per_day = 'Max hours must be 0.5–8';
    setMultiPlanErrors(err);
    return Object.keys(err).length === 0;
  };

  const submitMultiPlan = async (e) => {
    e.preventDefault();
    if (!validateMultiPlanForm()) return;
    setMultiPlanSubmitting(true);
    setMultiPlanErrors({});

    const results = { success: [], failed: [] };
    const employees = weekData?.employees || [];
    const selectedEmps = employees.filter((emp) => multiPlanSelectedTesters.includes(emp.employee_id));

    // Helper function to create task with retry on network errors
    const createTaskWithRetry = async (body, maxRetries = 2) => {
      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
          
          const res = await apiFetch(`${API_BASE}/qa-planning/tasks?week_start=${weekStart}`, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          
          const data = await res.json().catch(() => ({}));
          return { res, data };
        } catch (err) {
          lastError = err;
          const isNetworkError = err.name === 'TypeError' || err.name === 'AbortError';
          if (!isNetworkError || attempt >= maxRetries) {
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      throw lastError;
    };

    for (const emp of selectedEmps) {
      try {
        const body = {
          employee_name: emp.employee_name,
          employee_id: emp.employee_id,
          task_category: 'Ticket',
          ticket_id: multiPlanTicket.ticket_id,
          task_type: multiPlanForm.task_type || undefined,
          activity_description: multiPlanForm.activity_description.trim(),
          start_date: multiPlanForm.start_date,
          total_hours: Number(multiPlanForm.total_hours),
          max_hours_per_day: Number(multiPlanForm.max_hours_per_day),
        };
        
        const { res, data } = await createTaskWithRetry(body);
        
        if (res.ok) {
          results.success.push({ employee: emp.employee_name, task: data.task });
        } else {
          results.failed.push({ employee: emp.employee_name, error: data.detail || 'Failed' });
        }
      } catch (err) {
        const errorMsg = err.name === 'AbortError' 
          ? 'Request timed out. Please try again.' 
          : (err.message || 'Network error');
        results.failed.push({ employee: emp.employee_name, error: errorMsg });
      }
    }

    setMultiPlanResults(results);
    setMultiPlanSubmitting(false);

    if (results.success.length > 0) {
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    }
  };

  const assignTicket = async (ticket) => {
    if (view !== 'planner') setView('planner');
    if (!weekData) {
      await loadWeekData();
    }
    openMultiPlanModal(ticket);
  };

  const ensureWeek = async () => {
    setActionLoading(true);
    try {
      await apiFetch(`${API_BASE}/qa-planning/week?week_start=${weekStart}`, { method: 'POST' });
      await loadWeekData();
    } finally {
      setActionLoading(false);
    }
  };

  const updateWeekState = async (state) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/week/${weekStart}`, {
        method: 'PATCH',
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      await loadWeekData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const getInitialFormState = (emp, monday) => ({
    employee_name: emp?.employee_name || '',
    employee_id: emp?.employee_id || '',
    task_category: 'Ticket',
    ticket_id: null,
    ticket_id_input: '',
    task_type: 'Manual Testing',
    activity_description: '',
    start_date: formatAPIDate(new Date()), // Default to current date
    total_hours: 8,
    max_hours_per_day: 8,
    generic_category: '',
    justification: '',
  });

  const toggleAddTaskTester = (empId) => {
    setAddTaskSelectedTesters((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const openAddTask = (emp) => {
    setAddTaskEmployee(emp);
    setAddTaskSelectedTesters(emp ? [emp.employee_id] : []);
    const monday = weekStart;
    setForm({
      ...getInitialFormState(emp, monday),
      task_category: 'Ticket',
      ticket_id: null,
      ticket_id_input: '',
      generic_category: '',
    });
    setLookedUpTicket(null);
    setTicketSuggestions([]);
    setShowTicketSuggestions(false);
    setFormErrors({});
    setAllocationPreview(null);
    setStartDateAvailable(8);
    setAddTaskModalTab('details');
    setAddTaskOpen(true);
  };

  const closeAddTask = () => {
    setAddTaskOpen(false);
    setAddTaskEmployee(null);
    setAddTaskSelectedTesters([]);
    setSelectedTestersAvailability({});
    setForm(getInitialFormState(null, ''));
    setLookedUpTicket(null);
    setTicketSuggestions([]);
    setTicketSuggestionsCategorized(null);
    setShowTicketSuggestions(false);
    setFormErrors({});
    setAllocationPreview(null);
    setStartDateAvailable(8);
    setAddTaskAvailabilitySummary(null);
  };

  const fetchTicketDetails = useCallback(async (ticketId) => {
    setTicketLookupLoading(true);
    setFormErrors((e) => ({ ...e, ticket_id: null }));
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/ticket/${ticketId}`);
      const data = res.ok ? await res.json() : null;
      setLookedUpTicket(data);
      if (data) {
        setForm((f) => ({ 
          ...f, 
          ticket_id: ticketId, 
          activity_description: data.title || f.activity_description,
          total_hours: data.qa_estimate_hours || f.total_hours,
        }));
      } else {
        setFormErrors((e) => ({ ...e, ticket_id: 'Ticket not found. Enter a valid ID or use Refresh from PM.' }));
      }
    } catch (_) {
      setLookedUpTicket(null);
      setFormErrors((e) => ({ ...e, ticket_id: 'Failed to fetch ticket details' }));
    } finally {
      setTicketLookupLoading(false);
    }
  }, []);

  /** Refresh: fetch this ticket only from PM API and reload details (faster than full sync). */
  const refreshTicketFromPM = useCallback(async (ticketId) => {
    const id = ticketId != null ? Number(ticketId) : null;
    if (id == null || Number.isNaN(id)) return;
    setTicketLookupLoading(true);
    setFormErrors((e) => ({ ...e, ticket_id: null }));
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/ticket/${id}/refresh`, { method: 'POST' });
      let data = null;
      let errorDetail = null;
      try {
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (res.ok) data = body;
        else errorDetail = body?.detail || body?.message || (res.status === 400 ? 'Invalid ticket ID' : 'Ticket not found. Try Refresh from PM.');
      } catch (_) {
        if (res.ok) {
          data = null;
          errorDetail = 'Invalid response from server';
        } else {
          errorDetail = res.status === 400 ? 'Invalid ticket ID' : 'Failed to refresh ticket from PM';
        }
      }
      setLookedUpTicket(data);
      if (data) {
        setForm((f) => ({
          ...f,
          ticket_id: data.ticket_id ?? id,
          activity_description: data.title || f.activity_description,
          total_hours: data.qa_estimate_hours ?? f.total_hours,
        }));
      } else if (errorDetail) {
        setFormErrors((e) => ({ ...e, ticket_id: errorDetail }));
      }
    } catch (e) {
      setLookedUpTicket(null);
      setFormErrors((e) => ({ ...e, ticket_id: e.message || 'Failed to refresh ticket from PM' }));
    } finally {
      setTicketLookupLoading(false);
    }
  }, []);

  const selectTicket = useCallback((ticket) => {
    setForm((f) => ({ ...f, ticket_id: ticket.ticket_id, ticket_id_input: String(ticket.ticket_id) }));
    setShowTicketSuggestions(false);
    setTicketSuggestions([]);
    fetchTicketDetails(ticket.ticket_id);
  }, [fetchTicketDetails]);

  const validateForm = () => {
    const err = {};
    if (!form.task_category) err.task_category = 'Task category is required';
    if (!form.activity_description?.trim()) err.activity_description = 'Task description is required';
    if (!form.start_date) err.start_date = 'Start date is required';
    
    if (form.task_category === 'Ticket') {
      // Tester is pre-selected when opening from a resource; only require selection when neither is set
      const hasTester = addTaskSelectedTesters.length > 0 || addTaskEmployee;
      if (!hasTester) err.testers = 'Select at least one tester';
      if (!form.ticket_id) err.ticket_id = 'Select a ticket or type a ticket ID and press Enter';
      if (lookedUpTicket) {
        const inQcStatus = lookedUpTicket.in_qc_status !== false;
        if (inQcStatus) {
          if (lookedUpTicket.qa_estimate_hours == null || lookedUpTicket.qa_estimate_hours <= 0) {
            err.ticket_id = 'QA Estimate is required in PM Tracker. Add it and click Refresh.';
          } else if (!(lookedUpTicket.qc_tester || '').trim()) {
            err.ticket_id = 'QC Tester is required in PM Tracker. Assign and click Refresh.';
          } else {
            if (!form.task_type) err.task_type = 'Task Type is required';
          }
        } else {
          if (!form.task_type) err.task_type = 'Task Type is required';
        }
      }
    }
    
    const totalHoursNum = form.total_hours != null && form.total_hours !== '' ? Number(form.total_hours) : NaN;
    if (form.total_hours == null || form.total_hours === '' || isNaN(totalHoursNum)) {
      err.total_hours = 'Duration is required';
    } else if (totalHoursNum < 0.5) {
      err.total_hours = 'Duration must be at least 0.5 hours';
    }
    
    // Remaining QA hours is informational only - do not block task creation
    
    const maxH = form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8;
    if (isNaN(maxH) || maxH < 0.5 || maxH > 8 || !MAX_HOURS_PER_DAY_OPTIONS.includes(maxH)) {
      err.max_hours_per_day = 'Select max hours per day (0.5–8h)';
    }
    
    if (allocationPreview?.error) {
      err.submit = allocationPreview.error;
    }
    
    setFormErrors(err);
    return Object.keys(err).length === 0;
  };

  const submitAddTask = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);
    setError(null);
    setFormErrors({});
    const employees = weekData?.employees || [];
    const targetEmployees = form.task_category === 'Ticket'
      ? (addTaskSelectedTesters.length > 0
          ? employees.filter((emp) => addTaskSelectedTesters.includes(emp.employee_id))
          : addTaskEmployee ? [addTaskEmployee] : [])
      : (addTaskEmployee ? [addTaskEmployee] : []);

    if (targetEmployees.length === 0) {
      setFormErrors({ testers: form.task_category === 'Ticket' ? 'Select at least one tester' : 'No employee selected' });
      setSubmitting(false);
      return;
    }

    const results = { success: 0, failed: [] };
    
    // Helper function to create task with retry on network errors
    const createTaskWithRetry = async (body, maxRetries = 2) => {
      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
          
          const res = await apiFetch(`${API_BASE}/qa-planning/tasks?week_start=${weekStart}`, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          
          let data = {};
          try {
            data = await res.json();
          } catch (_) {
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
          }
          
          return { res, data };
        } catch (err) {
          lastError = err;
          // Only retry on network errors (not server errors)
          const isNetworkError = err.name === 'TypeError' || err.name === 'AbortError';
          if (!isNetworkError || attempt >= maxRetries) {
            throw err;
          }
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      throw lastError;
    };
    
    for (const emp of targetEmployees) {
      try {
        const body = {
          employee_name: emp.employee_name,
          employee_id: emp.employee_id || undefined,
          task_category: form.task_category,
          ticket_id: form.task_category === 'Ticket' ? form.ticket_id : undefined,
          task_type: form.task_category === 'Ticket' ? (form.task_type || undefined) : undefined,
          activity_description: form.activity_description.trim(),
          start_date: form.start_date,
          total_hours: form.total_hours != null ? Number(form.total_hours) : undefined,
          max_hours_per_day: form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8,
          generic_category: form.task_category !== 'Ticket' ? form.task_category : undefined,
          justification: form.justification?.trim() || undefined,
        };
        
        const { res, data } = await createTaskWithRetry(body);
        
        if (res.ok) {
          results.success += 1;
        } else {
          const detail = data.detail;
          const msg = typeof detail === 'string' ? detail : (detail && typeof detail === 'object' ? (detail.message || JSON.stringify(detail)) : 'Failed');
          results.failed.push({ employee: emp.employee_name, error: msg });
        }
      } catch (err) {
        const errorMsg = err.name === 'AbortError' 
          ? 'Request timed out. Please try again.' 
          : (err?.message || 'Network error');
        results.failed.push({ employee: emp.employee_name, error: errorMsg });
      }
    }

    if (results.failed.length > 0 && results.success === 0) {
      setFormErrors({
        submit: results.failed.map((f) => `${f.employee}: ${f.error}`).join('; '),
      });
    } else {
      closeAddTask();
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    }
    setSubmitting(false);
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm('Remove this planned task?')) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    const totalH = task.total_planned_hours ?? (task.allocations?.reduce((s, a) => s + (a.hours || 0), 0) ?? 8);
    setEditTaskForm({
      start_date: task.start_date || formatAPIDate(new Date()),
      total_hours: totalH,
      max_hours_per_day: 8,
    });
    setEditTaskError(null);
    setEditTaskOpen(true);
  };

  const closeEditTask = () => {
    setEditTaskOpen(false);
    setEditingTask(null);
    setEditTaskError(null);
  };

  const submitEditTask = async () => {
    if (!editingTask) return;
    setEditTaskSubmitting(true);
    setEditTaskError(null);
    try {
      const body = {
        start_date: editTaskForm.start_date,
        total_hours: Number(editTaskForm.total_hours),
        max_hours_per_day: Number(editTaskForm.max_hours_per_day) || 8,
      };
      const res = await apiFetch(`${API_BASE}/qa-planning/tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail;
        const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? (detail.map((d) => d.msg || JSON.stringify(d)).join('; ')) : (detail?.message || JSON.stringify(detail) || 'Failed to update task');
        throw new Error(msg);
      }
      closeEditTask();
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    } catch (e) {
      setEditTaskError(e.message || 'Error updating task');
    } finally {
      setEditTaskSubmitting(false);
    }
  };

  const openDayDetail = async (employeeName, dateStr) => {
    setDayDetailEmployee(employeeName);
    setDayDetailDate(dateStr);
    setDayDetailOpen(true);
    setDayDetailTasks([]);
    setDayDetailLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/qa-planning/day-details?employee_name=${encodeURIComponent(employeeName)}&date_str=${encodeURIComponent(dateStr)}`);
      const data = res.ok ? await res.json() : { tasks: [] };
      setDayDetailTasks(data.tasks || []);
    } catch (_) {
      setDayDetailTasks([]);
    } finally {
      setDayDetailLoading(false);
    }
  };

  const closeDayDetail = () => {
    setDayDetailOpen(false);
    setDayDetailEmployee(null);
    setDayDetailDate(null);
    setDayDetailTasks([]);
  };

  const employees = weekData?.employees || [];
  const employeeGroups = weekData?.employee_groups || [];
  const tasks = weekData?.tasks || [];
  const weekState = weekData?.state || 'draft';
  const canEdit = weekState === 'draft' || weekState === 'submitted';
  const tasksByEmployee = tasks.reduce((acc, t) => {
    const nameKey = t.employee_name || t.employee_id || 'Unknown';
    const idKey = t.employee_id != null ? String(t.employee_id) : null;
    if (!acc[nameKey]) acc[nameKey] = [];
    acc[nameKey].push(t);
    if (idKey && idKey !== nameKey) {
      if (!acc[idKey]) acc[idKey] = [];
      acc[idKey].push(t);
    }
    return acc;
  }, {});
  const getTaskDisplayHours = (t) => {
    if (t.total_planned_hours != null && t.total_planned_hours > 0) return t.total_planned_hours;
    const fromAllocs = t.allocations?.reduce((s, a) => s + (a.hours || 0), 0);
    return fromAllocs != null && fromAllocs > 0 ? fromAllocs : 0;
  };
  const getLeadDisplayPriority = (emp) => {
    if (!isLeadOnly) return 0;
    const normalize = (v) => String(v || '').trim().toLowerCase();
    const myName = normalize(user?.name);
    const empLeadName = normalize(emp?.lead_name);
    const isSelf = emp?.employee_id === user?.employee_id;
    const isMyTeamMember = !!myName && empLeadName === myName && !isSelf;
    const canManageTasks = emp?.can_manage_tasks !== false;
    if (isMyTeamMember) return 0; // own team first
    if (canManageTasks && !isSelf) return 0; // fallback when lead_name is not populated
    if (isSelf) return 1; // then lead's own row
    return 2; // then other teams
  };
  const filterEmp = (emp, forPlanner = false) => {
    // Leads see all department (view); can_manage_tasks controls assign/edit only (not visibility)
    const status = (emp.allocation_status || '').toLowerCase().replace(/\s+/g, '-');
    if (resourceFilter !== 'all') {
      if (resourceFilter === 'available' && status !== 'available') return false;
      if (resourceFilter === 'partial' && status !== 'partially-allocated') return false;
      if (resourceFilter === 'full' && status !== 'fully-allocated') return false;
    }
    const search = (plannerEmployeeSearch || '').trim().toLowerCase();
    if (search && !(emp.employee_name || '').toLowerCase().includes(search)) return false;
    return true;
  };
  // For planner: leads only see their own team
  const filteredEmployees = employees.filter((emp) => filterEmp(emp, true));
  const filteredEmployeeGroups = employeeGroups.length > 0
    ? employeeGroups.map((g) => ({ ...g, members: (g.members || []).filter((emp) => filterEmp(emp, true)) })).filter((g) => g.members.length > 0)
    : null;

  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(filteredEmployees, {
    defaultSortKey: 'employee_name',
    defaultSortDirection: 'asc',
  });
  const orderedSortedEmployees = useMemo(() => {
    if (!isLeadOnly) return sortedEmployees;
    return [...sortedEmployees].sort((a, b) => {
      const byPriority = getLeadDisplayPriority(a) - getLeadDisplayPriority(b);
      if (byPriority !== 0) return byPriority;
      return (a.employee_name || '').localeCompare(b.employee_name || '');
    });
  }, [sortedEmployees, isLeadOnly, user?.employee_id]);

  const sortedEmployeeGroups = useMemo(() => {
    if (!filteredEmployeeGroups) return null;
    const normalize = (v) => String(v || '').trim().toLowerCase();
    const myName = normalize(user?.name);
    const groups = filteredEmployeeGroups.map((g) => ({
      ...g,
      members: [...(g.members || [])].sort((a, b) => {
        const key = sortConfig.key;
        let aVal = a[key];
        let bVal = b[key];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const cmp = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
          return sortConfig.direction === 'asc' ? cmp : -cmp;
        }
        const aNum = Number(aVal) ?? 0;
        const bNum = Number(bVal) ?? 0;
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }),
    }));

    if (!isLeadOnly) return groups;

    // Lead view: own team section first, then other teams
    return [...groups].sort((a, b) => {
      const aIsMine = normalize(a.lead_name) === myName ? 0 : 1;
      const bIsMine = normalize(b.lead_name) === myName ? 0 : 1;
      if (aIsMine !== bIsMine) return aIsMine - bIsMine;
      return normalize(a.lead_name).localeCompare(normalize(b.lead_name));
    });
  }, [filteredEmployeeGroups, sortConfig, isLeadOnly, user?.name]);

  const plannerEmployeeSections = useMemo(() => {
    return sortedEmployeeGroups || [{ lead_name: null, members: orderedSortedEmployees }];
  }, [orderedSortedEmployees, sortedEmployeeGroups]);

  const totalCapacity = employees.length * HOURS_PER_WEEK;
  const totalAllocated = employees.reduce((sum, e) => sum + (e.allocated_hours || 0), 0);
  const utilizationPct = totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0;

  const statusCards = overviewData?.status_cards || {};

  // QA calendar now uses same format as dev: calendarData.employees with days per row
  // Sort employees: manageable (own team) first, then others
  const calendarRows = useMemo(() => {
    const rows = calendarData?.employees || [];
    if (!isLeadOnly) return rows; // Admin/Manager sees normal order
    // Sort order for leads: own reportees/team -> self -> other teams
    return [...rows].sort((a, b) => {
      const byPriority = getLeadDisplayPriority(a) - getLeadDisplayPriority(b);
      if (byPriority !== 0) return byPriority;
      return (a.employee_name || '').localeCompare(b.employee_name || '');
    });
  }, [calendarData?.employees, isLeadOnly, user?.employee_id]);
  const calendarDayKeys = useMemo(() => {
    if (!calendarRows.length) return [];
    return Object.keys(calendarRows[0].days || {}).sort();
  }, [calendarRows]);
  const calendarSummary = useMemo(() => {
    if (!calendarRows.length) return null;
    const totalHours = calendarRows.reduce((s, row) => s + (Number(row.allocated_hours) || 0), 0);
    const numDays = calendarDayKeys.length || 1;
    const numEmps = calendarRows.length || 1;
    const avgHours = (totalHours / numEmps / numDays).toFixed(1);
    const capacity = numEmps * numDays * 8;
    const utilization = Math.round((totalHours / capacity) * 100);
    return { totalHours, avgHours, utilization, employees: calendarRows.length };
  }, [calendarRows, calendarDayKeys]);

  return (
    <div className={`qa-planning-page ${!showParentTitle ? 'qa-planning-embedded' : ''}`}>
      {showParentTitle && (
        <header className="qa-planning-header">
          <div className="qa-planning-header-left">
            <Link to="/" className="qa-planning-back">← Dashboard</Link>
            <h1>QA Task Planning</h1>
          </div>
        </header>
      )}

      {isLeadOrManager && (
        <div className="qa-planning-tabs" role="tablist">
          <button type="button" className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
            QA Active Tickets
          </button>
          <button type="button" className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}>
            Weekly Planner
          </button>
          <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')} title="Planning allocations by week/month">
            Planner Calendar
          </button>
          <button type="button" className={view === 'resource-blocked' ? 'active' : ''} onClick={() => setView('resource-blocked')}>
            Resource Blocked Until
          </button>
          <button type="button" className={view === 'qc-review-fail' ? 'active' : ''} onClick={() => setView('qc-review-fail')}>
            QC Review Fail
          </button>
        </div>
      )}

      {error && <div className="qa-planning-error">{error}</div>}

      {/* MY PLANNED TASKS VIEW (Employees only) */}
      {view === 'my-tasks' && isEmployeeRole && (
        <div className="dev-my-tasks-container qa-my-tasks">
          <div className="dev-my-tasks-header">
            <div className="dev-my-tasks-title-row">
              <span className="dev-my-tasks-icon">✅</span>
              <div>
                <h2 className="dev-my-tasks-title">My Planned Tasks</h2>
                <p className="dev-my-tasks-subtitle">Your QA tasks for the week</p>
              </div>
            </div>
            <div className="dev-my-tasks-week-nav">
              <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() - 7); setWeekStart(formatAPIDate(d)); }} aria-label="Previous week">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <label className="dev-planner-week-display">
                <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="dev-planner-week-picker" title="Pick a week" />
                <span className="dev-planner-week-label">{formatPlanningWeek(weekStart)}</span>
              </label>
              <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() + 7); setWeekStart(formatAPIDate(d)); }} aria-label="Next week">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button type="button" className="dev-planner-today-btn" onClick={() => setWeekStart(formatAPIDate(getWeekMonday(new Date())))}>Today</button>
            </div>
          </div>
          {loading ? (
            <div className="qa-planning-skeleton">Loading your tasks…</div>
          ) : !weekData ? (
            <div className="qa-planning-empty">
              <p>No planning data for this week.</p>
              <p className="dev-planning-empty-hint">Your lead will add tasks for you in the Weekly Planner.</p>
            </div>
          ) : (() => {
            const myEmp = (weekData.employees || []).find((e) => e.employee_id === user?.employee_id) || (weekData.employees || [])[0];
            const myTasks = (weekData.tasks || []).filter((t) => t.employee_id === user?.employee_id || t.employee_name === myEmp?.employee_name);
            const mySummary = myEmp ? { allocated_hours: myEmp.allocated_hours || 0, remaining_hours: myEmp.remaining_hours || 0 } : { allocated_hours: 0, remaining_hours: 40 };
            return (
              <div className="dev-my-tasks-content">
                <div className="dev-my-tasks-summary">
                  <span className="dev-my-tasks-summary-item">Allocated: {mySummary.allocated_hours}h</span>
                  <span className="dev-my-tasks-summary-item">Remaining: {mySummary.remaining_hours}h</span>
                </div>
                {myTasks.length === 0 ? (
                  <div className="qa-planning-empty">
                    <p>No tasks planned for you this week.</p>
                    <p className="dev-planning-empty-hint">Your lead will assign tasks in the Weekly Planner.</p>
                  </div>
                ) : (
                  <div className="dev-my-tasks-list">
                    {myTasks.map((t) => (
                      <div key={t.id} className="dev-my-tasks-card qa-my-tasks-card">
                        <div className="dev-my-tasks-card-header">
                          <span className="dev-my-tasks-card-id">
                            {t.ticket_id ? (
                              getTicketTrackingUrl(t.ticket_id) ? (
                                <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a>
                              ) : (
                                `#${t.ticket_id}`
                              )
                            ) : (
                              t.generic_category || 'Miscellaneous'
                            )}
                          </span>
                          <span className="dev-my-tasks-card-hours">{t.total_planned_hours || 0}h</span>
                        </div>
                        <p className="dev-my-tasks-card-desc">{t.activity_description || (t.ticket_id ? `Ticket #${t.ticket_id}` : t.generic_category) || '—'}</p>
                        <div className="dev-my-tasks-card-dates">
                          {t.start_date && t.end_date ? `${formatDisplayDateWithDay(t.start_date)} → ${formatDisplayDateWithDay(t.end_date)}` : t.start_date ? formatDisplayDateWithDay(t.start_date) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {view === 'overview' && (
        <div className="qa-overview-container">
          {overviewLoading ? (
            <div className="qa-planning-skeleton">Loading QA overview...</div>
          ) : !overviewData ? (
            <div className="qa-planning-empty">
              <p>Failed to load QA overview data.</p>
              <button type="button" className="btn-secondary" onClick={loadOverviewData}>Retry</button>
            </div>
          ) : (
            <>
              {/* Header with Refresh Button */}
              <div className="qa-overview-header">
                <div className="qa-overview-title-section">
                  <h2 className="qa-overview-title">
                    <span className="qa-title-icon">🧪</span>
                    QA Active Tickets Dashboard
                  </h2>
                  <span className="qa-overview-subtitle">
                    {overviewData.total || 0} tickets in QC pipeline • Excludes BIS Testing
                  </span>
                </div>
                <div className="qa-overview-actions">
                  {lastRefresh && (
                    <span className="qa-last-refresh">
                      Last updated: {lastRefresh.toLocaleTimeString()}
                    </span>
                  )}
                  <button
                    type="button"
                    className="qa-export-excel-btn"
                    onClick={async () => {
                      try {
                        const params = new URLSearchParams();
                        if (searchQuery?.trim()) params.set('search', searchQuery.trim());
                        const priority = selectedCard?.type === 'priority' ? selectedCard.key : priorityFilter;
                        if (priority) params.set('priority', priority);
                        const tester = selectedCard?.type === 'tester' ? selectedCard.key : testerFilter;
                        if (tester) params.set('tester', tester);
                        if (moduleFilter) params.set('module', moduleFilter);
                        const status = selectedCard?.type === 'status' ? selectedCard.key : statusFilter;
                        if (status && status !== 'all') params.set('status', status);
                        if (platformFilter) params.set('platform', platformFilter);
                        const planning = selectedCard?.type === 'planning' ? selectedCard.key : planningFilter;
                        if (planning) params.set('planning', planning);
                        const url = `${API_BASE}/qa-planning/overview/export-excel${params.toString() ? `?${params}` : ''}`;
                        const res = await apiFetch(url);
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error(err.detail || 'Export failed');
                        }
                        const blob = await res.blob();
                        const disp = res.headers.get('Content-Disposition');
                        const match = disp && disp.match(/filename="?([^";\n]+)"?/);
                        const filename = match ? match[1] : `QA_Active_Tickets_${new Date().toISOString().slice(0, 10)}.xlsx`;
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      } catch (e) {
                        setError(e?.message || 'Failed to export');
                      }
                    }}
                    title={searchQuery || priorityFilter || testerFilter || moduleFilter || statusFilter || platformFilter || planningFilter || selectedCard
                      ? "Export filtered tickets to Excel"
                      : "Export active tickets to Excel"}
                  >
                    📥 Export Excel
                  </button>
                  <button 
                    type="button" 
                    className="qa-refresh-btn"
                    onClick={refreshFromPMTracker}
                    disabled={refreshing}
                    title="Sync latest data from PM Tracker"
                  >
                    {refreshing ? '⟳ Syncing...' : '⟳ Refresh'}
                  </button>
                </div>
              </div>

              {/* Summary Stats Cards */}
              <section className="qa-summary-section">
                <div className="qa-summary-grid">
                  <div 
                    className={`qa-summary-card qa-card-total ${selectedCard?.type === 'status' && selectedCard?.key === 'all' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('status', 'all', 'All Tickets')}
                  >
                    <div className="qa-card-icon">📊</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{overviewData.total || 0}</span>
                      <span className="qa-card-label">Total Tickets</span>
                    </div>
                  </div>

                  <div 
                    className={`qa-summary-card qa-card-pending ${selectedCard?.type === 'status' && selectedCard?.key === 'QC Testing' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('status', 'QC Testing', 'QC Testing')}
                  >
                    <div className="qa-card-icon">📋</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{statusCards['QC Testing'] || 0}</span>
                      <span className="qa-card-label">QC Testing</span>
                      <span className="qa-card-hint">To be started</span>
                    </div>
                  </div>

                  <div 
                    className={`qa-summary-card qa-card-progress ${selectedCard?.type === 'status' && selectedCard?.key === 'QC Testing in Progress' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('status', 'QC Testing in Progress', 'In Progress')}
                  >
                    <div className="qa-card-icon">🔄</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{statusCards['QC Testing in Progress'] || 0}</span>
                      <span className="qa-card-label">In Progress</span>
                      <span className="qa-card-hint">Testing active</span>
                    </div>
                  </div>

                  <div 
                    className={`qa-summary-card qa-card-hold ${selectedCard?.type === 'status' && selectedCard?.key === 'QC Testing Hold' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('status', 'QC Testing Hold', 'On Hold')}
                  >
                    <div className="qa-card-icon">⏸️</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{statusCards['QC Testing Hold'] || 0}</span>
                      <span className="qa-card-label">On Hold</span>
                      <span className="qa-card-hint">Waiting</span>
                    </div>
                  </div>

                  <div 
                    className={`qa-summary-card qa-card-planned ${selectedCard?.type === 'planning' && selectedCard?.key === 'planned' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('planning', 'planned', 'Planned')}
                  >
                    <div className="qa-card-icon">✅</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{chartData.planned}</span>
                      <span className="qa-card-label">Planned</span>
                      <span className="qa-card-hint">Has QA estimate</span>
                    </div>
                  </div>

                  <div 
                    className={`qa-summary-card qa-card-not-planned ${selectedCard?.type === 'planning' && selectedCard?.key === 'not_planned' ? 'selected' : ''}`}
                    onClick={() => handleCardClick('planning', 'not_planned', 'Not Planned')}
                  >
                    <div className="qa-card-icon">⚠️</div>
                    <div className="qa-card-content">
                      <span className="qa-card-value">{chartData.notPlanned}</span>
                      <span className="qa-card-label">Not Planned</span>
                      <span className="qa-card-hint">Missing QA estimate</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Charts Section */}
              <section className="qa-charts-section">
                <div className="qa-charts-grid">
                  <div className="qa-chart-card">
                    <h3 className="qa-chart-title">Priority Distribution</h3>
                    <div className="qa-chart-wrap qa-chart-doughnut">
                      {Object.keys(chartData.priorityCounts).length > 0 ? (
                        <Doughnut
                          data={priorityChartData}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                position: 'right',
                                labels: { color: '#94a3b8', font: { size: 11 }, padding: 8 }
                              },
                              datalabels: {
                                color: '#fff',
                                font: { weight: 'bold', size: 11 },
                                formatter: (value) => value > 0 ? value : '',
                              }
                            },
                            onClick: (_, elements) => {
                              if (elements.length > 0) {
                                const idx = elements[0].index;
                                const priority = priorityChartData.labels[idx];
                                handleCardClick('priority', priority, priority);
                              }
                            }
                          }}
                        />
                      ) : (
                        <div className="qa-chart-empty">No data available</div>
                      )}
                    </div>
                    <p className="qa-chart-hint">Click on a segment to filter tickets</p>
                  </div>

                  <div className="qa-chart-card">
                    <div className="qa-chart-header-row">
                      <div>
                        <h3 className="qa-chart-title">Tester Workload</h3>
                        <p className="qa-chart-subtitle">
                      {Object.keys(chartData.testerCounts || {}).length > 0
                        ? 'Tickets by QC tester'
                        : `Planner tasks · ${formatPlanningWeek(weekStart)}`}
                    </p>
                      </div>
                      {testerChartHasMore && (
                        <button
                          type="button"
                          className="qa-chart-expand-btn"
                          onClick={() => setTesterChartExpanded((v) => !v)}
                          title={testerChartExpanded ? 'Show fewer' : `Show all ${testerChartTotalCount}`}
                        >
                          {testerChartExpanded ? '▼ Collapse' : `▲ Expand (${testerChartTotalCount})`}
                        </button>
                      )}
                    </div>
                    <div className={`qa-chart-wrap qa-chart-bar ${testerChartExpanded ? 'qa-chart-expanded' : ''}`}>
                      {testerChartTotalCount > 0 ? (
                        <Bar
                          data={testerChartData}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            plugins: {
                              legend: { display: false },
                              datalabels: {
                                anchor: 'end',
                                align: 'end',
                                color: '#94a3b8',
                                font: { weight: 'bold', size: 11 },
                              }
                            },
                            scales: {
                              x: {
                                ticks: { color: '#94a3b8' },
                                grid: { color: 'rgba(148, 163, 184, 0.1)' }
                              },
                              y: {
                                ticks: { color: '#f1f5f9' },
                                grid: { display: false }
                              }
                            },
                            onClick: (_, elements) => {
                              if (elements.length > 0) {
                                const counts = Object.keys(chartData.testerCounts || {}).length > 0
                                  ? chartData.testerCounts
                                  : (chartData.plannerTaskCounts || {});
                                const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                                const limit = testerChartExpanded ? sorted.length : 8;
                                const testerName = sorted.slice(0, limit)[elements[0].index]?.[0];
                                if (testerName) handleCardClick('tester', testerName, testerName);
                              }
                            }
                          }}
                        />
                      ) : (
                        <div className="qa-chart-empty">
                          {loading ? 'Loading…' : (weekData ? 'No tasks assigned this week' : 'Go to Weekly Planner to create a week')}
                        </div>
                      )}
                    </div>
                    <p className="qa-chart-hint">Click on a bar to filter by tester</p>
                  </div>

                  <div className="qa-chart-card qa-chart-small">
                    <h3 className="qa-chart-title">Planning Status</h3>
                    <div className="qa-chart-wrap qa-chart-doughnut-small">
                      <Doughnut
                        data={planningChartData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          cutout: '60%',
                          plugins: {
                            legend: {
                              position: 'bottom',
                              labels: { color: '#94a3b8', font: { size: 11 }, padding: 8 }
                            },
                            datalabels: {
                              color: '#fff',
                              font: { weight: 'bold', size: 12 },
                              formatter: (value) => value > 0 ? value : '',
                            }
                          },
                          onClick: (_, elements) => {
                            if (elements.length > 0) {
                              const idx = elements[0].index;
                              handleCardClick('planning', idx === 0 ? 'planned' : 'not_planned', idx === 0 ? 'Planned' : 'Not Planned');
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Search and Filters */}
              <section className="qa-filters-section">
                <div className="qa-filters-row">
                  <div className="qa-search-wrap">
                    <span className="qa-search-icon">🔍</span>
                    <input
                      type="text"
                      placeholder="Search tickets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="qa-search-input"
                    />
                  </div>

                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Priorities</option>
                    {filterOptions.priorities.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>

                  <select
                    value={testerFilter}
                    onChange={(e) => setTesterFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Testers</option>
                    {filterOptions.testers.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>

                  <select
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Modules</option>
                    {filterOptions.modules.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Statuses</option>
                    {filterOptions.statuses.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  <select
                    value={platformFilter}
                    onChange={(e) => setPlatformFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Platforms</option>
                    {filterOptions.platforms.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>

                  <select
                    value={planningFilter}
                    onChange={(e) => setPlanningFilter(e.target.value)}
                    className="qa-filter-select"
                  >
                    <option value="">All Planning</option>
                    <option value="planned">Planned (Has Estimate)</option>
                    <option value="not_planned">Not Planned</option>
                  </select>

                  {(searchQuery || priorityFilter || testerFilter || moduleFilter || statusFilter || platformFilter || planningFilter || selectedCard) && (
                    <button type="button" className="qa-clear-filters" onClick={clearFilters}>
                      Clear Filters
                    </button>
                  )}
                </div>

                {selectedCard && (
                  <div className="qa-active-filter-badge">
                    <span>Showing: {selectedCard.label}</span>
                    <button type="button" onClick={() => setSelectedCard(null)}>×</button>
                  </div>
                )}
              </section>

              {/* In QC 10+ days: count (click to see list) */}
              {overviewData && (overviewData.in_qc_10_plus?.length ?? 0) >= 0 && (
                <section className="qa-in-qc-15-section">
                  <button
                    type="button"
                    className="qa-in-qc-15-trigger"
                    onClick={() => setShowInQc10List((v) => !v)}
                    aria-expanded={showInQc10List}
                  >
                    <span className="qa-in-qc-15-label">In QC testing 10+ days (all priorities)</span>
                    <span className="qa-in-qc-15-count">{(overviewData.in_qc_10_plus?.length ?? 0)} tickets</span>
                  </button>
                  {showInQc10List && (
                    <div className="qa-in-qc-15-list-wrap">
                      {(overviewData.in_qc_10_plus?.length ?? 0) === 0 ? (
                        <p className="qa-in-qc-15-none">No tickets in QC for 10+ days.</p>
                      ) : (
                        <ul className="qa-in-qc-15-list">
                          {(overviewData.in_qc_10_plus || []).map((t) => (
                            <li key={t.ticket_id} className="qa-in-qc-15-item">
                              <Link to={`/tickets?ticket=${t.ticket_id}`} onClick={() => setShowInQc10List(false)}>
                                #{t.ticket_id}
                              </Link>
                              <span className="qa-in-qc-15-meta">{t.title?.slice(0, 50)}{(t.title?.length || 0) > 50 ? '…' : ''}</span>
                              <span className="qa-in-qc-15-pill" style={{ backgroundColor: PRIORITY_COLORS[t.priority] || '#6b7280' }}>{t.priority}</span>
                              <span className="qa-in-qc-15-days">{t.days_in_qc}d</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* QA Priority Queue: two tables (Pending + Assigned) + Active tickets for ongoing week */}
              {(() => {
                const renderTicketRow = (t, idx, opts = {}) => {
                  const isNotPlanned = t.qa_estimate_hours == null || t.qa_estimate_hours === 0;
                  const showTestedByDev = opts.showTestedByDev === true;
                  return (
                    <tr
                      key={t.ticket_id}
                      className={`qa-ticket-row ${t.is_next_in_queue ? 'qa-next-in-queue' : ''} ${isNotPlanned ? 'qa-not-planned' : ''}`}
                    >
                      <td className="qa-rank">{idx + 1}</td>
                      <td className="qa-ticket-id-cell">
                        <Link to={`/tickets?ticket=${t.ticket_id}`} className="qa-ticket-link">
                          #{t.ticket_id}
                        </Link>
                        <TicketExternalLink ticketId={t.ticket_id} />
                      </td>
                      <td className="qa-title-cell" title={t.title}>
                        {t.title?.slice(0, 45)}{(t.title?.length || 0) > 45 ? '…' : ''}
                      </td>
                      <td>
                        <span
                          className="qa-priority-pill"
                          style={{ backgroundColor: PRIORITY_COLORS[t.priority] || '#6b7280' }}
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td>
                        <span className="qa-status-pill" style={{ borderColor: STATUS_COLORS[t.status] || '#6b7280' }}>
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <span className={`qa-activity-pill qa-activity-${t.activity_type}`} title={t.retest_cycle_count > 0 ? `Retest cycle: ${t.retest_cycle_count}` : undefined}>
                          {t.activity_label}
                        </span>
                      </td>
                      <td className="qa-retest-cycle-cell" title={t.retest_cycle_count > 0 ? `Times returned to QA after failure: ${t.retest_cycle_count}` : ''}>
                        {t.retest_cycle_count > 0 ? t.retest_cycle_count : '—'}
                      </td>
                      <td className="qa-ageing-cell">
                        <span title={t.moved_to_qc_on ? `Moved to QC: ${t.moved_to_qc_on}` : ''}>
                          {t.days_in_qc > 0 ? `${t.days_in_qc}d` : '-'}
                        </span>
                        {t.days_on_hold > 0 && (
                          <span className="qa-hold-badge">({t.days_on_hold}d hold)</span>
                        )}
                      </td>
                      <td title={t.module || ''}>{t.module || '—'}</td>
                      <td>
                        <span className={`qa-platform-badge ${(t.platform || 'Web').toLowerCase()}`}>
                          {t.platform || 'Web'}
                        </span>
                      </td>
                      <td title={t.qc_tester || ''}>{t.qc_tester || '—'}</td>
                      <td title={t.qa_lead || ''}>{t.qa_lead || '—'}</td>
                      <td title={t.developers_str || ''}>{t.developers_str || 'Not Assigned'}</td>
                      <td className={isNotPlanned ? 'qa-estimate-missing' : ''}>
                        {isNotPlanned ? (
                          <span className="qa-not-planned-badge">Not Planned</span>
                        ) : (
                          `${t.qa_estimate_hours}h`
                        )}
                      </td>
                      <td>{t.qa_actual_hours != null ? `${t.qa_actual_hours}h` : '—'}</td>
                      <td>{t.eta ? formatDisplayDate(t.eta) : '—'}</td>
                      {showTestedByDev && (
                        <td className="qa-tested-by-dev-cell">
                          <label className="qa-tested-by-dev-checkbox">
                            <input
                              type="checkbox"
                              checked={opts.testedByDev === true}
                              onChange={() => opts.onTestedByDevToggle && opts.onTestedByDevToggle()}
                              title={opts.testedByDev ? 'Uncheck to move back to Pending queue' : 'Check to mark as Tested by Dev'}
                            />
                            <span>Tested by Dev</span>
                          </label>
                        </td>
                      )}
                      <td className="qa-actions-cell">
                        <button
                          type="button"
                          className="qa-action-btn qa-btn-view"
                          onClick={() => goToTicket(t.ticket_id)}
                          title="View in Tickets"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                };
                const emptyMessage = searchQuery || priorityFilter || testerFilter || moduleFilter || statusFilter || platformFilter || planningFilter || selectedCard
                  ? 'No tickets match your filters.'
                  : 'No QC tickets in queue.';
                return (
                  <>
                    <section className="qa-tickets-section">
                      <div className="qa-tickets-header">
                        <h3 className="qa-tickets-title">
                          Pending priority queue
                          <span className="qa-tickets-count">{pendingNotTestedByDev.length} tickets</span>
                        </h3>
                        <p className="qa-tickets-description">Tickets with no QC tester assigned (not yet marked Tested by Dev). Check &quot;Tested by Dev&quot; to move to the table below.</p>
                      </div>
                      <div className="qa-tickets-table-wrap">
                        <table className="qa-tickets-table">
                          <thead>
                            <tr>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortPendingNotTested} sortConfig={sortPendingNotTested}>#</SortableHeader>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortPendingNotTested} sortConfig={sortPendingNotTested}>Ticket</SortableHeader>
                              <SortableHeader columnKey="title" onSort={handleSortPendingNotTested} sortConfig={sortPendingNotTested}>Title</SortableHeader>
                              <SortableHeader columnKey="priority" onSort={handleSortPendingNotTested} sortConfig={sortPendingNotTested}>Priority</SortableHeader>
                              <SortableHeader columnKey="status" onSort={handleSortPendingNotTested} sortConfig={sortPendingNotTested}>Status</SortableHeader>
                              <th>Activity</th>
                              <th>Retest cycle</th>
                              <th>Ageing</th>
                              <th>Module</th>
                              <th>Platform</th>
                              <th>QC Tester</th>
                              <th>QA Lead</th>
                              <th>Dev(s)</th>
                              <th>QA Est</th>
                              <th>QA Actual</th>
                              <th>ETA</th>
                              <th>Tested by Dev</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedPendingNotTestedByDev.length === 0 ? (
                              <tr>
                                <td colSpan={18} className="qa-table-empty">{emptyMessage}</td>
                              </tr>
                            ) : (
                              sortedPendingNotTestedByDev.map((t, idx) => renderTicketRow(t, idx, {
                                showTestedByDev: true,
                                testedByDev: false,
                                onTestedByDevToggle: () => setTestedByDev(t.ticket_id, true),
                              }))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="qa-tickets-section">
                      <div className="qa-tickets-header">
                        <h3 className="qa-tickets-title">
                          Tickets tested by Dev
                          <span className="qa-tickets-count">{pendingTestedByDev.length} tickets</span>
                        </h3>
                        <p className="qa-tickets-description">Pending tickets (no QC tester) marked as tested by Dev. Uncheck to move back to Pending priority queue.</p>
                      </div>
                      <div className="qa-tickets-table-wrap">
                        <table className="qa-tickets-table">
                          <thead>
                            <tr>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortPendingTested} sortConfig={sortPendingTested}>#</SortableHeader>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortPendingTested} sortConfig={sortPendingTested}>Ticket</SortableHeader>
                              <SortableHeader columnKey="title" onSort={handleSortPendingTested} sortConfig={sortPendingTested}>Title</SortableHeader>
                              <SortableHeader columnKey="priority" onSort={handleSortPendingTested} sortConfig={sortPendingTested}>Priority</SortableHeader>
                              <SortableHeader columnKey="status" onSort={handleSortPendingTested} sortConfig={sortPendingTested}>Status</SortableHeader>
                              <th>Activity</th>
                              <th>Retest cycle</th>
                              <th>Ageing</th>
                              <th>Module</th>
                              <th>Platform</th>
                              <th>QC Tester</th>
                              <th>QA Lead</th>
                              <th>Dev(s)</th>
                              <th>QA Est</th>
                              <th>QA Actual</th>
                              <th>ETA</th>
                              <th>Tested by Dev</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedPendingTestedByDev.length === 0 ? (
                              <tr>
                                <td colSpan={18} className="qa-table-empty">No tickets marked as Tested by Dev.</td>
                              </tr>
                            ) : (
                              sortedPendingTestedByDev.map((t, idx) => renderTicketRow(t, idx, {
                                showTestedByDev: true,
                                testedByDev: true,
                                onTestedByDevToggle: () => setTestedByDev(t.ticket_id, false),
                              }))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="qa-tickets-section">
                      <div className="qa-tickets-header">
                        <h3 className="qa-tickets-title">
                          Assigned tickets
                          <span className="qa-tickets-count">{assignedQueue.length} tickets</span>
                        </h3>
                        <p className="qa-tickets-description">Tickets with QC tester assigned</p>
                      </div>
                      <div className="qa-tickets-table-wrap">
                        <table className="qa-tickets-table">
                          <thead>
                            <tr>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortAssigned} sortConfig={sortAssigned}>#</SortableHeader>
                              <SortableHeader columnKey="ticket_id" onSort={handleSortAssigned} sortConfig={sortAssigned}>Ticket</SortableHeader>
                              <SortableHeader columnKey="title" onSort={handleSortAssigned} sortConfig={sortAssigned}>Title</SortableHeader>
                              <SortableHeader columnKey="priority" onSort={handleSortAssigned} sortConfig={sortAssigned}>Priority</SortableHeader>
                              <SortableHeader columnKey="status" onSort={handleSortAssigned} sortConfig={sortAssigned}>Status</SortableHeader>
                              <th>Activity</th>
                              <th>Retest cycle</th>
                              <th>Ageing</th>
                              <th>Module</th>
                              <th>Platform</th>
                              <th>QC Tester</th>
                              <th>QA Lead</th>
                              <th>Dev(s)</th>
                              <th>QA Est</th>
                              <th>QA Actual</th>
                              <th>ETA</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedAssignedQueue.length === 0 ? (
                              <tr>
                                <td colSpan={17} className="qa-table-empty">{emptyMessage}</td>
                              </tr>
                            ) : (
                              sortedAssignedQueue.map((t, idx) => renderTicketRow(t, idx))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="qa-tickets-section">
                      <div className="qa-tickets-header">
                        <h3 className="qa-tickets-title">
                          Active tickets for ongoing week
                          <span className="qa-tickets-count">{activeThisWeekQueue.length} tickets</span>
                        </h3>
                        <p className="qa-tickets-description">Tickets planned in the current week</p>
                      </div>
                      <div className="qa-tickets-table-wrap">
                        <table className="qa-tickets-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Ticket</th>
                              <th>Title</th>
                              <th>Priority</th>
                              <th>Status</th>
                              <th>Activity</th>
                              <th>Retest cycle</th>
                              <th>Ageing</th>
                              <th>Module</th>
                              <th>Platform</th>
                              <th>QC Tester</th>
                              <th>QA Lead</th>
                              <th>Dev(s)</th>
                              <th>QA Est</th>
                              <th>QA Actual</th>
                              <th>ETA</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeThisWeekQueue.length === 0 ? (
                              <tr>
                                <td colSpan={17} className="qa-table-empty">
                                  No tickets planned for the current week.
                                </td>
                              </tr>
                            ) : (
                              activeThisWeekQueue.map((t, idx) => renderTicketRow(t, idx))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {view === 'planner' && (
        <div className="dev-planner-resource-ui">
          <div className="dev-planner-header">
            <div className="dev-planner-header-left">
              <div className="dev-planner-title-row">
                <span className="dev-planner-icon">📋</span>
                <div>
                  <h1 className="dev-planner-title">QA Task Planning</h1>
                  <p className="dev-planner-subtitle">Resource Allocation & Weekly Planning</p>
                </div>
              </div>
              <div className="dev-planner-week-nav">
                <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() - 7); setWeekStart(formatAPIDate(d)); }} aria-label="Previous week">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <label className="dev-planner-week-display">
                  <input
                    type="date"
                    value={weekStart}
                    onChange={(e) => setWeekStart(e.target.value)}
                    className="dev-planner-week-picker"
                    title="Click to pick a week"
                  />
                  <span className="dev-planner-week-label">{formatPlanningWeek(weekStart)}</span>
                </label>
                <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() + 7); setWeekStart(formatAPIDate(d)); }} aria-label="Next week">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </button>
                <button type="button" className="dev-planner-today-btn" onClick={() => setWeekStart(formatAPIDate(getWeekMonday(new Date())))}>
                  Today
                </button>
              </div>
            </div>
            <div className="dev-planner-header-right">
              <button
                type="button"
                className="dev-planner-btn refresh"
                onClick={refreshAllPmTracker}
                disabled={refreshing}
                title="Refresh PM Tracker data"
              >
                {refreshing ? '↻ Syncing…' : '↻ Refresh PM Tracker'}
              </button>
              {canEdit && (
                <>
                  <button type="button" className={`dev-planner-btn draft ${weekState === 'draft' ? 'active' : ''}`} onClick={ensureWeek} disabled={actionLoading}>
                    <span className="btn-dot" /> Draft
                  </button>
                  <button type="button" className="dev-planner-btn submit" onClick={() => updateWeekState('submitted')} disabled={actionLoading}>
                    ✓ Submit Plan
                  </button>
                </>
              )}
              <span className="dev-planner-save-status">{lastRefresh ? `Synced: ${lastRefresh.toLocaleTimeString()}` : 'Last saved: 2 min ago'}</span>
              <div className="dev-planner-view-toggle">
                <button type="button" className={plannerViewMode === 'grid' ? 'active' : ''} onClick={() => setPlannerViewMode('grid')} title="Grid view">⊞</button>
                <button type="button" className={plannerViewMode === 'list' ? 'active' : ''} onClick={() => setPlannerViewMode('list')} title="List view">≡</button>
              </div>
            </div>
          </div>

          <div className="dev-planner-summary-bar">
            <span className="dev-planner-summary-item"><strong>Total Resources:</strong> {employees.length}</span>
            <span className="dev-planner-summary-item"><strong>Available Capacity:</strong> {totalCapacity}h</span>
            <span className={`dev-planner-summary-item allocated ${utilizationPct >= 90 ? 'high' : utilizationPct >= 50 ? 'partial' : ''}`}><strong>Allocated:</strong> {totalAllocated}h</span>
            <span className="dev-planner-summary-item"><strong>Utilization:</strong> {utilizationPct}%</span>
          </div>

          <div className="dev-planner-layout">
            <section className="dev-planner-left-panel">
              <div className="dev-planner-panel-header">
                <h2>PM Tracker Tickets</h2>
                <span className="dev-planner-badge">{filteredPlannerTickets.length}</span>
              </div>
              <div className="dev-planner-filters">
                <div className="dev-planner-search-wrap">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search by ID, title, or tester..."
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    className="dev-planner-search"
                  />
                </div>
                <select value={ticketStatusFilter} onChange={(e) => setTicketStatusFilter(e.target.value)} title="Filter by status">
                  <option value="">All Statuses</option>
                  {(ticketFilterOptions.statuses || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select value={ticketPriorityFilter} onChange={(e) => setTicketPriorityFilter(e.target.value)} title="Filter by priority">
                  <option value="">All Priorities</option>
                  {(ticketFilterOptions.priorities || []).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <select value={ticketAssigneeFilter} onChange={(e) => setTicketAssigneeFilter(e.target.value)} title="Filter by tester">
                  <option value="">All Testers</option>
                  {(ticketFilterOptions.assignees || []).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <label className="dev-planner-filter-checkbox">
                  <input
                    type="checkbox"
                    checked={ticketUnassignedFilter}
                    onChange={(e) => setTicketUnassignedFilter(e.target.checked)}
                  />
                  <span>Unassigned only</span>
                </label>
                <select value={hasEstimateFilter === null ? '' : String(hasEstimateFilter)} onChange={(e) => setHasEstimateFilter(e.target.value === '' ? null : e.target.value === 'true')} title="Filter by estimate">
                  <option value="">All Estimates</option>
                  <option value="true">With QA estimate</option>
                  <option value="false">Without estimate</option>
                </select>
                {(ticketSearch || ticketStatusFilter || ticketPriorityFilter || ticketAssigneeFilter || ticketUnassignedFilter || hasEstimateFilter !== null) && (
                  <button
                    type="button"
                    className="dev-planner-clear-filters"
                    onClick={() => {
                      setTicketSearch('');
                      setTicketStatusFilter('');
                      setTicketPriorityFilter('');
                      setTicketAssigneeFilter('');
                      setTicketUnassignedFilter(false);
                      setHasEstimateFilter(null);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div className="dev-planner-ticket-list">
                {loading ? (
                  <div className="dev-planning-skeleton">Loading tickets…</div>
                ) : filteredPlannerTickets.length === 0 ? (
                  <div className="dev-planning-empty">
                    <p>No tickets found.</p>
                    <p className="dev-planning-empty-hint">Sync PM Tracker from the app or clear filters above.</p>
                  </div>
                ) : (
                  filteredPlannerTickets.slice(0, 100).map((t) => (
                    <div key={t.ticket_id} className={`dev-planner-ticket-card ${urlTicketId && t.ticket_id === parseInt(urlTicketId, 10) ? 'highlight-from-link' : ''}`}>
                      <div className="dev-planner-ticket-top">
                        <span className="dev-planner-ticket-id">
                          <Link to={`/tickets?ticket=${t.ticket_id}`} onClick={(e) => e.stopPropagation()}>#{t.ticket_id}</Link>
                          <TicketExternalLink ticketId={t.ticket_id} className="dev-planner-ticket-ext-link" />
                        </span>
                        <span className={`dev-planner-status-badge status-${(t.status || '').toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`}>{t.status || 'Open'}</span>
                      </div>
                      <p className="dev-planner-ticket-title" title={t.title}>{t.title?.slice(0, 60)}{(t.title?.length || 0) > 60 ? '…' : ''}</p>
                      <div className="dev-planner-ticket-hours">
                        <span>Dev: {t.dev_estimate_hours != null && t.dev_estimate_hours > 0 ? `${t.dev_estimate_hours}h` : '—'}</span>
                        <span>QA: {t.qa_estimate_hours != null && t.qa_estimate_hours > 0 ? `${t.qa_estimate_hours}h` : '—'}</span>
                      </div>
                      <button type="button" className="dev-planner-ticket-plan-btn" onClick={() => openMultiPlanModal(t)} title="Plan for multiple testers">Plan</button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="dev-planner-right-panel">
              <div className="dev-planner-panel-header">
                <h2>QA Resources</h2>
                <div className="dev-planner-resource-controls">
                  <div className="dev-planner-user-search-wrap">
                    <span className="search-icon">🔍</span>
                    <input
                      type="text"
                      placeholder="Search by name..."
                      value={plannerEmployeeSearch}
                      onChange={(e) => setPlannerEmployeeSearch(e.target.value)}
                      className="dev-planner-user-search"
                    />
                  </div>
                  <label className="dev-planner-sort-label">
                    Sort:
                    <select
                      value={sortConfig.key}
                      onChange={(e) => handleSort(e.target.value)}
                      className="dev-planner-sort-select"
                    >
                      <option value="employee_name">Name</option>
                      <option value="allocated_hours">Allocated (h)</option>
                      <option value="remaining_hours">Remaining (h)</option>
                      <option value="role">Role</option>
                    </select>
                    <button
                      type="button"
                      className="dev-planner-sort-direction"
                      onClick={() => handleSort(sortConfig.key)}
                      title={sortConfig.direction === 'asc' ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
                    >
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </button>
                  </label>
                  <div className="dev-planner-resource-tabs">
                    {['all', 'available', 'partial', 'full'].map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className={`dev-planner-tab ${resourceFilter === tab ? 'active' : ''}`}
                        onClick={() => setResourceFilter(tab)}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="dev-planning-skeleton">Loading…</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="dev-planning-empty">
                  <p>No resources match the filter.</p>
                </div>
              ) : (
                <div className="dev-planner-resource-sections">
                  {plannerEmployeeSections.map((group, gIdx) => (
                    <div key={group.lead_name || `group-${gIdx}`} className="dev-planner-lead-group">
                      {(group.lead_name || plannerEmployeeSections.length > 1) && (
                        <h3 className="dev-planner-lead-header">
                          {group.lead_name ? `${group.lead_name}'s Team` : 'Unassigned'}
                        </h3>
                      )}
                      <div className={`dev-planner-resource-grid ${plannerViewMode === 'list' ? 'list-mode' : ''}`}>
                        {(group.members || []).map((emp) => {
                    const empTasks = tasksByEmployee[emp.employee_name] || (emp.employee_id != null ? tasksByEmployee[String(emp.employee_id)] : null) || [];
                    const statusKey = (emp.allocation_status || '').toLowerCase().replace(/\s+/g, '-');
                    const initials = (emp.employee_name || 'XX').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
                    return (
                      <div
                        key={emp.employee_id}
                        className={`dev-planner-resource-card ${statusKey} ${urlEmployeeId && emp.employee_id === urlEmployeeId ? 'highlight-from-link' : ''}`}
                      >
                        <div className="dev-planner-resource-header">
                          <div className="dev-planner-avatar">{initials}</div>
                          <div className="dev-planner-resource-info">
                            <Link to={`/employees/${emp.employee_id}`} className="dev-planner-resource-name" onClick={(e) => e.stopPropagation()}>{emp.employee_name}</Link>
                            <span className="dev-planner-resource-role">{emp.role || 'QA'}</span>
                          </div>
                          <span className={`dev-planner-allocation-badge ${statusKey}`}>
                            {emp.allocation_status === 'Fully Allocated' ? 'Full' : emp.allocation_status === 'Partially Allocated' ? 'Partial' : 'Available'}
                          </span>
                        </div>
                        <div className="dev-planner-progress-bar">
                          <div className="dev-planner-progress-fill" style={{ width: `${Math.min(100, (emp.allocated_hours / HOURS_PER_WEEK) * 100)}%` }} />
                        </div>
                        <div className="dev-planner-progress-label">
                          {emp.allocated_hours}h / {HOURS_PER_WEEK}h
                        </div>
                        <div className="dev-planner-remaining">Remaining: {emp.remaining_hours}h</div>
                        <div className="dev-planner-assigned-tasks">
                          {empTasks.length === 0 ? (
                            canEdit && (emp.can_manage_tasks !== false) && emp.remaining_hours > 0 ? (
                              <button type="button" className="dev-planner-add-task-btn" onClick={() => openAddTask(emp)}>+ Add Task</button>
                            ) : emp.remaining_hours <= 0 ? (
                              <span className="dev-planner-fully-allocated">+ Fully Allocated</span>
                            ) : (
                              <span className="dev-planner-no-tasks">No tasks assigned</span>
                            )
                          ) : (
                            <>
                              {empTasks.map((t) => (
                                <div key={t.id} className={`dev-planner-task-item ${t.is_on_hold ? 'on-hold' : ''}`}>
                                  <span className="dev-planner-task-id">
                                    {t.ticket_id ? (
                                      <Link to={`/tickets?ticket=${t.ticket_id}`} onClick={(e) => e.stopPropagation()}>#{t.ticket_id}</Link>
                                    ) : (
                                      t.generic_category
                                    )}
                                  </span>
                                  <span className="dev-planner-task-desc">{t.activity_description?.slice(0, 35)}{(t.activity_description?.length || 0) > 35 ? '…' : ''}</span>
                                  <span className="dev-planner-task-hours">{getTaskDisplayHours(t)}h</span>
                                  <span className="dev-planner-task-dates">{t.start_date && t.end_date ? `${formatDisplayDateWithDay(t.start_date)} → ${formatDisplayDateWithDay(t.end_date)}` : formatDisplayDate(t.start_date)}</span>
                                  {t.is_on_hold && (
                                    <span className="dev-planner-task-hold-badge" title={t.hold_reason || 'On Hold'}>⏸</span>
                                  )}
                                  {canEdit && (emp.can_manage_tasks !== false) && (
                                    <div className="dev-planner-task-actions">
                                      <button
                                        type="button"
                                        className="dev-planner-task-edit"
                                        title="Edit task"
                                        onClick={() => openEditTask(t)}
                                      >
                                        ✎
                                      </button>
                                      {/* Hold/Resume button for ticket tasks */}
                                      {t.ticket_id && (
                                        t.is_on_hold ? (
                                          <button
                                            type="button"
                                            className="dev-planner-task-resume"
                                            title="Resume task"
                                            onClick={() => resumeTask(t.id)}
                                          >
                                            ▶
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            className="dev-planner-task-hold"
                                            title="Put on hold"
                                            onClick={() => openHoldTaskModal(t)}
                                          >
                                            ⏸
                                          </button>
                                        )
                                      )}
                                      <button
                                        type="button"
                                        className="dev-planner-task-remove"
                                        onClick={() => deleteTask(t.id)}
                                        title={!t.spillover && t.start_date && t.start_date < formatAPIDate(new Date()) ? 'Past tasks cannot be deleted' : 'Remove'}
                                        disabled={!!(!t.spillover && t.start_date && t.start_date < formatAPIDate(new Date()))}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {canEdit && (emp.can_manage_tasks !== false) && emp.remaining_hours > 0 && (
                                <button type="button" className="dev-planner-add-task-btn small" onClick={() => openAddTask(emp)}>+ Add Task</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {view === 'calendar' && (
        <div className="dev-planning-calendar-view">
          <div className="dev-planning-calendar-header">
            <div className="planner-calendar-heading">
              <h3 className="planner-calendar-title">Planner Calendar</h3>
              <p className="planner-calendar-subtitle">Planning module allocations by employee and week</p>
            </div>
            <div className="dev-planning-calendar-controls">
              <div className="calendar-view-toggle">
                <button type="button" className={calendarView === 'weekly' ? 'active' : ''} onClick={() => setCalendarView('weekly')}>Weekly</button>
                <button type="button" className={calendarView === 'monthly' ? 'active' : ''} onClick={() => setCalendarView('monthly')}>Monthly</button>
              </div>
              <div className="calendar-date-controls">
                {calendarView === 'weekly' ? (
                  <>
                    <label>Week:</label>
                    <button type="button" className="calendar-nav-btn" onClick={() => {
                      const d = new Date(weekStart + 'T12:00:00');
                      d.setDate(d.getDate() - 7);
                      setWeekStart(formatAPIDate(d));
                    }}>←</button>
                    <input
                      type="date"
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                      className="calendar-week-input"
                    />
                    <button type="button" className="calendar-nav-btn" onClick={() => {
                      const d = new Date(weekStart + 'T12:00:00');
                      d.setDate(d.getDate() + 7);
                      setWeekStart(formatAPIDate(d));
                    }}>→</button>
                  </>
                ) : (
                  <>
                    <label>Month:</label>
                    <select
                      value={parseInt(weekStart.slice(5, 7), 10)}
                      onChange={(e) => {
                        const m = String(e.target.value).padStart(2, '0');
                        setWeekStart(`${weekStart.slice(0, 4)}-${m}-01`);
                      }}
                      className="calendar-month-select"
                    >
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={parseInt(weekStart.slice(0, 4), 10)}
                      onChange={(e) => setWeekStart(`${e.target.value}-${weekStart.slice(5, 7)}-01`)}
                      className="calendar-year-select"
                    >
                      {[2024, 2025, 2026, 2027, 2028].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </>
                )}
                <button type="button" className="btn-secondary calendar-today-btn" onClick={() => setWeekStart(formatAPIDate(new Date()))}>Today</button>
              </div>
            </div>
            {calendarSummary && (
              <div className="calendar-summary-section">
                <div className="calendar-period-label">
                  {calendarView === 'weekly'
                    ? `Week of ${formatDisplayDateWithDay(calendarData?.start || weekStart)} – ${formatDisplayDateWithDay(calendarData?.end || weekStart)}`
                    : (() => {
                        const [y, m] = (calendarData?.start || weekStart).split('-');
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
                      })()}
                </div>
                <div className="calendar-summary-stats">
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Employees</span>
                    <span className="calendar-stat-value">{calendarSummary.employees}</span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Total Hours</span>
                    <span className="calendar-stat-value">{calendarSummary.totalHours}h</span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Avg Hours/Day</span>
                    <span className="calendar-stat-value">{calendarSummary.avgHours}h</span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Utilization</span>
                    <span className="calendar-stat-value">{calendarSummary.utilization}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {view === 'calendar' && !calendarData && !error && (
            <div className="qa-planning-skeleton">Loading calendar...</div>
          )}
          {view === 'calendar' && error && (
            <div className="qa-planning-empty">
              <p>{error}</p>
              <button type="button" className="btn-secondary" onClick={() => { setError(null); loadCalendarData(); }}>Retry</button>
            </div>
          )}
          {view === 'calendar' && calendarData && calendarRows.length === 0 && !error && (
            <div className="qa-planning-empty">No QA team members or no data for this period.</div>
          )}
          {calendarRows.length > 0 && (
            <>
            <div className="calendar-legend">
              <span className="calendar-legend-item"><span className="calendar-legend-swatch full" /> Fully occupied (8h)</span>
              <span className="calendar-legend-item"><span className="calendar-legend-swatch partial" /> Partially occupied</span>
              <span className="calendar-legend-item"><span className="calendar-legend-swatch empty" /> Not occupied</span>
            </div>
            <div className="dev-planning-calendar-grid-wrap">
              <table className="dev-planning-calendar-grid">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {calendarDayKeys.map((d) => (
                      <th key={d}>{formatDisplayDate(d)}</th>
                    ))}
                    <th className="total-col">Total</th>
                    <th className="avg-col">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {calendarRows.map((row) => {
                    const days = Object.values(row.days || {});
                    const numDays = days.length || calendarDayKeys.length || 1;
                    const totalHours = row.allocated_hours != null ? Number(row.allocated_hours) : days.reduce((s, d) => s + (Number(d.hours) || 0), 0);
                    const avgHours = numDays > 0 ? (totalHours / numDays).toFixed(1) : '0.0';
                    const rowPriorities = [];
                    days.forEach((cell) => {
                      (cell.items || []).forEach((it) => {
                        if (it.ticket_priority && !rowPriorities.includes(it.ticket_priority)) rowPriorities.push(it.ticket_priority);
                      });
                    });
                    rowPriorities.sort((a, b) => (PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b)) || a.localeCompare(b));
                    return (
                      <tr key={row.employee_id || row.employee_name}>
                        <td className="emp-cell">
                          <div className="calendar-emp-info">
                            <span>
                              {row.employee_id ? (
                                <Link to={`/employees/${row.employee_id}`} className="emp-name-link">{row.employee_name}</Link>
                              ) : (
                                row.employee_name
                              )}
                            </span>
                            {row.allocation_status && (
                              <span className={`calendar-allocation-badge ${(row.allocation_status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                                {row.allocation_status === 'Fully Allocated' ? 'Full' : row.allocation_status === 'Partially Allocated' ? 'Partial' : 'Available'}
                              </span>
                            )}
                            {row.remaining_hours != null && (
                              <span className="calendar-remaining-hint">{row.remaining_hours}h left</span>
                            )}
                            {rowPriorities.length > 0 && (
                              <div className="calendar-priority-pills" title="Working on priority tickets">
                                {rowPriorities.map((p) => (
                                  <span key={p} className="calendar-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[p] || '#6b7280' }}>{p}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        {Object.entries(row.days || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([day, cell]) => {
                          const items = cell.items || [];
                          const actualItems = cell.actual_items || [];
                          const isPastDay = new Date(day) < new Date(new Date().setHours(0, 0, 0, 0));
                          const hasActuals = isPastDay && ((cell.actual_hours != null && cell.actual_hours > 0) || (actualItems && actualItems.length > 0));
                          const displayHours = hasActuals ? cell.actual_hours : cell.hours;
                          const displayItems = hasActuals && actualItems.length > 0 ? actualItems : items;
                          
                          return (
                            <td
                              key={day}
                              className={`cell-hours clickable ${cell.total >= 8 ? 'full' : cell.hours > 0 ? 'partial' : 'empty'} ${hasActuals ? 'has-actuals' : ''}`}
                              title={hasActuals
                                ? `Plan: ${cell.hours}h | Actual: ${cell.actual_hours}h${cell.leave_hours > 0 ? ` | Leave: ${cell.leave_hours}h` : ''}. Click for details.`
                                : `${cell.hours}h allocated${cell.leave_hours > 0 ? `, ${cell.leave_hours}h leave` : ''}. Click for details.`}
                              onClick={() => openDayDetail(row.employee_name, day)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayDetail(row.employee_name, day); } }}
                            >
                              <span className="hours">
                                {hasActuals ? (
                                  <>
                                    <span className="plan-hours" title="planned">{cell.hours}h</span>
                                    <span className="actual-hours" title="actual">{cell.actual_hours}h</span>
                                  </>
                                ) : (
                                  (displayHours != null ? displayHours : 0) + 'h'
                                )}
                              </span>
                              {displayItems.length > 0 && (
                                <span className="labels">
                                  {displayItems.map((it, i) => {
                                    const cat = it.category || (it.ticket_id ? 'Ticket' : 'Miscellaneous');
                                    const color = TASK_CATEGORY_COLORS[cat] || TASK_CATEGORY_COLORS.Miscellaneous;
                                    const baseLabel = it.text || (it.ticket_id ? `#${it.ticket_id}` : (it.category || it.description || 'Task'));
                                    return (
                                      <span key={i} className="qa-calendar-cell-task">
                                        {i > 0 && ' '}
                                        {it.ticket_priority && (
                                          <span
                                            className="qa-calendar-cell-priority-pill"
                                            style={{ backgroundColor: PRIORITY_COLORS[it.ticket_priority] || '#6b7280' }}
                                            title={`Priority: ${it.ticket_priority}`}
                                          >
                                            {it.ticket_priority}
                                          </span>
                                        )}
                                        {it.ticket_id ? (
                                          <a
                                            href={getTicketTrackingUrl(it.ticket_id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="cell-task-link"
                                            style={{ color }}
                                            onClick={(e) => e.stopPropagation()}
                                            title={it.ticket_priority ? `Priority: ${it.ticket_priority}` : undefined}
                                          >
                                            {baseLabel}
                                          </a>
                                        ) : (
                                          <span className="cell-task-label" style={{ color }} title={it.ticket_priority ? `Priority: ${it.ticket_priority}` : undefined}>{baseLabel}</span>
                                        )}
                                      </span>
                                    );
                                  })}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="total-col">{totalHours}h</td>
                        <td className="avg-col">{avgHours}h</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {view === 'resource-blocked' && (
        <div className="resource-blocked-view">
          <div className="resource-blocked-header">
            <h2 className="resource-blocked-title">Resource Blocked Until – QA Planning</h2>
            <p className="resource-blocked-subtitle">See when each QA resource is blocked based on current allocations. If a task fails early (e.g. after one hour or one day), use &quot;QA resource is free&quot; so another task can be assigned—optional.</p>
            <div className="resource-blocked-week-nav">
              <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() - 7); setWeekStart(formatAPIDate(d)); }} aria-label="Previous week">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <label className="dev-planner-week-display">
                <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="dev-planner-week-picker" title="Week" />
                <span className="dev-planner-week-label">{formatPlanningWeek(weekStart)}</span>
              </label>
              <button type="button" className="dev-planner-nav-btn" onClick={() => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() + 7); setWeekStart(formatAPIDate(d)); }} aria-label="Next week">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button type="button" className="dev-planner-today-btn" onClick={() => setWeekStart(formatAPIDate(getWeekMonday(new Date())))}>Today</button>
            </div>
          </div>
          {loading ? (
            <div className="qa-planning-skeleton">Loading…</div>
          ) : !weekData ? (
            <div className="qa-planning-empty">
              <p>No planning data. Create a week from the Weekly Planner first.</p>
              <button type="button" className="btn-secondary" onClick={() => { setView('planner'); loadWeekData(); }}>Go to Weekly Planner</button>
            </div>
          ) : (
            <div className="resource-blocked-table-wrap">
              <table className="resource-blocked-table">
                <thead>
                  <tr>
                    <SortableHeader columnKey="employee_name" onSort={handleSort} sortConfig={sortConfig}>Employee</SortableHeader>
                    <SortableHeader columnKey="role" onSort={handleSort} sortConfig={sortConfig}>Role</SortableHeader>
                    <SortableHeader columnKey="allocated_hours" onSort={handleSort} sortConfig={sortConfig}>Allocated (h)</SortableHeader>
                    <th>Tasks (Priority)</th>
                    <th>Blocked Until</th>
                    <SortableHeader columnKey="allocation_status" onSort={handleSort} sortConfig={sortConfig}>Status</SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {(sortedEmployees || []).map((emp) => {
                    const tasks = weekData?.tasks || [];
                    let maxDate = null;
                    const empTasks = [];
                    for (const t of tasks) {
                      const nameMatch = t.employee_name === emp.employee_name;
                      const idMatch = t.employee_id != null && emp.employee_id != null && String(t.employee_id) === String(emp.employee_id);
                      if (!nameMatch && !idMatch) continue;
                      const releaseDateStr = t.resource_released_at ? (t.resource_released_at.slice && t.resource_released_at.slice(0, 10)) || null : null;
                      for (const a of t.allocations || []) {
                        if (!a.date) continue;
                        if (releaseDateStr && a.date >= releaseDateStr) continue;
                        if (!maxDate || a.date > maxDate) maxDate = a.date;
                      }
                      const label = t.ticket_id ? `#${t.ticket_id}` : (t.generic_category || 'Task');
                      const pri = t.ticket_priority ? ` (${t.ticket_priority})` : '';
                      empTasks.push({
                        task_id: t.id,
                        ticket_id: t.ticket_id,
                        label,
                        priority: t.ticket_priority,
                        full: `${label}${pri}`,
                        resource_released_at: t.resource_released_at,
                      });
                    }
                    const statusKey = (emp.allocation_status || '').toLowerCase().replace(/\s+/g, '-');
                    return (
                      <tr key={emp.employee_id}>
                        <td>
                          <Link to={`/employees/${emp.employee_id}`} className="resource-blocked-emp-link">{emp.employee_name}</Link>
                        </td>
                        <td>{emp.role || 'QA'}</td>
                        <td>{emp.allocated_hours ?? 0}h</td>
                        <td className="resource-blocked-tasks-cell">
                          {empTasks.length === 0 ? (
                            <span className="resource-blocked-available">—</span>
                          ) : (
                            <span className="resource-blocked-task-list" title={empTasks.map((x) => x.full).join(', ')}>
                              {empTasks.map((task, idx) => (
                                <span key={idx} className="resource-blocked-task-item">
                                  {task.priority && (
                                    <span className="resource-blocked-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#6b7280' }} title={`Priority: ${task.priority}`}>{task.priority}</span>
                                  )}
                                  {task.ticket_id ? (
                                    <Link to={`/tickets?ticket=${task.ticket_id}`} className="resource-blocked-task-link" onClick={(e) => e.stopPropagation()}>
                                      {task.label}
                                    </Link>
                                  ) : (
                                    task.label
                                  )}
                                  {!task.resource_released_at && task.task_id && emp.can_manage_tasks && (
                                    <button
                                      type="button"
                                      className="resource-blocked-release-btn"
                                      onClick={(e) => { e.stopPropagation(); releaseQAResource(task.task_id); }}
                                      title="Task failed or stopped early? Mark QA resource as free so another task can be assigned (optional)"
                                    >
                                      QA resource is free
                                    </button>
                                  )}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="resource-blocked-date-cell">
                          {maxDate ? formatDisplayDateWithDay(maxDate) : <span className="resource-blocked-available">Available</span>}
                        </td>
                        <td>
                          <span className={`resource-blocked-status ${statusKey}`}>
                            {emp.allocation_status === 'Fully Allocated' ? 'Full' : emp.allocation_status === 'Partially Allocated' ? 'Partial' : 'Available'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'qc-review-fail' && (
        <div className="qa-overview-container qa-qc-review-fail-view">
          <div className="qa-overview-header">
            <h2 className="qa-overview-title">QC Review Fail Status – Tickets List</h2>
            <span className="qa-overview-subtitle">
              Tickets in QC Review Fail, Tested - Awaiting Fixes, or Code Review Failed. Sorted by priority and days in fail status.
            </span>
          </div>
          {qcReviewFailLoading ? (
            <div className="qa-planning-skeleton">Loading QC Review Fail list…</div>
          ) : !qcReviewFailData ? (
            <div className="qa-planning-empty">
              <p>Failed to load QC Review Fail tickets.</p>
              <button type="button" className="btn-secondary" onClick={() => loadQcReviewFailData()}>Retry</button>
            </div>
          ) : (
            <section className="qa-tickets-section">
              <div className="qa-tickets-header">
                <h3 className="qa-tickets-title">
                  Tickets in QC Review Fail status
                  <span className="qa-tickets-count">{qcReviewFailData.total ?? (qcReviewFailData.tickets?.length ?? 0)} tickets</span>
                </h3>
              </div>
              <div className="qa-tickets-table-wrap">
                <table className="qa-tickets-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortableHeader columnKey="ticket_id" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Ticket</SortableHeader>
                      <SortableHeader columnKey="title" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Title</SortableHeader>
                      <SortableHeader columnKey="priority" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Priority</SortableHeader>
                      <SortableHeader columnKey="status" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Status</SortableHeader>
                      <SortableHeader columnKey="days_in_fail" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Days in fail</SortableHeader>
                      <SortableHeader columnKey="times_moved_to_fail" onSort={handleSortQcReviewFail} sortConfig={sortQcReviewFail}>Times in fail</SortableHeader>
                      <th>Module</th>
                      <th>Platform</th>
                      <th>QC Tester</th>
                      <th>QA Lead</th>
                      <th>Dev(s)</th>
                      <th>QA Est</th>
                      <th>QA Actual</th>
                      <th>Moved to QC</th>
                      <th>Moved to fail</th>
                      <th>ETA</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedQcReviewFailTickets.length === 0 ? (
                      <tr>
                        <td colSpan={18} className="qa-table-empty">No tickets in QC Review Fail status.</td>
                      </tr>
                    ) : (
                      sortedQcReviewFailTickets.map((t, idx) => (
                        <tr key={t.ticket_id} className="qa-ticket-row">
                          <td className="qa-rank">{idx + 1}</td>
                          <td className="qa-ticket-id-cell">
                            <Link to={`/tickets?ticket=${t.ticket_id}`} className="qa-ticket-link">#{t.ticket_id}</Link>
                            <TicketExternalLink ticketId={t.ticket_id} />
                          </td>
                          <td className="qa-title-cell" title={t.title}>{t.title?.slice(0, 45)}{(t.title?.length || 0) > 45 ? '…' : ''}</td>
                          <td>
                            <span className="qa-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[t.priority] || '#6b7280' }}>{t.priority}</span>
                          </td>
                          <td>
                            <span className="qa-status-pill" style={{ borderColor: STATUS_COLORS[t.status] || '#6b7280' }}>{t.status}</span>
                          </td>
                          <td className="qa-ageing-cell">{t.days_in_fail != null ? `${t.days_in_fail}d` : '—'}</td>
                          <td className="qa-times-in-fail-cell" title="Number of times this ticket has been moved to QC Review Fail (or Tested - Awaiting Fixes, Code Review Failed)">
                            {t.times_moved_to_fail != null && t.times_moved_to_fail > 0 ? t.times_moved_to_fail : (t.times_moved_to_fail === 0 ? '0' : '—')}
                          </td>
                          <td title={t.module || ''}>{t.module || '—'}</td>
                          <td>
                            <span className={`qa-platform-badge ${(t.platform || 'Web').toLowerCase()}`}>{t.platform || 'Web'}</span>
                          </td>
                          <td title={t.qc_tester || ''}>{t.qc_tester || '—'}</td>
                          <td title={t.qa_lead || ''}>{t.qa_lead || '—'}</td>
                          <td title={t.developers_str || ''}>{t.developers_str || 'Not Assigned'}</td>
                          <td>{t.qa_estimate_hours != null ? `${t.qa_estimate_hours}h` : '—'}</td>
                          <td>{t.qa_actual_hours != null ? `${t.qa_actual_hours}h` : '—'}</td>
                          <td>{t.moved_to_qc_on ? formatDisplayDate(t.moved_to_qc_on) : '—'}</td>
                          <td>{t.moved_to_fail_on ? formatDisplayDate(t.moved_to_fail_on) : '—'}</td>
                          <td>{t.eta ? formatDisplayDate(t.eta) : '—'}</td>
                          <td className="qa-actions-cell">
                            <button type="button" className="qa-action-btn qa-btn-view" onClick={() => goToTicket(t.ticket_id)} title="View in Tickets">View</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Multi-tester plan modal */}
      {multiPlanOpen && multiPlanTicket && (
        <div className="qa-modal-overlay" onClick={closeMultiPlanModal}>
          <div className="qa-modal qa-multi-plan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qa-modal-header">
              <h3>Assign Ticket to Multiple Testers</h3>
              <button type="button" className="qa-modal-close" onClick={closeMultiPlanModal} title="Close">×</button>
            </div>
            
            <div className="qa-ticket-info">
              <div className="qa-ticket-info-header">
                <span className="qa-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[multiPlanTicket.priority] || '#6b7280' }}>
                  {multiPlanTicket.priority}
                </span>
                <strong>#{multiPlanTicket.ticket_id}</strong>
              </div>
              <p className="qa-ticket-info-title">{multiPlanTicket.title}</p>
              {multiPlanTicket.qa_estimate_hours != null && multiPlanTicket.qa_estimate_hours > 0 ? (
                <p className="qa-ticket-info-estimate">QA Estimate: {multiPlanTicket.qa_estimate_hours}h</p>
              ) : (
                <p className="qa-ticket-info-estimate qa-estimate-warning">⚠ No QA Estimate set</p>
              )}
              {!(multiPlanTicket.qc_tester || '').trim() && (
                <p className="qa-ticket-info-estimate qa-estimate-warning">⚠ QC Tester required in PM Tracker</p>
              )}
              {multiPlanErrors.ticket && <div className="qa-form-error qa-form-error-block">{multiPlanErrors.ticket}</div>}
            </div>

            <div className="qa-form-group">
              <label>Task Type *</label>
              <select
                value={multiPlanForm.task_type || ''}
                onChange={(e) => setMultiPlanForm({ ...multiPlanForm, task_type: e.target.value })}
              >
                <option value="">Select task type</option>
                {QA_TASK_TYPES.map((tt) => (
                  <option key={tt} value={tt}>{tt}</option>
                ))}
              </select>
              {multiPlanErrors.task_type && <span className="qa-form-error">{multiPlanErrors.task_type}</span>}
            </div>

            {multiPlanResults ? (
              <div className="qa-multi-plan-results">
                {multiPlanResults.success.length > 0 && (
                  <div className="qa-multi-plan-success">
                    <strong>✓ Created {multiPlanResults.success.length} task(s):</strong>
                    <ul>
                      {multiPlanResults.success.map((r, i) => (
                        <li key={i}>{r.employee}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {multiPlanResults.failed.length > 0 && (
                  <div className="qa-multi-plan-failed">
                    <strong>✗ Failed {multiPlanResults.failed.length}:</strong>
                    <ul>
                      {multiPlanResults.failed.map((r, i) => (
                        <li key={i}>{r.employee}: {r.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="qa-modal-actions">
                  <button type="button" className="qa-btn-primary" onClick={closeMultiPlanModal}>Close</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitMultiPlan}>
                <div className="qa-form-group">
                  <label>Select Testers *</label>
                  <div className="qa-multi-select-list">
                    {(employees || []).filter((emp) => emp.can_manage_tasks !== false && emp.employee_id !== user?.employee_id).map((emp) => (
                      <label key={emp.employee_id} className={`qa-multi-select-item ${multiPlanSelectedTesters.includes(emp.employee_id) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={multiPlanSelectedTesters.includes(emp.employee_id)}
                          onChange={() => toggleMultiPlanTester(emp.employee_id)}
                        />
                        <span className="qa-emp-name">{emp.employee_name}</span>
                        <span className="qa-emp-hours">{emp.remaining_hours || (HOURS_PER_WEEK - (emp.allocated_hours || 0))}h available</span>
                      </label>
                    ))}
                  </div>
                  {multiPlanErrors.testers && <span className="qa-form-error">{multiPlanErrors.testers}</span>}
                </div>

                <div className="qa-form-group">
                  <label>Task Description *</label>
                  <textarea
                    value={multiPlanForm.activity_description}
                    onChange={(e) => setMultiPlanForm({ ...multiPlanForm, activity_description: e.target.value })}
                    rows={2}
                    placeholder="What will be done?"
                  />
                  {multiPlanErrors.activity_description && <span className="qa-form-error">{multiPlanErrors.activity_description}</span>}
                </div>

                <div className="qa-form-row-grid">
                  <div className="qa-form-group">
                    <label>Start Date *</label>
                    <input
                      type="date"
                      value={multiPlanForm.start_date}
                      onChange={(e) => setMultiPlanForm({ ...multiPlanForm, start_date: e.target.value })}
                    />
                    {multiPlanErrors.start_date && <span className="qa-form-error">{multiPlanErrors.start_date}</span>}
                  </div>
                  <div className="qa-form-group">
                    <label>Duration per tester (hours)</label>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={multiPlanForm.total_hours}
                      onChange={(e) => setMultiPlanForm({ ...multiPlanForm, total_hours: parseFloat(e.target.value) || 8 })}
                    />
                    {multiPlanErrors.total_hours && <span className="qa-form-error">{multiPlanErrors.total_hours}</span>}
                  </div>
                </div>

                <div className="qa-form-row-grid">
                  <div className="qa-form-group">
                    <label>Max hours per day</label>
                    <select
                      value={multiPlanForm.max_hours_per_day}
                      onChange={(e) => setMultiPlanForm({ ...multiPlanForm, max_hours_per_day: parseFloat(e.target.value) })}
                    >
                      {MAX_HOURS_PER_DAY_OPTIONS.map((h) => (
                        <option key={h} value={h}>{h}h</option>
                      ))}
                    </select>
                    {multiPlanErrors.max_hours_per_day && <span className="qa-form-error">{multiPlanErrors.max_hours_per_day}</span>}
                  </div>
                </div>

                {multiPlanErrors.submit && <div className="qa-form-error qa-form-error-block">{multiPlanErrors.submit}</div>}

                <div className="qa-modal-actions">
                  <button type="button" onClick={closeMultiPlanModal}>Cancel</button>
                  <button type="submit" className="qa-btn-primary" disabled={multiPlanSubmitting}>
                    {multiPlanSubmitting ? 'Creating...' : `Assign to ${multiPlanSelectedTesters.length} Tester${multiPlanSelectedTesters.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add Task Modal (single employee) */}
      {addTaskOpen && (
        <div className="qa-modal-overlay" onClick={closeAddTask}>
          <div className="qa-modal qa-add-task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qa-modal-header">
              <h3>Add QA Task</h3>
              <button type="button" className="qa-modal-close" onClick={closeAddTask} title="Close">×</button>
            </div>
            
            {addTaskEmployee && form.task_category !== 'Ticket' && (
              <p className="qa-modal-subtitle">
                Assigning to: <strong>{addTaskEmployee.employee_name}</strong>
                ({addTaskEmployee.remaining_hours || (HOURS_PER_WEEK - (addTaskEmployee.allocated_hours || 0))}h available)
              </p>
            )}
            
            <form onSubmit={submitAddTask}>
              <div className="qa-form-group">
                <label>Task Category *</label>
                <select 
                  value={form.task_category} 
                  onChange={(e) => {
                    const cat = e.target.value;
                    const updates = { task_category: cat, ticket_id: null, ticket_id_input: '', task_type: cat === 'Ticket' ? 'Manual Testing' : '', generic_category: cat !== 'Ticket' ? cat : '' };
                    if (cat === 'Leave') {
                      updates.total_hours = 8;
                      updates.max_hours_per_day = 8;
                    }
                    setForm({ ...form, ...updates });
                    setLookedUpTicket(null);
                    if (cat === 'Ticket' && addTaskEmployee && addTaskSelectedTesters.length === 0) {
                      setAddTaskSelectedTesters([addTaskEmployee.employee_id]);
                    }
                  }}
                >
                  {TASK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {formErrors.task_category && <span className="qa-form-error">{formErrors.task_category}</span>}
              </div>

              {form.task_category === 'Ticket' && (
                <div className="qa-form-group">
                  <label>Assign to Tester(s) *</label>
                  <div className="qa-multi-select-list">
                    {(weekData?.employees || []).filter((emp) => emp.can_manage_tasks !== false && emp.employee_id !== user?.employee_id).map((emp) => {
                      const avail = selectedTestersAvailability[emp.employee_id];
                      const isSelected = addTaskSelectedTesters.includes(emp.employee_id);
                      const weeklyHours = emp.remaining_hours ?? (HOURS_PER_WEEK - (emp.allocated_hours || 0));
                      const startDateHours = form.start_date && avail ? avail.availableOnStartDate : null;
                      const hasAllocError = isSelected && avail?.allocationError;
                      return (
                        <label key={emp.employee_id} className={`qa-multi-select-item ${isSelected ? 'selected' : ''} ${hasAllocError ? 'qa-alloc-error' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAddTaskTester(emp.employee_id)}
                          />
                          <span className="qa-emp-name">{emp.employee_name}</span>
                          <span className="qa-emp-hours">
                            ({weeklyHours}h week
                            {startDateHours != null && ` · ${startDateHours}h on start date`})
                          </span>
                          {hasAllocError && <span className="qa-emp-alloc-error" title={avail.allocationError}>⚠</span>}
                        </label>
                      );
                    })}
                  </div>
                  {addTaskSelectedTesters.length > 1 && form.start_date && Object.keys(selectedTestersAvailability).length > 0 && (
                    <div className="qa-availability-summary">
                      <strong>On start date:</strong>{' '}
                      {addTaskSelectedTesters.map((id) => {
                        const emp = (weekData?.employees || []).find((e) => e.employee_id === id);
                        const a = selectedTestersAvailability[id];
                        if (!emp || !a) return null;
                        return `${emp.employee_name}: ${a.availableOnStartDate}h${a.allocationError ? ' ⚠' : ''}`;
                      }).filter(Boolean).join(', ')}
                    </div>
                  )}
                  {formErrors.testers && <span className="qa-form-error">{formErrors.testers}</span>}
                </div>
              )}

              {form.task_category === 'Ticket' && (
                <div className="qa-form-group qa-ticket-search-group" ref={ticketInputRef}>
                  {!form.ticket_id && !(form.ticket_id_input || '').trim() && (
                    <div className="qa-ticket-suggestions-categorized">
                      <p className="qa-suggestions-help">Suggested tickets – select one to assign:</p>
                      {ticketSuggestionsLoading ? (
                        <p className="qa-suggestions-loading">Loading suggestions…</p>
                      ) : ticketSuggestionsCategorized ? (
                        <div className="qa-suggestions-categories">
                          {[
                            { key: 'next_in_queue', label: 'Next in queue (by priority)', list: ticketSuggestionsCategorized.next_in_queue || [] },
                            { key: 'on_hold', label: 'On hold (next when released)', list: ticketSuggestionsCategorized.on_hold || [] },
                            { key: 'for_retesting', label: 'For retesting (after QC fail)', list: ticketSuggestionsCategorized.for_retesting || [] },
                            { key: 'ageing', label: 'Ageing in QA (most days)', list: ticketSuggestionsCategorized.ageing || [] },
                          ].filter((c) => c.list.length > 0).map((cat) => (
                            <div key={cat.key} className="qa-suggestion-category">
                              <span className="qa-suggestion-category-label">{cat.label}</span>
                              <div className="qa-suggestion-category-items">
                                {cat.list.map((t) => (
                                  <button
                                    key={t.ticket_id}
                                    type="button"
                                    className="qa-suggestion-chip"
                                    onClick={() => selectTicket(t)}
                                    title={t.title}
                                  >
                                    <span className={`qa-sug-platform qa-platform-${(t.platform || 'web').toLowerCase()}`}>{t.platform || 'Web'}</span>
                                    <span className="qa-sug-id">#{t.ticket_id}</span>
                                    <span className="qa-sug-title">{t.title?.slice(0, 35)}{(t.title?.length || 0) > 35 ? '…' : ''}</span>
                                    <span className="qa-sug-meta">{t.qa_estimate_hours ? `${t.qa_estimate_hours}h` : ''} {t.days_in_qc > 0 ? `· ${t.days_in_qc}d` : ''}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <label>Ticket ID *</label>
                  <input
                    type="text"
                    value={form.ticket_id_input}
                    onChange={(e) => setForm({ ...form, ticket_id_input: e.target.value, ticket_id: null })}
                    onFocus={() => ticketSuggestions.length > 0 && setShowTicketSuggestions(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const raw = (form.ticket_id_input || '').trim();
                        const id = raw ? parseInt(raw, 10) : NaN;
                        if (!Number.isNaN(id) && id > 0) fetchTicketDetails(id);
                      }
                    }}
                    placeholder="Select from suggestions below or type a ticket ID and press Enter"
                    autoComplete="off"
                  />
                  <p className="qa-ticket-id-hint">Suggested tickets are shown above. For tickets in other statuses (e.g. DEV, BIS), enter the ticket ID and press <kbd>Enter</kbd> to load and create a task.</p>
                  {ticketLookupLoading && <span className="qa-loading-hint">Looking up...</span>}
                  {showTicketSuggestions && ticketSuggestions.length > 0 && (
                    <div className="qa-ticket-suggestions" ref={ticketSuggestionsRef}>
                      {ticketSuggestions.map((t) => (
                        <button
                          key={t.ticket_id}
                          type="button"
                          className="qa-ticket-suggestion-item"
                          onClick={() => selectTicket(t)}
                        >
                          <span className="qa-sug-id">#{t.ticket_id}</span>
                          <span className="qa-sug-title">{t.title?.slice(0, 40)}{(t.title?.length || 0) > 40 ? '…' : ''}</span>
                          <span className="qa-sug-meta">{t.qa_estimate_hours ? `${t.qa_estimate_hours}h` : '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {formErrors.ticket_id && <span className="qa-form-error">{formErrors.ticket_id}</span>}
                </div>
              )}

              {form.task_category === 'Ticket' && (
                <div className="qa-form-group">
                  <label>Task Type *</label>
                  <select
                    value={form.task_type || ''}
                    onChange={(e) => setForm({ ...form, task_type: e.target.value })}
                  >
                    <option value="">Select task type</option>
                    {QA_TASK_TYPES.map((tt) => (
                      <option key={tt} value={tt}>{tt}</option>
                    ))}
                  </select>
                  {formErrors.task_type && <span className="qa-form-error">{formErrors.task_type}</span>}
                </div>
              )}

              {lookedUpTicket && (
                <div className="qa-ticket-details-card">
                  <div className="qa-ticket-card-header">
                    <div className="qa-ticket-card-header-content">
                      <span className="qa-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[lookedUpTicket.priority] || '#6b7280' }}>
                        {lookedUpTicket.priority}
                      </span>
                      <strong>#{lookedUpTicket.ticket_id}</strong>
                      <span className="qa-ticket-card-title">{lookedUpTicket.title?.slice(0, 50)}{(lookedUpTicket.title?.length || 0) > 50 ? '…' : ''}</span>
                    </div>
                    <button
                      type="button"
                      className="qa-ticket-card-refresh"
                      onClick={() => form.ticket_id && refreshTicketFromPM(form.ticket_id)}
                      disabled={ticketLookupLoading}
                      title="Refresh this ticket from PM Tracker (QC Tester, QA Estimate, Status)"
                    >
                      {ticketLookupLoading ? '…' : '↻ Refresh'}
                    </button>
                  </div>
                  <div className="qa-ticket-card-body">
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">QA Estimate</span>
                      <span className="qa-field-value">{lookedUpTicket.qa_estimate_hours ?? '—'}h</span>
                    </div>
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">Remaining</span>
                      <span className="qa-field-value">{lookedUpTicket.remaining_qa_hours ?? lookedUpTicket.qa_estimate_hours ?? '—'}h</span>
                    </div>
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">Status</span>
                      <span className="qa-field-value">{lookedUpTicket.status || '—'}</span>
                    </div>
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">QC Tester</span>
                      <span className={`qa-field-value ${!(lookedUpTicket.qc_tester || '').trim() ? 'qa-field-missing' : ''}`}>
                        {lookedUpTicket.qc_tester || '— (Required in PM)'}
                      </span>
                    </div>
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">Actual QA</span>
                      <span className="qa-field-value">{lookedUpTicket.actual_qa_hours != null ? `${lookedUpTicket.actual_qa_hours}h` : '—'}</span>
                    </div>
                    <div className="qa-ticket-card-field">
                      <span className="qa-field-label">ETA</span>
                      <span className="qa-field-value">
                        {(lookedUpTicket.eta || '').trim() ? formatDisplayDate(lookedUpTicket.eta.slice(0, 10)) : '— (Optional)'}
                      </span>
                    </div>
                  </div>
                  {lookedUpTicket.in_qc_status === false && (
                    <div className="qa-ticket-card-info">
                      This ticket is not in the QA queue; you can still create a task at your discretion.
                    </div>
                  )}
                  {['QC Review Fail', 'Code Review Failed'].includes(lookedUpTicket.status) && (
                    <div className="qa-ticket-card-warning">
                      This ticket was returned from review. Consider addressing feedback before allocating more time.
                    </div>
                  )}
                  {lookedUpTicket.in_qc_status !== false && (lookedUpTicket.qa_estimate_hours == null || lookedUpTicket.qa_estimate_hours <= 0) && (
                    <div className="qa-ticket-card-warning">
                      QA Estimate is required in PM Tracker. Add it and click Refresh.
                    </div>
                  )}
                  {lookedUpTicket.in_qc_status !== false && !(lookedUpTicket.qc_tester || '').trim() && (
                    <div className="qa-ticket-card-warning">
                      QC Tester is required in PM Tracker. Assign and click Refresh.
                    </div>
                  )}
                  {(lookedUpTicket.eta || '').trim() && lookedUpTicket.eta.slice(0, 10) < formatAPIDate(new Date()) && (
                    <div className="qa-ticket-card-warning">
                      ETA is past. Update ETA in PM Tracker and click Refresh before creating the task.
                    </div>
                  )}
                </div>
              )}

              <div className="qa-form-group">
                <label>Task Description *</label>
                <input 
                  type="text" 
                  value={form.activity_description} 
                  onChange={(e) => setForm({ ...form, activity_description: e.target.value })} 
                  placeholder="What will be done?"
                />
                {formErrors.activity_description && <span className="qa-form-error">{formErrors.activity_description}</span>}
              </div>

              {addTaskAvailabilitySummary && (
                <div className="availability-summary qa-availability-summary">
                  <div className="availability-summary-row">
                    <span className="availability-summary-label">Fully available from:</span>
                    <span className="availability-summary-value">{formatDisplayDateWithDay(addTaskAvailabilitySummary.next_fully_available_date)}</span>
                  </div>
                  {addTaskAvailabilitySummary.partial_this_week?.length > 0 && (
                    <div className="availability-summary-row">
                      <span className="availability-summary-label">Partially available this week (hours available):</span>
                      <span className="availability-summary-value">
                        {addTaskAvailabilitySummary.partial_this_week.map(({ date, available_hours }, i) => (
                          <React.Fragment key={date}>{i > 0 && ', '}{formatDisplayDateWithDay(date)} — {Number(available_hours)}h available</React.Fragment>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="qa-form-row-grid">
                <div className="qa-form-group">
                  <label>Start Date *</label>
                  <input 
                    type="date" 
                    value={form.start_date} 
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })} 
                  />
                  {formErrors.start_date && <span className="qa-form-error">{formErrors.start_date}</span>}
                  {startDateAvailable < 8 && form.start_date && (
                    <span className="qa-info-hint">Only {startDateAvailable}h available on this date</span>
                  )}
                </div>
                {form.task_category === 'Leave' ? (
                  <div className="qa-form-group">
                    <label>Leave type *</label>
                    <div className="qa-leave-type-options">
                      <label className={`qa-leave-type-option ${form.total_hours === 4 ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="leave_type"
                          checked={form.total_hours === 4}
                          onChange={() => setForm({ ...form, total_hours: 4, max_hours_per_day: 4 })}
                        />
                        Half Day (4h)
                      </label>
                      <label className={`qa-leave-type-option ${form.total_hours === 8 ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="leave_type"
                          checked={form.total_hours === 8}
                          onChange={() => setForm({ ...form, total_hours: 8, max_hours_per_day: 8 })}
                        />
                        Full Day (8h)
                      </label>
                    </div>
                    {formErrors.total_hours && <span className="qa-form-error">{formErrors.total_hours}</span>}
                  </div>
                ) : (
                  <div className="qa-form-group">
                    <label>Duration (hours) *</label>
                    <input 
                      type="number" 
                      min="0.5" 
                      step="0.5" 
                      value={form.total_hours} 
                      onChange={(e) => setForm({ ...form, total_hours: e.target.value })} 
                    />
                    {form.task_category === 'Ticket' && lookedUpTicket?.remaining_qa_hours != null && lookedUpTicket.remaining_qa_hours >= 0 && (
                      <span className="qa-info-hint">Max {lookedUpTicket.remaining_qa_hours}h remaining for this ticket</span>
                    )}
                    {formErrors.total_hours && <span className="qa-form-error">{formErrors.total_hours}</span>}
                  </div>
                )}
              </div>

              {form.task_category !== 'Leave' && (
                <div className="qa-form-row-grid">
                  <div className="qa-form-group">
                    <label>Max hours per day for this task</label>
                    <select 
                      value={form.max_hours_per_day} 
                      onChange={(e) => setForm({ ...form, max_hours_per_day: parseFloat(e.target.value) })}
                    >
                      {MAX_HOURS_PER_DAY_OPTIONS.map((h) => (
                        <option key={h} value={h}>{h === 0.5 ? '30 min' : `${h}h`}{h > startDateAvailable ? ` (${startDateAvailable}h available on start date)` : ''}</option>
                      ))}
                    </select>
                    {startDateAvailable < 8 && (
                      <span className="qa-info-hint">
                        {form.task_category === 'Ticket' && addTaskSelectedTesters.length > 1
                          ? `Min ${startDateAvailable}h among selected testers on start date. Task will use available hours each day.`
                          : startDateAvailable > 0
                            ? `Start date has ${startDateAvailable}h available. Task will use available hours each day.`
                            : 'Start date is fully allocated. Task will start from next available day.'}
                      </span>
                    )}
                    {formErrors.max_hours_per_day && <span className="qa-form-error">{formErrors.max_hours_per_day}</span>}
                  </div>
                </div>
              )}

              {form.task_category !== 'Ticket' && GENERIC_CATEGORIES.includes(form.task_category) && (
                <div className="qa-form-group">
                  <label>Justification (optional)</label>
                  <input 
                    type="text" 
                    value={form.justification || ''} 
                    onChange={(e) => setForm({ ...form, justification: e.target.value })} 
                    placeholder="Why is this task needed?"
                  />
                </div>
              )}

              {allocationPreview && !allocationPreview.error && (
                <div className="qa-allocation-preview">
                  <strong>Allocation Preview:</strong>
                  <div className="qa-allocation-dist">
                    {allocationPreview.distribution.map((d, i) => (
                      <span key={i} className="qa-alloc-day">{formatDisplayDate(d.date)}: {d.hours}h</span>
                    ))}
                  </div>
                  <span className="qa-alloc-total">Total: {allocationPreview.total}h</span>
                </div>
              )}

              {allocationPreview?.error && (
                <div className="qa-allocation-preview qa-preview-error">
                  <strong>Cannot allocate:</strong> {allocationPreview.error}
                </div>
              )}

              {formErrors.submit && <div className="qa-form-error qa-form-error-block">{formErrors.submit}</div>}
              
              <div className="qa-modal-actions">
                <button type="button" onClick={closeAddTask}>Cancel</button>
                <button type="submit" className="qa-btn-primary" disabled={submitting || !!allocationPreview?.error}>
                  {submitting ? 'Adding…' : 'Add Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Task Modal (Manager / Lead) */}
      {editTaskOpen && editingTask && (
        <div className="qa-modal-overlay" onClick={closeEditTask}>
          <div className="qa-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: '400px' }}>
            <div className="qa-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Edit Task</h3>
              <button type="button" className="qa-modal-close" onClick={closeEditTask} title="Close">×</button>
            </div>
            <p className="qa-form-group" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
              {editingTask.ticket_id ? `#${editingTask.ticket_id}` : editingTask.activity_description?.slice(0, 50)} — {editingTask.employee_name}
            </p>
            <div className="qa-form-group">
              <label>Start Date *</label>
              <input
                type="date"
                value={editTaskForm.start_date}
                onChange={(e) => setEditTaskForm({ ...editTaskForm, start_date: e.target.value })}
              />
            </div>
            <div className="qa-form-group">
              <label>Total hours *</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={editTaskForm.total_hours}
                onChange={(e) => setEditTaskForm({ ...editTaskForm, total_hours: e.target.value })}
              />
            </div>
            <div className="qa-form-group">
              <label>Max hours per day</label>
              <select
                value={editTaskForm.max_hours_per_day}
                onChange={(e) => setEditTaskForm({ ...editTaskForm, max_hours_per_day: Number(e.target.value) })}
              >
                {MAX_HOURS_PER_DAY_OPTIONS.map((h) => (
                  <option key={h} value={h}>{h}h</option>
                ))}
              </select>
            </div>
            {editTaskError && <div className="qa-form-error qa-form-error-block">{editTaskError}</div>}
            <div className="qa-modal-actions" style={{ marginTop: '1rem' }}>
              <button type="button" onClick={closeEditTask}>Cancel</button>
              <button type="button" className="qa-btn-primary" onClick={submitEditTask} disabled={editTaskSubmitting}>
                {editTaskSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hold Task Modal */}
      {holdTaskOpen && holdingTask && (
        <div className="qa-modal-overlay" onClick={closeHoldTaskModal}>
          <div className="qa-modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: '450px' }}>
            <div className="qa-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Put Task on Hold</h3>
              <button type="button" className="qa-modal-close" onClick={closeHoldTaskModal} title="Close">×</button>
            </div>
            <p className="qa-form-group" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
              #{holdingTask.ticket_id} — {holdingTask.activity_description?.slice(0, 50)} — {holdingTask.employee_name}
            </p>
            
            <div className="qa-form-group" style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-warning)', borderRadius: '6px', borderLeft: '4px solid var(--warning)' }}>
              <strong style={{ color: 'var(--warning)' }}>Important:</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                Before putting this task on hold, ensure the ticket status is updated to "QC Testing Hold" in PM Tracker.
              </p>
              <button
                type="button"
                className="qa-btn-secondary"
                style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                onClick={() => refreshPmTrackerForTicket(holdingTask.ticket_id)}
                disabled={pmTrackerRefreshing}
              >
                {pmTrackerRefreshing ? 'Refreshing…' : '↻ Refresh PM Tracker Status'}
              </button>
            </div>

            <form onSubmit={submitHoldTask}>
              <div className="qa-form-group">
                <label>Hold Type *</label>
                <select
                  value={holdTaskForm.hold_type}
                  onChange={(e) => setHoldTaskForm({ ...holdTaskForm, hold_type: e.target.value })}
                >
                  <option value="full">Entire Task (put full task on hold)</option>
                  <option value="day">Specific Day (hold only one day)</option>
                </select>
              </div>

              {holdTaskForm.hold_type === 'day' && (
                <div className="qa-form-group">
                  <label>Hold Date *</label>
                  <input
                    type="date"
                    value={holdTaskForm.hold_date}
                    min={holdingTask.start_date || formatAPIDate(new Date())}
                    max={holdingTask.end_date}
                    onChange={(e) => setHoldTaskForm({ ...holdTaskForm, hold_date: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="qa-form-group">
                <label>Reason for Hold *</label>
                <textarea
                  value={holdTaskForm.hold_reason}
                  onChange={(e) => setHoldTaskForm({ ...holdTaskForm, hold_reason: e.target.value })}
                  placeholder="e.g., New urgent ticket prioritized, Waiting for client clarification, etc."
                  rows={3}
                  style={{ width: '100%', resize: 'vertical' }}
                  required
                />
                <small style={{ color: 'var(--text-muted)' }}>This reason will appear in the QA Weekly Report.</small>
              </div>

              {holdTaskError && <div className="qa-form-error qa-form-error-block">{holdTaskError}</div>}
              
              <div className="qa-modal-actions" style={{ marginTop: '1rem' }}>
                <button type="button" onClick={closeHoldTaskModal}>Cancel</button>
                <button type="submit" className="qa-btn-warning" disabled={holdTaskSubmitting}>
                  {holdTaskSubmitting ? 'Saving…' : 'Put on Hold'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Calendar Day Detail Modal */}
      {dayDetailOpen && (
        <div className="dev-planning-modal-overlay" onClick={closeDayDetail}>
          <div className="dev-planning-modal dev-planning-day-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Tasks for {dayDetailDate ? formatDisplayDateWithDay(dayDetailDate) : ''}</h3>
              <button type="button" className="modal-close-btn" onClick={closeDayDetail} title="Close">×</button>
            </div>
            <p className="modal-subtitle">Employee: {dayDetailEmployee}</p>

            {dayDetailLoading ? (
              <div className="dev-planning-skeleton">Loading…</div>
            ) : dayDetailTasks.length === 0 ? (
              <div className="day-detail-empty">No tasks for this day.</div>
            ) : (
              <div className="day-detail-task-list">
                {/* Separate planned vs actual tasks */}
                {dayDetailTasks.some(t => t.is_planned) && (
                  <div className="day-detail-section">
                    <h4 className="day-detail-section-title">Planned Tasks</h4>
                    {dayDetailTasks.filter(t => t.is_planned).map((t, i) => (
                      <div key={t.task_id || `plan-${i}`} className="day-detail-task-item planned-task">
                        <div className="day-detail-task-header">
                          <span className="day-detail-task-id" style={{ color: TASK_CATEGORY_COLORS[t.category] || TASK_CATEGORY_COLORS.Miscellaneous }}>
                            {t.ticket_id ? (
                              <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" className="day-detail-ticket-link">
                                #{t.ticket_id}
                              </a>
                            ) : (
                              t.generic_category || 'Task'
                            )}
                          </span>
                          {t.ticket_priority && <span className="day-detail-priority-badge">{t.ticket_priority}</span>}
                          <span className="day-detail-task-hours planned">{t.hours}h</span>
                        </div>
                        <div className="day-detail-task-desc">{t.activity_description || 'No description'}</div>
                      </div>
                    ))}
                  </div>
                )}

                {dayDetailTasks.some(t => t.is_actual) && (
                  <div className="day-detail-section">
                    <h4 className="day-detail-section-title">Actual (Logged)</h4>
                    {dayDetailTasks.filter(t => t.is_actual).map((t, i) => (
                      <div key={`actual-${i}`} className="day-detail-task-item actual-task">
                        <div className="day-detail-task-header">
                          <span className="day-detail-task-id">
                            {t.ticket_id ? (
                              <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" className="day-detail-ticket-link">
                                #{t.ticket_id}
                              </a>
                            ) : (
                              t.project_name || 'Entry'
                            )}
                          </span>
                          <span className="day-detail-task-hours actual">{t.hours}h</span>
                        </div>
                        {t.task_description && <div className="day-detail-task-desc">{t.task_description}</div>}
                        {t.project_name && <div className="day-detail-task-project">{t.project_name}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default QATaskPlanning;
