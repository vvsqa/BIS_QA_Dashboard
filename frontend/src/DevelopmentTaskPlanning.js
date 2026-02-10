import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
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
import { Bar, Chart, Doughnut, Line } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { formatAPIDate, formatDisplayDate, formatDisplayDateWithDay, formatPlanningWeek } from './dateUtils';
import { getTicketTrackingUrl, TicketExternalLink } from './ticketUtils';
import { useTableSort } from './useTableSort';
import { apiFetch, API_BASE } from './api';
import { useAuth } from './AuthContext';
import './DevelopmentTaskPlanning.css';

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
  Filler,
  ChartDataLabels
);

const HOURS_PER_WEEK = 40;
const DEFAULT_USER_NAME = '';
const DEFAULT_USER_ROLE = '';
const TASK_CATEGORIES = ['Ticket', 'Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Miscellaneous'];
const GENERIC_CATEGORIES = ['Team Meetings', 'Customer Support', 'Training', 'KT', 'Leave', 'Miscellaneous'];
const TASK_CATEGORY_COLORS = {
  Ticket: '#60a5fa',
  'Team Meetings': '#a78bfa',
  'Customer Support': '#34d399',
  Training: '#fbbf24',
  KT: '#f97316',
  Leave: '#94a3b8',
  Miscellaneous: '#64748b',
};
// Max hours per day for a task: 0.5 to 8 in 0.5 increments (dropdown only)
const MAX_HOURS_PER_DAY_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];

// Priority colors for badges
const PRIORITY_COLORS = {
  'URGENT': '#dc2626',
  'High (Bugs)': '#ea580c',
  'High': '#f97316',
  'Medium': '#eab308',
  'Low': '#22c55e',
  'Unspecified': '#6b7280'
};

function getWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function DevelopmentTaskPlanning({ showParentTitle = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
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
  const [selectedCategory, setSelectedCategory] = useState(null); // { type: 'dev'|'qa', key: string, label: string, tickets: [] }
  const ticketListRef = useRef(null);
  const [calendarView, setCalendarView] = useState('weekly'); // weekly | monthly
  const [weekStart, setWeekStart] = useState(() => formatAPIDate(getWeekMonday(new Date())));
  const [weekData, setWeekData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addTaskEmployee, setAddTaskEmployee] = useState(null);
  const [addTaskModalTab, setAddTaskModalTab] = useState('details'); // details | resource-blocked
  const [calendarData, setCalendarData] = useState(null);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketSearchDebounced, setTicketSearchDebounced] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState('');
  const [ticketAssigneeFilter, setTicketAssigneeFilter] = useState('');
  const [ticketUnassignedFilter, setTicketUnassignedFilter] = useState(false);
  const [hasEstimateFilter, setHasEstimateFilter] = useState(null);
  const [ticketFilterOptions, setTicketFilterOptions] = useState({ statuses: [], priorities: [], assignees: [] });
  const [resourceFilter, setResourceFilter] = useState('all'); // all | available | partial | full
  const [plannerEmployeeSearch, setPlannerEmployeeSearch] = useState('');
  const [plannerViewMode, setPlannerViewMode] = useState('grid'); // grid | list

  const [form, setForm] = useState({
    employee_name: '',
    employee_id: '',
    task_category: 'Ticket',
    ticket_id: null,
    ticket_id_input: '',
    activity_description: '',
    start_date: '',
    end_date: '',
    total_hours: 8,
    max_hours_per_day: 8,
    generic_category: '',
    justification: '',
  });
  const [lookedUpTicket, setLookedUpTicket] = useState(null);
  const [ticketSuggestions, setTicketSuggestions] = useState([]);
  const [showTicketSuggestions, setShowTicketSuggestions] = useState(false);
  const [ticketLookupLoading, setTicketLookupLoading] = useState(false);
  const ticketInputRef = useRef(null);
  const ticketSuggestionsRef = useRef(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [allocationPreview, setAllocationPreview] = useState(null); // { distribution: [{date, hours}], total, max_available_on_start_date } or { error }
  const [startDateAvailable, setStartDateAvailable] = useState(8); // Max available hours on selected start date
  const hasOpenedFromLink = useRef(false);

  // Multi-user plan modal state
  const [multiPlanOpen, setMultiPlanOpen] = useState(false);
  const [multiPlanTicket, setMultiPlanTicket] = useState(null); // { ticket_id, title, dev_estimate_hours, ... }
  const [multiPlanSelectedEmployees, setMultiPlanSelectedEmployees] = useState([]); // array of employee_id
  const [multiPlanForm, setMultiPlanForm] = useState({
    activity_description: '',
    start_date: '',
    total_hours: 8,
    max_hours_per_day: 8,
  });
  const [multiPlanErrors, setMultiPlanErrors] = useState({});
  const [multiPlanSubmitting, setMultiPlanSubmitting] = useState(false);
  const [multiPlanResults, setMultiPlanResults] = useState(null); // { success: [], failed: [] }

  // Edit task modal state
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null); // full task object with allocations
  const [editAllocations, setEditAllocations] = useState([]); // editable copy of allocations
  const [editTaskSubmitting, setEditTaskSubmitting] = useState(false);
  const [editTaskError, setEditTaskError] = useState(null);

  // Calendar day detail modal
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [dayDetailEmployee, setDayDetailEmployee] = useState(null);
  const [dayDetailDate, setDayDetailDate] = useState(null);
  const [dayDetailTasks, setDayDetailTasks] = useState([]);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);

  const headers = () => ({
    'Content-Type': 'application/json',
    'X-User-Name': localStorage.getItem('devPlanningUserName') || DEFAULT_USER_NAME,
    'X-User-Role': localStorage.getItem('devPlanningUserRole') || DEFAULT_USER_ROLE,
  });

  const loadWeekData = useCallback(async () => {
    if (!weekStart) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/dev-planning/week/${encodeURIComponent(weekStart)}`;
      const res = await apiFetch(url);
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.detail || (j.message || text);
        } catch (_) {}
        if (res.status === 404) {
          msg = 'Dev Task Planning API not found. Restart the backend so the module loads: stop any process on port 8000, then run "python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000" from the backend folder (or run backend/restart_backend.ps1). If you use localhost, ensure only one backend is running on 8000.';
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text);
      setWeekData(data);
    } catch (e) {
      setError(e.message || 'Failed to load week data. Please verify the backend is reachable for your configured environment.');
      setWeekData(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  const loadTicketFilterOptions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/dev-planning/tickets/filter-options`);
      if (res.ok) {
        const data = await res.json();
        setTicketFilterOptions({
          statuses: data.statuses || [],
          priorities: data.priorities || [],
          assignees: data.assignees || [],
        });
      }
    } catch (_) {}
  }, []);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (ticketSearchDebounced) params.append('search', ticketSearchDebounced);
    if (ticketStatusFilter) params.append('status', ticketStatusFilter);
    if (ticketPriorityFilter) params.append('priority', ticketPriorityFilter);
    if (ticketAssigneeFilter) params.append('assignee', ticketAssigneeFilter);
    if (ticketUnassignedFilter) params.append('unassigned', 'true');
    if (hasEstimateFilter !== null) params.append('has_estimate', hasEstimateFilter);
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/tickets?${params}`);
      const data = res.ok ? await res.json() : { tickets: [] };
      setTickets(data.tickets || []);
    } catch (_) {
      setTickets([]);
    }
  }, [ticketSearchDebounced, ticketStatusFilter, ticketPriorityFilter, ticketAssigneeFilter, ticketUnassignedFilter, hasEstimateFilter]);

  const loadCalendarData = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ view: calendarView });
      if (calendarView === 'weekly') params.append('date_str', weekStart);
      else params.append('month_str', weekStart.slice(0, 7));
      const res = await apiFetch(`${API_BASE}/dev-planning/calendar?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setCalendarData(data);
    } catch (e) {
      setCalendarData(null);
      setError(e?.message || 'Failed to load calendar. Ensure the backend is running.');
    }
  }, [calendarView, weekStart]);

  const loadOverviewData = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/overview`);
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try { const j = JSON.parse(text); msg = j.detail || msg; } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setOverviewData(data);
    } catch (e) {
      setError(e.message || 'Failed to load overview data');
      setOverviewData(null);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => { loadWeekData(); }, [loadWeekData]);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { if (view === 'planner') loadTicketFilterOptions(); }, [view, loadTicketFilterOptions]);

  // Debounce search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => setTicketSearchDebounced(ticketSearch), 300);
    return () => clearTimeout(t);
  }, [ticketSearch]);
  useEffect(() => { if (view === 'calendar') loadCalendarData(); }, [view, loadCalendarData]);
  useEffect(() => { if (view === 'overview') loadOverviewData(); }, [view, loadOverviewData]);

  // Sync view when user role is determined (e.g. user loads after mount)
  useEffect(() => {
    if (isEmployeeRole && view !== 'my-tasks') setView('my-tasks');
  }, [isEmployeeRole]);

  useEffect(() => {
    if (selectedCategory && ticketListRef.current) {
      ticketListRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedCategory]);

  // Reset "opened from link" when URL params change so a new deep link can open the modal
  useEffect(() => {
    hasOpenedFromLink.current = false;
  }, [urlEmployeeId, urlTicketId]);

  // Deep-link: open Add Task once when employee_id is in URL and we have that employee
  useEffect(() => {
    if (!urlEmployeeId || !weekData?.employees?.length || addTaskOpen || hasOpenedFromLink.current) return;
    const emp = weekData.employees.find((e) => e.employee_id === urlEmployeeId);
    if (emp) {
      hasOpenedFromLink.current = true;
      const prefillTicketId = urlTicketId ? (parseInt(urlTicketId, 10) || null) : null;
      setAddTaskEmployee(emp);
      setForm({
        employee_name: emp.employee_name,
        employee_id: emp.employee_id,
        task_category: 'Ticket',
        ticket_id: prefillTicketId,
        ticket_id_input: prefillTicketId ? String(prefillTicketId) : '',
        activity_description: '',
        start_date: weekStart,
        end_date: '',
        total_hours: 8,
        max_hours_per_day: 8,
        generic_category: '',
        justification: '',
      });
      setFormErrors({});
      setAddTaskOpen(true);
    }
  }, [weekData?.employees, urlEmployeeId, urlTicketId, weekStart, addTaskOpen]);

  const ensureWeek = async () => {
    setActionLoading(true);
    try {
      await apiFetch(`${API_BASE}/dev-planning/week?week_start=${weekStart}`, { method: 'POST' });
      await loadWeekData();
    } finally {
      setActionLoading(false);
    }
  };

  const updateWeekState = async (state) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/week/${weekStart}`, {
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

  const openAddTask = (emp) => {
    setAddTaskEmployee(emp);
    const monday = weekStart;
    // Do NOT prefill from URL when user manually clicks Add Task - URL may have stale ticket_id from
    // a previous Plan click or navigation. Only the deep-link useEffect uses urlTicketId.
    const baseForm = getInitialFormState(emp, monday);
    setForm({
      ...baseForm,
      task_category: 'Ticket',
      ticket_id: null,
      ticket_id_input: '',
      generic_category: '',
    });
    setLookedUpTicket(null);
    setTicketSuggestions([]);
    setShowTicketSuggestions(false);
    setFormErrors({});
    setAddTaskModalTab('details');
    setAddTaskOpen(true);
    // Clear stale ticket_id/employee_id from URL so they don't affect future opens
    if (urlTicketId || urlEmployeeId) {
      const next = new URLSearchParams(searchParams);
      next.delete('ticket_id');
      next.delete('employee_id');
      setSearchParams(next, { replace: true });
    }
  };

  const fetchTicketDetails = useCallback(async (ticketId) => {
    setTicketLookupLoading(true);
    setFormErrors((e) => ({ ...e, ticket_id: null }));
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/ticket/${ticketId}`);
      const data = res.ok ? await res.json() : null;
      setLookedUpTicket(data);
      setForm((f) => ({ ...f, ticket_id: data ? ticketId : null }));
      if (!data) setFormErrors((e) => ({ ...e, ticket_id: 'Ticket not found or not in applicable statuses' }));
    } catch (_) {
      setLookedUpTicket(null);
      setFormErrors((e) => ({ ...e, ticket_id: 'Failed to fetch ticket details' }));
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

  // Debounced ticket search for suggestions (while typing)
  useEffect(() => {
    const q = (form.ticket_id_input || '').trim();
    if (!q || form.task_category !== 'Ticket') {
      setTicketSuggestions([]);
      setShowTicketSuggestions(false);
      return;
    }
    // Don't fetch/show suggestions when user has already selected a ticket
    if (form.ticket_id) {
      setShowTicketSuggestions(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/dev-planning/tickets?search=${encodeURIComponent(q)}`);
        const data = res.ok ? await res.json() : { tickets: [] };
        const list = (data.tickets || []).slice(0, 8);
        setTicketSuggestions(list);
        setShowTicketSuggestions(list.length > 0);
      } catch (_) {
        setTicketSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [form.ticket_id_input, form.task_category, form.ticket_id]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClick = (e) => {
      if (ticketInputRef.current?.contains(e.target) || ticketSuggestionsRef.current?.contains(e.target)) return;
      setShowTicketSuggestions(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [addTaskOpen]);

  // Fetch available hours on start date when it changes
  useEffect(() => {
    if (!addTaskOpen || !addTaskEmployee || !form.start_date) {
      setStartDateAvailable(8);
      return;
    }
    const params = new URLSearchParams({
      employee_name: form.employee_name || addTaskEmployee.employee_name,
      date: form.start_date,
    });
    let cancelled = false;
    apiFetch(`${API_BASE}/dev-planning/available-hours?${params}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        setStartDateAvailable(data.available_hours ?? 8);
      })
      .catch(() => {
        if (!cancelled) setStartDateAvailable(8);
      });
    return () => { cancelled = true; };
  }, [addTaskOpen, addTaskEmployee, form.start_date, form.employee_name]);

  // Fetch allocation preview when start_date, total_hours, max_hours_per_day, or employee change
  useEffect(() => {
    if (!addTaskOpen || !addTaskEmployee || !form.start_date || form.total_hours == null || form.total_hours === '' || !weekStart) {
      setAllocationPreview(null);
      return;
    }
    const hours = Number(form.total_hours);
    if (isNaN(hours) || hours < 0.5 || hours > 40) {
      setAllocationPreview(null);
      return;
    }
    const maxPerDay = form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8;
    const params = new URLSearchParams({
      employee_name: form.employee_name || addTaskEmployee.employee_name,
      start_date: form.start_date,
      total_hours: String(hours),
      max_hours_per_day: String(maxPerDay),
      week_start: weekStart,
    });
    // Add ticket_id or generic_category for duplicate checking
    if (form.task_category === 'Ticket' && form.ticket_id) {
      params.append('ticket_id', String(form.ticket_id));
    } else if (form.task_category && form.task_category !== 'Ticket') {
      params.append('generic_category', form.task_category);
    }
    let cancelled = false;
    apiFetch(`${API_BASE}/dev-planning/allocation-preview?${params}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) {
          setAllocationPreview({ distribution: data.distribution || [], total: data.total });
          if (data.max_available_on_start_date != null) {
            setStartDateAvailable(data.max_available_on_start_date);
          }
        } else {
          setAllocationPreview({ error: data.detail || 'Cannot fit hours' });
        }
      })
      .catch(() => {
        if (!cancelled) setAllocationPreview(null);
      });
    return () => { cancelled = true; };
  }, [addTaskOpen, addTaskEmployee, form.start_date, form.total_hours, form.max_hours_per_day, form.employee_name, form.task_category, form.ticket_id, weekStart]);

  const getInitialFormState = (emp, monday) => ({
    employee_name: emp?.employee_name || '',
    employee_id: emp?.employee_id || '',
    task_category: 'Ticket',
    ticket_id: null,
    ticket_id_input: '',
    activity_description: '',
    start_date: monday || formatAPIDate(getWeekMonday(new Date())),
    end_date: '',
    total_hours: 8,
    max_hours_per_day: 8,
    generic_category: '',
    justification: '',
  });

  const closeAddTask = () => {
    setAddTaskOpen(false);
    setAddTaskEmployee(null);
    setForm(getInitialFormState(null, ''));
    setLookedUpTicket(null);
    setTicketSuggestions([]);
    setShowTicketSuggestions(false);
    setFormErrors({});
    setAllocationPreview(null);
    setStartDateAvailable(8);
  };

  const validateForm = () => {
    const err = {};
    if (!form.task_category) err.task_category = 'Task category is required';
    if (!form.activity_description?.trim()) err.activity_description = 'Task description is required';
    if (!form.start_date) err.start_date = 'Start date is required';
    if (form.task_category === 'Ticket') {
      if (!form.ticket_id) err.ticket_id = 'Select a ticket from suggestions';
    } else {
      // Justification is optional
    }
    const totalHoursNum = form.total_hours != null && form.total_hours !== '' ? Number(form.total_hours) : NaN;
    if (form.total_hours == null || form.total_hours === '' || isNaN(totalHoursNum)) err.total_hours = 'Duration is required';
    else if (totalHoursNum < 1 || totalHoursNum > 40) err.total_hours = 'Duration must be 1–40 hours';
    if (form.task_category === 'Ticket' && lookedUpTicket?.remaining_dev_hours != null && lookedUpTicket.remaining_dev_hours >= 0 && !isNaN(totalHoursNum)) {
      if (totalHoursNum > lookedUpTicket.remaining_dev_hours) {
        err.total_hours = `Cannot allocate ${totalHoursNum}h; only ${lookedUpTicket.remaining_dev_hours}h remaining (estimate ${lookedUpTicket.dev_estimate_hours}h − utilised ${lookedUpTicket.actual_dev_hours}h)`;
      }
    }
    const maxH = form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8;
    if (isNaN(maxH) || maxH < 0.5 || maxH > 8 || !MAX_HOURS_PER_DAY_OPTIONS.includes(maxH)) err.max_hours_per_day = 'Select max hours per day (0.5–8h)';
    const today = formatAPIDate(new Date());
    if (form.start_date && form.start_date < today) err.start_date = 'Start date cannot be in the past';
    if (allocationPreview?.error) err.submit = allocationPreview.error;
    setFormErrors(err);
    return Object.keys(err).length === 0;
  };

  const submitAddTask = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        employee_name: form.employee_name,
        employee_id: form.employee_id || undefined,
        task_category: form.task_category,
        ticket_id: form.task_category === 'Ticket' ? form.ticket_id : undefined,
        activity_description: form.activity_description.trim(),
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        total_hours: form.total_hours != null ? Number(form.total_hours) : undefined,
        max_hours_per_day: form.max_hours_per_day != null ? Number(form.max_hours_per_day) : 8,
        generic_category: form.task_category !== 'Ticket' ? form.task_category : undefined,
        justification: form.justification?.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/dev-planning/tasks?week_start=${weekStart}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
      }
      if (!res.ok) {
        const detail = data.detail;
        const msg = typeof detail === 'string' ? detail
          : Array.isArray(detail) ? (detail.map((d) => {
              const field = Array.isArray(d.loc) && d.loc.length >= 2 ? d.loc[d.loc.length - 1] : null;
              const m = d.msg || (d.ctx?.limit ? 'Value exceeds limit' : null);
              return field && m ? `${field}: ${m}` : (m || JSON.stringify(d));
            }).join('; ') || 'Failed to add task')
          : (detail && typeof detail === 'object' ? (detail.message || JSON.stringify(detail)) : 'Failed to add task');
        throw new Error(msg);
      }
      closeAddTask();
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    } catch (e) {
      const msg = e?.message && typeof e.message === 'string' ? e.message : String(e);
      setFormErrors({ submit: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm('Remove this planned task? Remaining hours will recalculate.')) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const copyPreviousWeek = async () => {
    const prevMon = new Date(weekStart);
    prevMon.setDate(prevMon.getDate() - 7);
    const prevStr = formatAPIDate(prevMon);
    setActionLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/dev-planning/week/${weekStart}/copy-from/${prevStr}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Copy failed');
      await loadWeekData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Multi-user plan modal functions
  const openMultiPlanModal = async (ticket) => {
    setMultiPlanTicket(ticket);
    setMultiPlanSelectedEmployees([]);
    setMultiPlanForm({
      activity_description: ticket.title || '',
      start_date: weekStart,
      total_hours: ticket.dev_estimate_hours || 8,
      max_hours_per_day: 8,
    });
    setMultiPlanErrors({});
    setMultiPlanResults(null);
    setMultiPlanOpen(true);
  };

  const closeMultiPlanModal = () => {
    setMultiPlanOpen(false);
    setMultiPlanTicket(null);
    setMultiPlanSelectedEmployees([]);
    setMultiPlanResults(null);
  };

  const toggleMultiPlanEmployee = (empId) => {
    setMultiPlanSelectedEmployees((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const validateMultiPlanForm = () => {
    const err = {};
    if (multiPlanSelectedEmployees.length === 0) err.employees = 'Select at least one employee';
    if (!multiPlanForm.activity_description?.trim()) err.activity_description = 'Task description is required';
    if (!multiPlanForm.start_date) err.start_date = 'Start date is required';
    const totalHours = Number(multiPlanForm.total_hours);
    if (isNaN(totalHours) || totalHours < 0.5 || totalHours > 40) err.total_hours = 'Duration must be 0.5–40 hours';
    const maxH = Number(multiPlanForm.max_hours_per_day);
    if (isNaN(maxH) || maxH < 0.5 || maxH > 8) err.max_hours_per_day = 'Max hours must be 0.5–8';
    const today = formatAPIDate(new Date());
    if (multiPlanForm.start_date && multiPlanForm.start_date < today) err.start_date = 'Start date cannot be in the past';
    setMultiPlanErrors(err);
    return Object.keys(err).length === 0;
  };

  const submitMultiPlan = async (e) => {
    e.preventDefault();
    if (!validateMultiPlanForm()) return;
    setMultiPlanSubmitting(true);
    setMultiPlanErrors({});

    const results = { success: [], failed: [] };
    const selectedEmps = employees.filter((emp) => multiPlanSelectedEmployees.includes(emp.employee_id));

    for (const emp of selectedEmps) {
      try {
        const body = {
          employee_name: emp.employee_name,
          employee_id: emp.employee_id,
          task_category: 'Ticket',
          ticket_id: multiPlanTicket.ticket_id,
          activity_description: multiPlanForm.activity_description.trim(),
          start_date: multiPlanForm.start_date,
          total_hours: Number(multiPlanForm.total_hours),
          max_hours_per_day: Number(multiPlanForm.max_hours_per_day),
        };
        const res = await apiFetch(`${API_BASE}/dev-planning/tasks?week_start=${weekStart}`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          results.success.push({ employee: emp.employee_name, task: data.task });
        } else {
          results.failed.push({ employee: emp.employee_name, error: data.detail || 'Failed' });
        }
      } catch (err) {
        results.failed.push({ employee: emp.employee_name, error: err.message || 'Error' });
      }
    }

    setMultiPlanResults(results);
    setMultiPlanSubmitting(false);

    if (results.success.length > 0) {
      loadWeekData();
      if (view === 'calendar') loadCalendarData();
    }
  };

  // Edit task modal functions
  const openEditTask = (task) => {
    // Task should have allocations array from weekData
    setEditingTask(task);
    setEditAllocations((task.allocations || []).map((a) => ({ ...a, originalHours: a.hours })));
    setEditTaskError(null);
    setEditTaskOpen(true);
  };

  const closeEditTask = () => {
    setEditTaskOpen(false);
    setEditingTask(null);
    setEditAllocations([]);
    setEditTaskError(null);
  };

  const updateAllocationHours = (idx, newHours) => {
    const h = parseFloat(newHours);
    if (isNaN(h) || h < 0) return;
    setEditAllocations((prev) => prev.map((a, i) => (i === idx ? { ...a, hours: Math.min(8, h) } : a)));
  };

  const removeAllocationDay = (idx) => {
    setEditAllocations((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitEditTask = async () => {
    if (!editingTask) return;
    setEditTaskSubmitting(true);
    setEditTaskError(null);

    // Calculate removed hours
    const originalTotal = (editingTask.allocations || []).reduce((s, a) => s + a.hours, 0);
    const newTotal = editAllocations.reduce((s, a) => s + a.hours, 0);
    const removedHours = originalTotal - newTotal;

    try {
      // Send updated allocations to backend
      const res = await apiFetch(`${API_BASE}/dev-planning/tasks/${editingTask.id}/allocations`, {
        method: 'PUT',
        body: JSON.stringify({
          allocations: editAllocations.map((a) => ({ date: a.date, hours: a.hours })),
          spillover_hours: removedHours > 0 ? removedHours : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update allocations');
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
      const res = await apiFetch(`${API_BASE}/dev-planning/day-details?employee_name=${encodeURIComponent(employeeName)}&date_str=${encodeURIComponent(dateStr)}`);
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

  const weekState = weekData?.state || 'draft';
  const canEdit = weekState === 'draft' || weekState === 'submitted';
  const employees = weekData?.employees || [];
  const tasks = weekData?.tasks || [];

  // Filter employees by allocation status and search
  // Leads see all department (view); can_manage_tasks controls assign/edit only (not visibility)
  const filteredEmployees = employees.filter((emp) => {
    // Exclude self from planner list (leads assign to team, not themselves)
    if (emp.employee_id === user?.employee_id) {
      return false;
    }
    const status = (emp.allocation_status || '').toLowerCase().replace(/\s+/g, '-');
    if (resourceFilter !== 'all') {
      if (resourceFilter === 'available' && status !== 'available') return false;
      if (resourceFilter === 'partial' && status !== 'partially-allocated') return false;
      if (resourceFilter === 'full' && status !== 'fully-allocated') return false;
    }
    const search = (plannerEmployeeSearch || '').trim().toLowerCase();
    if (search && !(emp.employee_name || '').toLowerCase().includes(search)) return false;
    return true;
  });

  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(filteredEmployees, {
    defaultSortKey: 'employee_name',
    defaultSortDirection: 'asc',
  });

  // Summary stats for planner
  const totalCapacity = employees.length * HOURS_PER_WEEK;
  const totalAllocated = employees.reduce((sum, e) => sum + (e.allocated_hours || 0), 0);
  const utilizationPct = totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0;

  // Tasks grouped by employee for developer cards
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

  // Calendar rows: sorted with lead's team first, then others
  const calendarRows = useMemo(() => {
    const rows = calendarData?.employees || [];
    if (!isLeadOnly) return rows; // Admin/Manager sees normal order
    // Sort: can_manage_tasks = true first, then alphabetically within each group
    return [...rows].sort((a, b) => {
      const aManage = a.can_manage_tasks === true ? 0 : 1;
      const bManage = b.can_manage_tasks === true ? 0 : 1;
      if (aManage !== bManage) return aManage - bManage;
      return (a.employee_name || '').localeCompare(b.employee_name || '');
    });
  }, [calendarData?.employees, isLeadOnly]);

  // Navigate to tickets dashboard with ticket selected
  const goToTicket = (ticketId) => {
    navigate(`/tickets?ticket=${ticketId}`);
  };

  // Select a category to show ticket list
  const selectCategory = (type, key, label, tickets) => {
    setSelectedCategory({ type, key, label, tickets });
  };

  // Chart data from overview
  const getDevStatusChartData = () => {
    if (!overviewData?.dev_tickets) return null;
    const d = overviewData.dev_tickets;
    const labels = ['To Be Assigned', 'Already Assigned', 'In Progress', 'Ready for QC', 'QC Review Failed'];
    const data = [
      d.to_be_assigned?.count || 0,
      d.already_assigned?.count || 0,
      d.in_progress?.count || 0,
      d.ready_for_qc?.count || 0,
      d.qc_review_failed?.count || 0,
    ];
    if (data.every((v) => v === 0)) return null;
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(34, 197, 94, 0.8)',
          'rgba(220, 38, 38, 0.8)',
        ],
        borderColor: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#dc2626'],
        borderWidth: 2,
      }],
    };
  };

  const getQaStatusChartData = () => {
    if (!overviewData?.qa_tickets) return null;
    const q = overviewData.qa_tickets;
    const labels = ['Pending', 'In Progress', 'BIS Testing', 'On Hold'];
    const data = [
      q.pending?.count || 0,
      q.in_progress?.count || 0,
      q.bis_testing?.count || 0,
      q.on_hold?.count || 0,
    ];
    if (data.every((v) => v === 0)) return null;
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          'rgba(167, 139, 250, 0.8)',
          'rgba(139, 92, 246, 0.8)',
          'rgba(20, 184, 166, 0.8)',
          'rgba(100, 116, 139, 0.8)',
        ],
        borderColor: ['#a78bfa', '#8b5cf6', '#14b8a6', '#64748b'],
        borderWidth: 2,
      }],
    };
  };

  const getAssigneeChartData = () => {
    if (!overviewData?.by_assignee) return null;
    const byAssignee = overviewData.by_assignee;
    const entries = Object.entries(byAssignee)
      .map(([name, d]) => ({ name, count: d.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    if (entries.length === 0) return null;
    const colors = [
      'rgba(59, 130, 246, 0.8)', 'rgba(139, 92, 246, 0.8)', 'rgba(34, 197, 94, 0.8)',
      'rgba(245, 158, 11, 0.8)', 'rgba(236, 72, 153, 0.8)', 'rgba(20, 184, 166, 0.8)',
      'rgba(249, 115, 22, 0.8)', 'rgba(99, 102, 241, 0.8)', 'rgba(239, 68, 68, 0.8)',
      'rgba(107, 114, 128, 0.8)', 'rgba(168, 85, 247, 0.8)', 'rgba(14, 165, 233, 0.8)',
    ];
    return {
      labels: entries.map((e) => e.name),
      datasets: [{
        label: 'Tickets',
        data: entries.map((e) => e.count),
        backgroundColor: colors.slice(0, entries.length),
        borderColor: colors.slice(0, entries.length).map((c) => c.replace('0.8', '1')),
        borderWidth: 1,
        borderRadius: 4,
      }],
    };
  };

  const getPriorityChartData = () => {
    if (!overviewData?.dev_tickets?.by_priority) return null;
    const byPriority = overviewData.dev_tickets.by_priority;
    const order = ['URGENT', 'High (Bugs)', 'High', 'Medium', 'Low', 'Unspecified'];
    const labels = order.filter((p) => (byPriority[p]?.count || 0) > 0);
    const data = labels.map((p) => byPriority[p]?.count || 0);
    if (data.every((v) => v === 0)) return null;
    const hexToRgba = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.8)`;
    };
    return {
      labels,
      datasets: [{
        label: 'Tickets',
        data,
        backgroundColor: labels.map((p) => hexToRgba(PRIORITY_COLORS[p] || '#6b7280')),
        borderColor: labels.map((p) => PRIORITY_COLORS[p] || '#6b7280'),
        borderWidth: 1,
        borderRadius: 4,
      }],
    };
  };

  // Ticket Lists: bar + line combo (Dev status distribution)
  const getTicketListsChartData = () => {
    if (!overviewData?.dev_tickets) return null;
    const d = overviewData.dev_tickets;
    const labels = ['To Be Assigned', 'Assigned', 'In Progress', 'Ready for QC', 'QC Failed'];
    const barData = [
      d.to_be_assigned?.count || 0,
      d.already_assigned?.count || 0,
      d.in_progress?.count || 0,
      d.ready_for_qc?.count || 0,
      d.qc_review_failed?.count || 0,
    ];
    let cum = 0;
    const lineData = barData.map((v) => { cum += v; return cum; });
    if (barData.every((v) => v === 0)) return null;
    return {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Tickets',
          data: barData,
          backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(245, 158, 11, 0.8)', 'rgba(59, 130, 246, 0.8)', 'rgba(34, 197, 94, 0.8)', 'rgba(220, 38, 38, 0.8)'],
          borderColor: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#dc2626'],
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          type: 'line',
          label: 'Cumulative',
          data: lineData,
          borderColor: '#14b8a6',
          backgroundColor: 'rgba(20, 184, 166, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#14b8a6',
        },
      ],
    };
  };

  // All dev/qa tickets combined for "Total" cards
  const allDevTickets = overviewData ? [
    ...(overviewData.dev_tickets?.to_be_assigned?.tickets || []),
    ...(overviewData.dev_tickets?.already_assigned?.tickets || []),
    ...(overviewData.dev_tickets?.in_progress?.tickets || []),
    ...(overviewData.dev_tickets?.ready_for_qc?.tickets || []),
    ...(overviewData.dev_tickets?.qc_review_failed?.tickets || []),
  ] : [];
  const allQaTickets = overviewData ? [
    ...(overviewData.qa_tickets?.pending?.tickets || []),
    ...(overviewData.qa_tickets?.in_progress?.tickets || []),
    ...(overviewData.qa_tickets?.bis_testing?.tickets || []),
    ...(overviewData.qa_tickets?.on_hold?.tickets || []),
  ] : [];

  // Utilization gauge for dev tickets in progress
  const getUtilizationGaugeValue = () => {
    if (!overviewData?.dev_tickets) return 0;
    const total = overviewData.dev_tickets.total || 0;
    const inProgress = overviewData.dev_tickets.in_progress?.count || 0;
    return total > 0 ? Math.round((inProgress / total) * 100) : 0;
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: '#e2e8f0',
          padding: 8,
          usePointStyle: true,
          font: { size: 11 },
        },
      },
      datalabels: {
        display: true,
        color: '#fff',
        font: { size: 11, weight: '600' },
        formatter: (val) => (val > 0 ? val : ''),
      },
    },
  };

  const barChartOptions = {
    ...chartOptions,
    indexAxis: 'y',
    plugins: {
      ...chartOptions.plugins,
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.1)' },
        ticks: { color: '#94a3b8', font: { size: 10 } },
      },
      y: {
        grid: { display: false },
        ticks: { color: '#94a3b8', font: { size: 10 } },
      },
    },
  };

  // Render ticket list for selected category
  const renderTicketList = () => {
    if (!selectedCategory) return null;
    const { label, tickets } = selectedCategory;
    return (
      <div ref={ticketListRef} className="dev-overview-ticket-list-panel">
        <div className="ticket-list-header">
          <h3>{label} ({tickets.length})</h3>
          <button type="button" className="btn-close" onClick={() => setSelectedCategory(null)}>×</button>
        </div>
        <div className="ticket-list-scroll">
          {tickets.length === 0 ? (
            <p className="muted">No tickets in this category.</p>
          ) : (
            <table className="dev-overview-ticket-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Age</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.ticket_id}>
                    <td className="ticket-id-cell">
                      {getTicketTrackingUrl(t.ticket_id) ? (
                        <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" className="ticket-link">#{t.ticket_id}</a>
                      ) : (
                        <span className="ticket-id-plain">#{t.ticket_id}</span>
                      )}
                      <TicketExternalLink ticketId={t.ticket_id} />
                      <button type="button" className="ticket-link-internal" onClick={() => openMultiPlanModal(t)} title="Plan for multiple users">Plan</button>
                    </td>
                    <td className="ticket-title-cell" title={t.title}>{t.title?.slice(0, 50)}{(t.title?.length || 0) > 50 ? '…' : ''}</td>
                    <td>
                      <span className="priority-badge" style={{ backgroundColor: PRIORITY_COLORS[t.priority] || '#6b7280' }}>
                        {t.priority}
                      </span>
                    </td>
                    <td>{t.status}</td>
                    <td>
                      {t.assignee_employee_id ? (
                        <Link to={`/employees/${t.assignee_employee_id}`} className="assignee-link">{t.assignee}</Link>
                      ) : (
                        t.assignee
                      )}
                    </td>
                    <td>{t.age_days != null ? `${t.age_days}d` : '-'}</td>
                    <td>{t.eta || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`dev-planning-page ${!showParentTitle ? 'dev-planning-embedded' : ''}`}>
      {showParentTitle && (
        <header className="dev-planning-header">
          <div className="dev-planning-header-left">
            <Link to="/" className="dev-planning-back">← Dashboard</Link>
            <h1>Development Task Planning</h1>
          </div>
        </header>
      )}

      {isLeadOrManager && (
        <div className="dev-planning-tabs" role="tablist" aria-label="Dev view">
          <button type="button" className={view === 'overview' ? 'active' : ''} onClick={() => { setView('overview'); setSelectedCategory(null); }}>Overview</button>
          <button type="button" className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}>Weekly Planner</button>
          <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendar</button>
          <button type="button" className={view === 'resource-blocked' ? 'active' : ''} onClick={() => setView('resource-blocked')}>Resource Blocked Until</button>
        </div>
      )}

      {/* Calendar view has its own controls inside the view */}

      {error && <div className="dev-planning-error">{error}</div>}

      {/* MY PLANNED TASKS VIEW (Employees only) */}
      {view === 'my-tasks' && isEmployeeRole && (
        <div className="dev-my-tasks-container">
          <div className="dev-my-tasks-header">
            <div className="dev-my-tasks-title-row">
              <span className="dev-my-tasks-icon">📋</span>
              <div>
                <h2 className="dev-my-tasks-title">My Planned Tasks</h2>
                <p className="dev-my-tasks-subtitle">Your development tasks for the week</p>
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
            <div className="dev-planning-skeleton">Loading your tasks…</div>
          ) : !weekData ? (
            <div className="dev-planning-empty">
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
                  <div className="dev-planning-empty">
                    <p>No tasks planned for you this week.</p>
                    <p className="dev-planning-empty-hint">Your lead will assign tasks in the Weekly Planner.</p>
                  </div>
                ) : (
                  <div className="dev-my-tasks-list">
                    {myTasks.map((t) => (
                      <div key={t.id} className="dev-my-tasks-card">
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
                          <span className="dev-my-tasks-card-hours">{t.total_planned_hours}h</span>
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

      {/* OVERVIEW VIEW */}
      {view === 'overview' && (
        <div className="dev-overview-container">
          {overviewLoading ? (
            <div className="dev-planning-skeleton">Loading overview...</div>
          ) : !overviewData ? (
            <div className="dev-planning-empty">
              <p>Failed to load overview data.</p>
              <button type="button" className="btn-secondary" onClick={loadOverviewData}>Retry</button>
            </div>
          ) : (
            <div className="dev-overview-dashboard">
              {/* Dev Status Cards - separate section */}
              <section className="dev-summary-cards-section dev-status-section">
                <h2 className="dev-status-section-title">
                  <span className="dev-status-section-icon">👨‍💻</span>
                  Dev Status Cards
                  <span className="dev-status-section-badge">{overviewData.dev_tickets?.total || 0} active</span>
                </h2>
                <div className="dev-summary-cards-grid">
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('dev', 'dev-total', 'All Dev Tickets', allDevTickets)}>
                    <span className="dev-summary-card-title">Total Dev</span>
                    <span className="dev-summary-card-subtitle">Active Tickets</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.total || 0}</span>
                    <span className="dev-summary-card-context">Dev pipeline</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card dev-summary-card-accent" onClick={() => selectCategory('dev', 'dev-to-be-assigned', 'To Be Assigned', overviewData.dev_tickets?.to_be_assigned?.tickets || [])}>
                    <span className="dev-summary-card-title">To Be Assigned</span>
                    <span className="dev-summary-card-subtitle">No developer</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.to_be_assigned?.count || 0}</span>
                    <span className="dev-summary-card-context">Needs allocation</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('dev', 'dev-already-assigned', 'Already Assigned', overviewData.dev_tickets?.already_assigned?.tickets || [])}>
                    <span className="dev-summary-card-title">Already Assigned</span>
                    <span className="dev-summary-card-subtitle">Assigned, not started</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.already_assigned?.count || 0}</span>
                    <span className="dev-summary-card-context">Pending start</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('dev', 'dev-in-progress', 'In Progress', overviewData.dev_tickets?.in_progress?.tickets || [])}>
                    <span className="dev-summary-card-title">In Progress</span>
                    <span className="dev-summary-card-subtitle">Being worked on</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.in_progress?.count || 0}</span>
                    <span className="dev-summary-card-context">Active dev</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('dev', 'dev-ready-for-qc', 'Ready for QC', overviewData.dev_tickets?.ready_for_qc?.tickets || [])}>
                    <span className="dev-summary-card-title">Ready for QC</span>
                    <span className="dev-summary-card-subtitle">Code review passed</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.ready_for_qc?.count || 0}</span>
                    <span className="dev-summary-card-context">Awaiting QA</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('dev', 'dev-qc-review-failed', 'QC Review Failed', overviewData.dev_tickets?.qc_review_failed?.tickets || [])}>
                    <span className="dev-summary-card-title">QC Failed</span>
                    <span className="dev-summary-card-subtitle">Returned from QA</span>
                    <span className="dev-summary-card-value">{overviewData.dev_tickets?.qc_review_failed?.count || 0}</span>
                    <span className="dev-summary-card-context">Needs rework</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card dev-summary-card-pct" onClick={() => selectCategory('dev', 'dev-in-progress', 'In Progress', overviewData.dev_tickets?.in_progress?.tickets || [])}>
                    <span className="dev-summary-card-title">In Progress %</span>
                    <span className="dev-summary-card-subtitle">Utilization</span>
                    <span className="dev-summary-card-value">{getUtilizationGaugeValue()}%</span>
                    <span className="dev-summary-card-context">Of total dev</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                </div>
              </section>

              {/* QA Status Cards - separate section */}
              <section className="dev-summary-cards-section qa-status-section">
                <h2 className="dev-status-section-title">
                  <span className="dev-status-section-icon">🧪</span>
                  QA Status Cards
                  <span className="dev-status-section-badge">{overviewData.qa_tickets?.total || 0} active</span>
                </h2>
                <div className="dev-summary-cards-grid">
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('qa', 'qa-total', 'All QA Tickets', allQaTickets)}>
                    <span className="dev-summary-card-title">Total QA</span>
                    <span className="dev-summary-card-subtitle">Active Tickets</span>
                    <span className="dev-summary-card-value">{overviewData.qa_tickets?.total || 0}</span>
                    <span className="dev-summary-card-context">QA pipeline</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('qa', 'qa-pending', 'Pending with QA', overviewData.qa_tickets?.pending?.tickets || [])}>
                    <span className="dev-summary-card-title">Pending</span>
                    <span className="dev-summary-card-subtitle">QC not started</span>
                    <span className="dev-summary-card-value">{overviewData.qa_tickets?.pending?.count || 0}</span>
                    <span className="dev-summary-card-context">Awaiting QC</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('qa', 'qa-in-progress', 'In Progress with QA', overviewData.qa_tickets?.in_progress?.tickets || [])}>
                    <span className="dev-summary-card-title">In Progress</span>
                    <span className="dev-summary-card-subtitle">Testing active</span>
                    <span className="dev-summary-card-value">{overviewData.qa_tickets?.in_progress?.count || 0}</span>
                    <span className="dev-summary-card-context">QC testing</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('qa', 'qa-bis-testing', 'BIS Testing', overviewData.qa_tickets?.bis_testing?.tickets || [])}>
                    <span className="dev-summary-card-title">BIS Testing</span>
                    <span className="dev-summary-card-subtitle">Client testing</span>
                    <span className="dev-summary-card-value">{overviewData.qa_tickets?.bis_testing?.count || 0}</span>
                    <span className="dev-summary-card-context">Moved to BIS</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                  <button type="button" className="dev-summary-card" onClick={() => selectCategory('qa', 'qa-on-hold', 'On Hold', overviewData.qa_tickets?.on_hold?.tickets || [])}>
                    <span className="dev-summary-card-title">On Hold</span>
                    <span className="dev-summary-card-subtitle">QC testing hold</span>
                    <span className="dev-summary-card-value">{overviewData.qa_tickets?.on_hold?.count || 0}</span>
                    <span className="dev-summary-card-context">Testing paused</span>
                    <span className="dev-summary-card-icon">↻</span>
                  </button>
                </div>
              </section>

              {/* Main content: Ticket Lists + Top Lists + Assignee list */}
              <div className="dev-overview-main-row">
                {/* Ticket Lists - bar+line chart with gauge */}
                <section className="dev-ticket-lists-section">
                  <h3 className="dev-section-heading">Ticket Lists</h3>
                  <div className="dev-ticket-lists-content">
                    <div className="dev-ticket-lists-chart-wrap">
                      {getTicketListsChartData() ? (
                        <Chart
                          type="bar"
                          data={getTicketListsChartData()}
                          options={{
                            ...chartOptions,
                            plugins: { ...chartOptions.plugins, legend: { display: true, position: 'top' } },
                            scales: {
                              x: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                              y: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                            },
                          }}
                        />
                      ) : (
                        <div className="dev-overview-chart-empty">No ticket data</div>
                      )}
                    </div>
                    <div className="dev-ticket-lists-gauge">
                      <div className="dev-gauge-ring" style={{ '--gauge-pct': getUtilizationGaugeValue() }}>
                        <span className="dev-gauge-value">{getUtilizationGaugeValue()}%</span>
                        <span className="dev-gauge-label">In Progress</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Top Lists - assignee bar chart */}
                <section className="dev-top-lists-section">
                  <h3 className="dev-section-heading">Top Lists</h3>
                  <div className="dev-top-lists-chart-wrap">
                    {getAssigneeChartData() ? (
                      <Bar
                        data={{
                          ...getAssigneeChartData(),
                          datasets: [{
                            ...getAssigneeChartData().datasets[0],
                            backgroundColor: 'rgba(20, 184, 166, 0.8)',
                            borderColor: '#14b8a6',
                            borderRadius: 6,
                          }],
                        }}
                        options={{
                          ...chartOptions,
                          indexAxis: 'y',
                          plugins: { ...chartOptions.plugins, legend: { display: false } },
                          scales: {
                            x: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                            y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                          },
                        }}
                      />
                    ) : (
                      <div className="dev-overview-chart-empty">No assignee data</div>
                    )}
                  </div>
                  <span className="dev-top-lists-by">by Assignee</span>
                </section>

                {/* Assignee list - vertical avatars */}
                <section className="dev-assignee-list-section">
                  <h3 className="dev-section-heading">Assignee Chart</h3>
                  <div className="dev-assignee-list">
                    {Object.entries(overviewData.by_assignee || {}).length === 0 ? (
                      <p className="dev-assignee-empty">No assignees</p>
                    ) : (
                      Object.entries(overviewData.by_assignee || {})
                        .map(([name, d]) => ({ name, count: d.count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 8)
                        .map((e) => (
                          <button
                            key={e.name}
                            type="button"
                            className="dev-assignee-list-item"
                            onClick={() => selectCategory('assignee', `assignee-${e.name}`, e.name, overviewData.by_assignee?.[e.name]?.tickets || [])}
                          >
                            <span className="dev-assignee-avatar">{e.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}</span>
                            <span className="dev-assignee-name">{e.name}</span>
                            <span className="dev-assignee-count">{e.count} tickets</span>
                          </button>
                        ))
                    )}
                  </div>
                </section>
              </div>

              {/* Ticket list panel when category selected */}
              {selectedCategory && renderTicketList()}

              {/* Category chips - Dev and QA segregated */}
              <section className="dev-overview-categories-compact">
                <div className="dev-category-group">
                  <h3 className="dev-category-group-title dev-title">Dev Status</h3>
                  <div className="dev-category-cards-row">
                    {[
                      { key: 'dev-to-be-assigned', label: 'To Be Assigned', count: overviewData.dev_tickets?.to_be_assigned?.count || 0, tickets: overviewData.dev_tickets?.to_be_assigned?.tickets || [], color: '#ef4444' },
                      { key: 'dev-already-assigned', label: 'Assigned', count: overviewData.dev_tickets?.already_assigned?.count || 0, tickets: overviewData.dev_tickets?.already_assigned?.tickets || [], color: '#f59e0b' },
                      { key: 'dev-in-progress', label: 'In Progress', count: overviewData.dev_tickets?.in_progress?.count || 0, tickets: overviewData.dev_tickets?.in_progress?.tickets || [], color: '#3b82f6' },
                      { key: 'dev-ready-for-qc', label: 'Ready for QC', count: overviewData.dev_tickets?.ready_for_qc?.count || 0, tickets: overviewData.dev_tickets?.ready_for_qc?.tickets || [], color: '#22c55e' },
                      { key: 'dev-qc-review-failed', label: 'QC Failed', count: overviewData.dev_tickets?.qc_review_failed?.count || 0, tickets: overviewData.dev_tickets?.qc_review_failed?.tickets || [], color: '#dc2626' },
                    ].filter((c) => c.count > 0).map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`dev-category-chip ${selectedCategory?.key === c.key ? 'selected' : ''}`}
                        style={{ borderLeftColor: c.color }}
                        onClick={() => selectCategory('dev', c.key, c.label, c.tickets)}
                      >
                        <span className="dev-category-chip-count">{c.count}</span>
                        <span className="dev-category-chip-label">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dev-category-group">
                  <h3 className="dev-category-group-title qa-title">QA Status</h3>
                  <div className="dev-category-cards-row">
                    {[
                      { key: 'qa-pending', label: 'Pending', count: overviewData.qa_tickets?.pending?.count || 0, tickets: overviewData.qa_tickets?.pending?.tickets || [], color: '#a78bfa' },
                      { key: 'qa-in-progress', label: 'In Progress', count: overviewData.qa_tickets?.in_progress?.count || 0, tickets: overviewData.qa_tickets?.in_progress?.tickets || [], color: '#8b5cf6' },
                      { key: 'qa-bis-testing', label: 'BIS Testing', count: overviewData.qa_tickets?.bis_testing?.count || 0, tickets: overviewData.qa_tickets?.bis_testing?.tickets || [], color: '#14b8a6' },
                      { key: 'qa-on-hold', label: 'On Hold', count: overviewData.qa_tickets?.on_hold?.count || 0, tickets: overviewData.qa_tickets?.on_hold?.tickets || [], color: '#64748b' },
                    ].filter((c) => c.count > 0).map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`dev-category-chip ${selectedCategory?.key === c.key ? 'selected' : ''}`}
                        style={{ borderLeftColor: c.color }}
                        onClick={() => selectCategory('qa', c.key, c.label, c.tickets)}
                      >
                        <span className="dev-category-chip-count">{c.count}</span>
                        <span className="dev-category-chip-label">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* PLANNER VIEW */}
      {view === 'planner' && (
        <div className="dev-planner-resource-ui">
          {/* Planner header */}
          <div className="dev-planner-header">
            <div className="dev-planner-header-left">
              <div className="dev-planner-title-row">
                <span className="dev-planner-icon">📋</span>
                <div>
                  <h1 className="dev-planner-title">Development Task Planning</h1>
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
              <span className="dev-planner-save-status">Last saved: 2 min ago</span>
              <div className="dev-planner-view-toggle">
                <button type="button" className={plannerViewMode === 'grid' ? 'active' : ''} onClick={() => setPlannerViewMode('grid')} title="Grid view">⊞</button>
                <button type="button" className={plannerViewMode === 'list' ? 'active' : ''} onClick={() => setPlannerViewMode('list')} title="List view">≡</button>
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="dev-planner-summary-bar">
            <span className="dev-planner-summary-item"><strong>Total Resources:</strong> {employees.length}</span>
            <span className="dev-planner-summary-item"><strong>Available Capacity:</strong> {totalCapacity}h</span>
            <span className={`dev-planner-summary-item allocated ${utilizationPct >= 90 ? 'high' : utilizationPct >= 50 ? 'partial' : ''}`}><strong>Allocated:</strong> {totalAllocated}h</span>
            <span className="dev-planner-summary-item"><strong>Utilization:</strong> {utilizationPct}%</span>
          </div>

          {/* Two-panel layout */}
          <div className="dev-planner-layout">
            <section className="dev-planner-left-panel">
              <div className="dev-planner-panel-header">
                <h2>PM Tracker Tickets</h2>
                <span className="dev-planner-badge">{tickets.length}</span>
              </div>
              <div className="dev-planner-filters">
                <div className="dev-planner-search-wrap">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search by ID, title, or assignee..."
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
                <select value={ticketAssigneeFilter} onChange={(e) => setTicketAssigneeFilter(e.target.value)} title="Filter by assignee">
                  <option value="">All Assignees</option>
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
                  <option value="true">With dev estimate</option>
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
                ) : tickets.length === 0 ? (
                  <div className="dev-planning-empty">
                    <p>No tickets found.</p>
                    <p className="dev-planning-empty-hint">Sync PM Tracker from the app or clear filters above.</p>
                  </div>
                ) : (
                  tickets.slice(0, 100).map((t) => (
                    <div key={t.ticket_id} className={`dev-planner-ticket-card ${urlTicketId && t.ticket_id === parseInt(urlTicketId, 10) ? 'highlight-from-link' : ''}`}>
                      <div className="dev-planner-ticket-top">
                        <span className="dev-planner-ticket-id">
                          {getTicketTrackingUrl(t.ticket_id) ? (
                            <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>#{t.ticket_id}</a>
                          ) : (
                            `#${t.ticket_id}`
                          )}
                          <TicketExternalLink ticketId={t.ticket_id} className="dev-planner-ticket-ext-link" />
                        </span>
                        <span className={`dev-planner-status-badge status-${(t.status || '').toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`}>{t.status || 'Open'}</span>
                      </div>
                      <p className="dev-planner-ticket-title" title={t.title}>{t.title?.slice(0, 60)}{(t.title?.length || 0) > 60 ? '…' : ''}</p>
                      <div className="dev-planner-ticket-hours">
                        <span>Dev: {t.dev_estimate_hours != null && t.dev_estimate_hours > 0 ? `${t.dev_estimate_hours}h` : '—'}</span>
                        <span>QA: {t.qa_estimate_hours != null && t.qa_estimate_hours > 0 ? `${t.qa_estimate_hours}h` : '—'}</span>
                      </div>
                      <button type="button" className="dev-planner-ticket-plan-btn" onClick={() => openMultiPlanModal(t)} title="Plan for multiple users">Plan</button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="dev-planner-right-panel">
              <div className="dev-planner-panel-header">
                <h2>Development Resources</h2>
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
              ) : sortedEmployees.length === 0 ? (
                <div className="dev-planning-empty">
                  <p>No resources match the filter.</p>
                </div>
              ) : (
                <div className={`dev-planner-resource-grid ${plannerViewMode === 'list' ? 'list-mode' : ''}`}>
                  {sortedEmployees.map((emp) => {
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
                            <span className="dev-planner-resource-role">{emp.role || 'Developer'}</span>
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
                                <div key={t.id} className="dev-planner-task-item">
                                  <span className="dev-planner-task-id">
                                    {t.ticket_id && getTicketTrackingUrl(t.ticket_id) ? (
                                      <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>#{t.ticket_id}</a>
                                    ) : t.ticket_id ? (
                                      `#${t.ticket_id}`
                                    ) : (
                                      t.generic_category
                                    )}
                                  </span>
                                  <span className="dev-planner-task-desc">{t.activity_description?.slice(0, 35)}{(t.activity_description?.length || 0) > 35 ? '…' : ''}</span>
                                  <span className="dev-planner-task-hours">{t.total_planned_hours}h</span>
                                  <span className="dev-planner-task-dates">{t.start_date && t.end_date ? `${formatDisplayDateWithDay(t.start_date)} → ${formatDisplayDateWithDay(t.end_date)}` : formatDisplayDate(t.start_date)}</span>
                                  {canEdit && (emp.can_manage_tasks !== false) && (
                                    <div className="dev-planner-task-actions">
                                      <button
                                        type="button"
                                        className="dev-planner-task-edit"
                                        onClick={() => openEditTask(t)}
                                        title={!t.spillover && t.start_date && t.start_date < formatAPIDate(new Date()) ? 'Past tasks cannot be edited' : 'Edit allocations'}
                                        disabled={!t.spillover && t.start_date && t.start_date < formatAPIDate(new Date())}
                                      >
                                        ✎
                                      </button>
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
              )}
            </section>
          </div>
        </div>
      )}

      {view === 'calendar' && (
        <div className="dev-planning-calendar-view">
          <div className="dev-planning-calendar-header">
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
                      const d = new Date(weekStart);
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
                      const d = new Date(weekStart);
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
            {calendarData && (
              <div className="calendar-summary-section">
                <div className="calendar-period-label">
                  {calendarView === 'weekly'
                    ? `Week of ${formatDisplayDateWithDay(calendarData.start || weekStart)} – ${formatDisplayDateWithDay(calendarData.end || weekStart)}`
                    : (() => {
                        const [y, m] = (calendarData.start || weekStart).split('-');
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
                      })()}
                </div>
                <div className="calendar-summary-stats">
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Employees</span>
                    <span className="calendar-stat-value">{calendarRows.length || 0}</span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Total Hours</span>
                    <span className="calendar-stat-value">
                      {calendarRows.reduce((sum, emp) =>
                        sum + Object.values(emp.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0
                      )}h
                    </span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Avg Hours/Day</span>
                    <span className="calendar-stat-value">
                      {(() => {
                        const allDays = calendarRows.flatMap(emp => Object.values(emp.days || {}));
                        const totalHours = allDays.reduce((s, d) => s + (d.hours || 0), 0);
                        const numDays = Object.keys(calendarRows[0]?.days || {}).length || 1;
                        const numEmps = calendarRows.length || 1;
                        return (totalHours / numEmps / numDays).toFixed(1);
                      })()}h
                    </span>
                  </div>
                  <div className="calendar-stat">
                    <span className="calendar-stat-label">Utilization</span>
                    <span className="calendar-stat-value">
                      {(() => {
                        const allDays = calendarRows.flatMap(emp => Object.values(emp.days || {}));
                        const totalHours = allDays.reduce((s, d) => s + (d.hours || 0), 0);
                        const numDays = Object.keys(calendarRows[0]?.days || {}).length || 1;
                        const capacity = (calendarRows.length || 1) * numDays * 8;
                        return Math.round((totalHours / capacity) * 100);
                      })()}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {calendarData && calendarRows.length > 0 && (
            <div className="calendar-legend">
              <span className="calendar-legend-item"><span className="calendar-legend-swatch full" /> Fully occupied (8h)</span>
              <span className="calendar-legend-item"><span className="calendar-legend-swatch partial" /> Partially occupied</span>
              <span className="calendar-legend-item"><span className="calendar-legend-swatch empty" /> Not occupied</span>
            </div>
          )}
          {view === 'calendar' && !calendarData && !error && (
            <div className="qa-planning-skeleton">Loading calendar...</div>
          )}
          {view === 'calendar' && error && (
            <div className="qa-planning-empty">
              <p>{error}</p>
              <button type="button" className="btn-secondary" onClick={() => { setError(null); loadCalendarData(); }}>Retry</button>
            </div>
          )}
          {calendarData && (
            <div className="dev-planning-calendar-grid-wrap">
              <table className="dev-planning-calendar-grid">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {Object.keys(calendarRows[0]?.days || {}).sort().map((d) => (
                      <th key={d}>{formatDisplayDate(d)}</th>
                    ))}
                    <th className="total-col">Total</th>
                    <th className="avg-col">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {calendarRows.map((row) => {
                    const days = Object.values(row.days || {});
                    const totalHours = days.reduce((s, d) => s + (d.hours || 0), 0);
                    const avgHours = days.length > 0 ? (totalHours / days.length).toFixed(1) : 0;
                    const rowPriorities = [];
                    days.forEach((cell) => {
                      (cell.items || []).forEach((it) => {
                        if (it.ticket_priority && !rowPriorities.includes(it.ticket_priority)) rowPriorities.push(it.ticket_priority);
                      });
                    });
                    return (
                      <tr key={row.employee_id}>
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
                          const items = cell.items || (cell.labels || []).map((t) => {
                            const isTicket = /^#(\d+)$/.test(t);
                            return {
                              text: t,
                              ticket_id: isTicket ? parseInt(t.slice(1), 10) : null,
                              category: isTicket ? 'Ticket' : (GENERIC_CATEGORIES.includes(t) ? t : 'Miscellaneous'),
                              over_estimate: false,
                            };
                          });
                          return (
                            <td
                              key={day}
                              className={`cell-hours clickable ${cell.total >= 8 ? 'full' : cell.hours > 0 ? 'partial' : 'empty'}`}
                              title={`${cell.hours}h allocated, ${cell.leave_hours}h leave. Click for details.`}
                              onClick={() => openDayDetail(row.employee_name, day)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayDetail(row.employee_name, day); } }}
                            >
                              <span className="hours">{cell.hours}h</span>
                              {items.length > 0 && (
                                <span className="labels">
                                  {items.map((it, i) => {
                                    const cat = it.category || 'Ticket';
                                    const color = it.over_estimate ? '#ef4444' : (TASK_CATEGORY_COLORS[cat] || TASK_CATEGORY_COLORS.Miscellaneous);
                                    const labelWithPriority = it.ticket_priority ? `${it.text} (${it.ticket_priority})` : it.text;
                                    return (
                                      <span key={i} className="cell-label-wrap">
                                        {i > 0 && ', '}
                                        {it.ticket_id && getTicketTrackingUrl(it.ticket_id) ? (
                                          <a
                                            href={getTicketTrackingUrl(it.ticket_id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="cell-task-link"
                                            style={{ color }}
                                            onClick={(e) => e.stopPropagation()}
                                            title={it.ticket_priority ? `Priority: ${it.ticket_priority}` : undefined}
                                          >
                                            {labelWithPriority}
                                          </a>
                                        ) : (
                                          <span className="cell-task-label" style={{ color }} title={it.ticket_priority ? `Priority: ${it.ticket_priority}` : undefined}>{labelWithPriority}</span>
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
          )}
        </div>
      )}

      {view === 'resource-blocked' && (
        <div className="resource-blocked-view">
          <div className="resource-blocked-header">
            <h2 className="resource-blocked-title">Resource Blocked Until – Dev Planning</h2>
            <p className="resource-blocked-subtitle">See when each developer is blocked based on current allocations. Helps plan new tasks.</p>
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
            <div className="dev-planning-skeleton">Loading…</div>
          ) : !weekData ? (
            <div className="dev-planning-empty">
              <p>No planning data. Create a week from the Weekly Planner first.</p>
              <button type="button" className="btn-secondary" onClick={() => { setView('planner'); loadWeekData(); }}>Go to Weekly Planner</button>
            </div>
          ) : (
            <div className="resource-blocked-table-wrap">
              <table className="resource-blocked-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Allocated (h)</th>
                    <th>Tasks (Priority)</th>
                    <th>Blocked Until</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(weekData.employees || []).map((emp) => {
                    const tasks = weekData?.tasks || [];
                    let maxDate = null;
                    const empTasks = [];
                    for (const t of tasks) {
                      if (t.employee_name !== emp.employee_name) continue;
                      for (const a of t.allocations || []) {
                        if (a.date && (!maxDate || a.date > maxDate)) maxDate = a.date;
                      }
                      const label = t.ticket_id ? `#${t.ticket_id}` : (t.generic_category || 'Task');
                      const pri = t.ticket_priority ? ` (${t.ticket_priority})` : '';
                      empTasks.push({ ticket_id: t.ticket_id, label, priority: t.ticket_priority, full: `${label}${pri}` });
                    }
                    const statusKey = (emp.allocation_status || '').toLowerCase().replace(/\s+/g, '-');
                    return (
                      <tr key={emp.employee_id}>
                        <td>
                          <Link to={`/employees/${emp.employee_id}`} className="resource-blocked-emp-link">{emp.employee_name}</Link>
                        </td>
                        <td>{emp.role || 'Dev'}</td>
                        <td>{emp.allocated_hours ?? 0}h</td>
                        <td className="resource-blocked-tasks-cell">
                          {empTasks.length === 0 ? (
                            <span className="resource-blocked-available">—</span>
                          ) : (
                            <span className="resource-blocked-task-list" title={empTasks.map((x) => x.full).join(', ')}>
                              {empTasks.map((task, idx) => (
                                <span key={idx} className="resource-blocked-task-item">
                                  {idx > 0 && ', '}
                                  {task.priority && (
                                    <span className="resource-blocked-priority-pill" style={{ backgroundColor: PRIORITY_COLORS[task.priority] || '#6b7280' }} title={`Priority: ${task.priority}`}>{task.priority}</span>
                                  )}
                                  {task.ticket_id && getTicketTrackingUrl(task.ticket_id) ? (
                                    <a href={getTicketTrackingUrl(task.ticket_id)} target="_blank" rel="noopener noreferrer" className="resource-blocked-task-link" onClick={(e) => e.stopPropagation()}>
                                      {task.label}
                                    </a>
                                  ) : (
                                    task.label
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

      {addTaskOpen && (
        <div className="dev-planning-modal-overlay" onClick={closeAddTask}>
          <div className="dev-planning-modal dev-planning-add-task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add task</h3>
              <button type="button" className="modal-close-btn" onClick={closeAddTask} title="Close">×</button>
            </div>
            {addTaskEmployee && <p className="modal-subtitle">Resource: {addTaskEmployee.employee_name}</p>}
            <div className="add-task-modal-tabs">
              <button type="button" className={addTaskModalTab === 'details' ? 'active' : ''} onClick={() => setAddTaskModalTab('details')}>Task Details</button>
              <button type="button" className={addTaskModalTab === 'resource-blocked' ? 'active' : ''} onClick={() => setAddTaskModalTab('resource-blocked')}>Resource Blocked Until</button>
            </div>
            {addTaskModalTab === 'resource-blocked' ? (
              <div className="add-task-resource-blocked-panel">
                {addTaskEmployee ? (() => {
                  const tasks = weekData?.tasks || [];
                  let maxDate = null;
                  for (const t of tasks) {
                    if (t.employee_name !== addTaskEmployee.employee_name) continue;
                    for (const a of t.allocations || []) {
                      if (a.date && (!maxDate || a.date > maxDate)) maxDate = a.date;
                    }
                  }
                  return maxDate ? (
                    <div className="add-task-resource-blocked-item">
                      <span className="add-task-resource-blocked-name">{addTaskEmployee.employee_name}</span>
                      <span className="add-task-resource-blocked-date">{formatDisplayDateWithDay(maxDate)}</span>
                    </div>
                  ) : (
                    <div className="add-task-resource-blocked-empty">No allocations yet – resource is available from start of week.</div>
                  );
                })() : (
                  <div className="add-task-resource-blocked-empty">Select a resource to view allocation.</div>
                )}
              </div>
            ) : (
            <form onSubmit={submitAddTask}>
              <div className="form-group">
                <label>Task Category *</label>
                <select
                  value={form.task_category || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const updates = {
                      task_category: v,
                      ticket_id: null,
                      ticket_id_input: v === 'Ticket' ? form.ticket_id_input : '',
                      generic_category: v !== 'Ticket' ? v : '',
                    };
                    // Set defaults for Leave category
                    if (v === 'Leave') {
                      updates.total_hours = 8;
                      updates.max_hours_per_day = 8;
                    }
                    setForm({ ...form, ...updates });
                    if (v !== 'Ticket') setLookedUpTicket(null);
                  }}
                >
                  {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {formErrors.task_category && <span className="form-error">{formErrors.task_category}</span>}
              </div>

              {form.task_category === 'Ticket' && (
                <>
                  <div className="form-group" ref={ticketInputRef}>
                    <label>Ticket *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.ticket_id_input}
                      onChange={(e) => {
                        setForm({ ...form, ticket_id_input: e.target.value, ticket_id: null });
                        setLookedUpTicket(null);
                      }}
                      onFocus={() => ticketSuggestions.length > 0 && setShowTicketSuggestions(true)}
                      placeholder="Type to search ticket ID or title..."
                      className="ticket-search-input"
                    />
                    {showTicketSuggestions && ticketSuggestions.length > 0 && !form.ticket_id && (
                      <div className="ticket-suggestions-dropdown" ref={ticketSuggestionsRef}>
                        {ticketSuggestions.map((t) => (
                          <button
                            key={t.ticket_id}
                            type="button"
                            className="ticket-suggestion-item"
                            onClick={() => selectTicket(t)}
                          >
                            <span className="ticket-sug-id">#{t.ticket_id}</span>
                            <span className="ticket-sug-title">{t.title?.slice(0, 45)}{(t.title?.length || 0) > 45 ? '…' : ''}</span>
                            <span className="ticket-sug-meta">{t.status} · {t.dev_estimate_hours ?? '—'}h</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {ticketLookupLoading && <span className="ticket-loading-hint">Loading…</span>}
                    {formErrors.ticket_id && <span className="form-error">{formErrors.ticket_id}</span>}
                  </div>
                  {lookedUpTicket && (
                    <div className="ticket-details-card">
                      <div className="ticket-card-header">
                        <div className="ticket-card-header-content">
                          <span className="ticket-card-id">#{lookedUpTicket.ticket_id}</span>
                          <span className="ticket-card-title">{lookedUpTicket.title || '—'}</span>
                        </div>
                        <button
                          type="button"
                          className="ticket-card-refresh"
                          onClick={() => form.ticket_id && fetchTicketDetails(form.ticket_id)}
                          disabled={ticketLookupLoading}
                          title="Refresh from PM Tracker (if you updated estimate there)"
                        >
                          {ticketLookupLoading ? '…' : '↻ Refresh'}
                        </button>
                      </div>
                      <div className="ticket-card-body">
                        <div className="ticket-card-field">
                          <span className="ticket-card-label">Status</span>
                          <span className={`ticket-card-value ${['QC Review Fail', 'Code Review Failed'].includes(lookedUpTicket.status) ? 'ticket-status-failed' : ''}`}>
                            {lookedUpTicket.status || '—'}
                          </span>
                        </div>
                        {['QC Review Fail', 'Code Review Failed'].includes(lookedUpTicket.status) && (
                          <div className="ticket-card-warning">
                            This ticket was returned from review. Consider addressing feedback before allocating more time.
                          </div>
                        )}
                        <div className="ticket-card-field">
                          <span className="ticket-card-label">Priority</span>
                          <span className="ticket-card-value">{lookedUpTicket.priority || '—'}</span>
                        </div>
                        <div className="ticket-card-field">
                          <span className="ticket-card-label">Assignee</span>
                          <span className="ticket-card-value">{lookedUpTicket.assignee || '—'}</span>
                        </div>
                        <div className="ticket-card-field ticket-card-time-row">
                          <span className="ticket-card-label">Estimated</span>
                          <span className="ticket-card-value">{lookedUpTicket.dev_estimate_hours != null ? `${lookedUpTicket.dev_estimate_hours}h` : '—'}</span>
                        </div>
                        <div className="ticket-card-field ticket-card-time-row">
                          <span className="ticket-card-label">Utilised</span>
                          <span className="ticket-card-value">{(lookedUpTicket.actual_dev_hours ?? 0)}h</span>
                        </div>
                        <div className="ticket-card-field ticket-card-time-row">
                          <span className="ticket-card-label">Remaining</span>
                          <span className={`ticket-card-value ${lookedUpTicket.remaining_dev_hours != null && lookedUpTicket.remaining_dev_hours < 0 ? 'ticket-card-over' : ''}`}>
                            {lookedUpTicket.remaining_dev_hours != null ? `${lookedUpTicket.remaining_dev_hours}h` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="form-group">
                <label>Task description *</label>
                <textarea
                  value={form.activity_description}
                  onChange={(e) => setForm({ ...form, activity_description: e.target.value })}
                  rows={3}
                  placeholder="What will be done?"
                />
                {formErrors.activity_description && <span className="form-error">{formErrors.activity_description}</span>}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Start date *</label>
                  <input
                    type="date"
                    value={form.start_date}
                    min={formatAPIDate(new Date())}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  />
                  {formErrors.start_date && <span className="form-error">{formErrors.start_date}</span>}
                </div>
                {form.task_category === 'Leave' ? (
                  <div className="form-group">
                    <label>Leave type *</label>
                    <div className="leave-type-options">
                      <label className={`leave-type-option ${form.total_hours === 4 ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="leave_type"
                          checked={form.total_hours === 4}
                          onChange={() => setForm({ ...form, total_hours: 4, max_hours_per_day: 4 })}
                        />
                        Half Day (4h)
                      </label>
                      <label className={`leave-type-option ${form.total_hours === 8 ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="leave_type"
                          checked={form.total_hours === 8}
                          onChange={() => setForm({ ...form, total_hours: 8, max_hours_per_day: 8 })}
                        />
                        Full Day (8h)
                      </label>
                    </div>
                    {formErrors.total_hours && <span className="form-error">{formErrors.total_hours}</span>}
                  </div>
                ) : (
                  <div className="form-group">
                    <label>Duration (hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      step={0.5}
                      value={form.total_hours ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') {
                          setForm({ ...form, total_hours: null });
                        } else {
                          const n = parseFloat(v);
                          setForm({ ...form, total_hours: !isNaN(n) ? n : form.total_hours });
                        }
                      }}
                      placeholder="1–40"
                    />
                    {form.task_category === 'Ticket' && lookedUpTicket?.remaining_dev_hours != null && lookedUpTicket.remaining_dev_hours >= 0 && (
                      <span className="duration-remaining-hint">Max {lookedUpTicket.remaining_dev_hours}h remaining for this ticket</span>
                    )}
                    {formErrors.total_hours && <span className="form-error">{formErrors.total_hours}</span>}
                  </div>
                )}
              </div>

              {form.task_category !== 'Leave' && (
                <div className="form-group">
                  <label>Max hours per day for this task</label>
                  <select
                    value={form.max_hours_per_day ?? 8}
                    onChange={(e) => setForm({ ...form, max_hours_per_day: parseFloat(e.target.value) })}
                  >
                    {MAX_HOURS_PER_DAY_OPTIONS.map((h) => (
                      <option key={h} value={h}>{h === 0.5 ? '30 min' : `${h}h`}{h > startDateAvailable ? ` (${startDateAvailable}h available on start date)` : ''}</option>
                    ))}
                  </select>
                  {startDateAvailable < 8 && (
                    <span className="duration-remaining-hint">
                      {startDateAvailable > 0
                        ? `Start date has ${startDateAvailable}h available (${8 - startDateAvailable}h already allocated). Task will use available hours each day.`
                        : 'Start date is fully allocated. Task will start from next available day.'}
                    </span>
                  )}
                </div>
              )}

              {allocationPreview?.error && <div className="form-error block">{allocationPreview.error}</div>}
              {formErrors.submit && !allocationPreview?.error && <div className="form-error block">{formErrors.submit}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={closeAddTask}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting || (allocationPreview?.error != null)} title={allocationPreview?.error || ''}>Add task</button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Multi-user plan modal */}
      {multiPlanOpen && multiPlanTicket && (
        <div className="dev-planning-modal-overlay" onClick={closeMultiPlanModal}>
          <div className="dev-planning-modal dev-planning-multi-plan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Plan Ticket for Multiple Users</h3>
              <button type="button" className="modal-close-btn" onClick={closeMultiPlanModal} title="Close">×</button>
            </div>
            <p className="modal-subtitle">
              <strong>#{multiPlanTicket.ticket_id}</strong> – {multiPlanTicket.title?.slice(0, 60)}{(multiPlanTicket.title?.length || 0) > 60 ? '…' : ''}
            </p>
            {multiPlanTicket.dev_estimate_hours != null && (
              <p className="modal-subtitle">Estimate: {multiPlanTicket.dev_estimate_hours}h</p>
            )}

            {multiPlanResults ? (
              <div className="multi-plan-results">
                {multiPlanResults.success.length > 0 && (
                  <div className="multi-plan-success">
                    <strong>✓ Created {multiPlanResults.success.length} task(s):</strong>
                    <ul>
                      {multiPlanResults.success.map((r, i) => (
                        <li key={i}>{r.employee}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {multiPlanResults.failed.length > 0 && (
                  <div className="multi-plan-failed">
                    <strong>✗ Failed {multiPlanResults.failed.length}:</strong>
                    <ul>
                      {multiPlanResults.failed.map((r, i) => (
                        <li key={i}>{r.employee}: {r.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="modal-actions">
                  <button type="button" className="btn-primary" onClick={closeMultiPlanModal}>Close</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitMultiPlan}>
                <div className="form-group">
                  <label>Select Employees *</label>
                  <div className="multi-plan-employee-list">
                    {employees.filter((emp) => emp.employee_id !== user?.employee_id).map((emp) => (
                      <label key={emp.employee_id} className="multi-plan-employee-item">
                        <input
                          type="checkbox"
                          checked={multiPlanSelectedEmployees.includes(emp.employee_id)}
                          onChange={() => toggleMultiPlanEmployee(emp.employee_id)}
                        />
                        <span className="emp-name">{emp.employee_name}</span>
                        <span className="emp-hours">{emp.remaining_hours}h available</span>
                      </label>
                    ))}
                  </div>
                  {multiPlanErrors.employees && <span className="form-error">{multiPlanErrors.employees}</span>}
                </div>

                <div className="form-group">
                  <label>Task description *</label>
                  <textarea
                    value={multiPlanForm.activity_description}
                    onChange={(e) => setMultiPlanForm({ ...multiPlanForm, activity_description: e.target.value })}
                    rows={2}
                    placeholder="What will be done?"
                  />
                  {multiPlanErrors.activity_description && <span className="form-error">{multiPlanErrors.activity_description}</span>}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Start date *</label>
                    <input
                      type="date"
                      value={multiPlanForm.start_date}
                      min={formatAPIDate(new Date())}
                      onChange={(e) => setMultiPlanForm({ ...multiPlanForm, start_date: e.target.value })}
                    />
                    {multiPlanErrors.start_date && <span className="form-error">{multiPlanErrors.start_date}</span>}
                  </div>
                  <div className="form-group">
                    <label>Duration per user (hours)</label>
                    <input
                      type="number"
                      min={0.5}
                      max={40}
                      step={0.5}
                      value={multiPlanForm.total_hours}
                      onChange={(e) => setMultiPlanForm({ ...multiPlanForm, total_hours: parseFloat(e.target.value) || 8 })}
                    />
                    {multiPlanErrors.total_hours && <span className="form-error">{multiPlanErrors.total_hours}</span>}
                  </div>
                </div>

                <div className="form-group">
                  <label>Max hours per day</label>
                  <select
                    value={multiPlanForm.max_hours_per_day}
                    onChange={(e) => setMultiPlanForm({ ...multiPlanForm, max_hours_per_day: parseFloat(e.target.value) })}
                  >
                    {MAX_HOURS_PER_DAY_OPTIONS.map((h) => (
                      <option key={h} value={h}>{h === 0.5 ? '30 min' : `${h}h`}</option>
                    ))}
                  </select>
                </div>

                {multiPlanErrors.submit && <div className="form-error block">{multiPlanErrors.submit}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={closeMultiPlanModal}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={multiPlanSubmitting}>
                    {multiPlanSubmitting ? 'Creating...' : `Create ${multiPlanSelectedEmployees.length} Task(s)`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Task Allocations Modal */}
      {editTaskOpen && editingTask && (
        <div className="dev-planning-modal-overlay" onClick={closeEditTask}>
          <div className="dev-planning-modal dev-planning-edit-task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Task Allocations</h3>
              <button type="button" className="modal-close-btn" onClick={closeEditTask} title="Close">×</button>
            </div>
            <p className="modal-subtitle">
              <strong>{editingTask.ticket_id ? `#${editingTask.ticket_id}` : editingTask.generic_category}</strong>
              {' – '}{editingTask.activity_description?.slice(0, 50)}{(editingTask.activity_description?.length || 0) > 50 ? '…' : ''}
            </p>
            <p className="modal-subtitle">Employee: {editingTask.employee_name}</p>

            <div className="edit-allocations-info">
              <span>Original: {(editingTask.allocations || []).reduce((s, a) => s + a.hours, 0)}h</span>
              <span>Current: {editAllocations.reduce((s, a) => s + a.hours, 0)}h</span>
              <span className={editAllocations.reduce((s, a) => s + a.hours, 0) < (editingTask.allocations || []).reduce((s, a) => s + a.hours, 0) ? 'removed' : ''}>
                {(() => {
                  const diff = (editingTask.allocations || []).reduce((s, a) => s + a.hours, 0) - editAllocations.reduce((s, a) => s + a.hours, 0);
                  return diff > 0 ? `−${diff}h will spill over` : '';
                })()}
              </span>
            </div>

            <div className="edit-allocations-list">
              <div className="edit-alloc-header">
                <span>Date</span>
                <span>Hours</span>
                <span></span>
              </div>
              {editAllocations.map((alloc, idx) => {
                const isPast = alloc.date < formatAPIDate(new Date());
                return (
                  <div key={alloc.date} className={`edit-alloc-row ${isPast ? 'past' : ''}`}>
                    <span className="edit-alloc-date">{formatDisplayDateWithDay(alloc.date)}</span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      step={0.5}
                      value={alloc.hours}
                      onChange={(e) => updateAllocationHours(idx, e.target.value)}
                      disabled={isPast}
                      className="edit-alloc-hours"
                    />
                    <button
                      type="button"
                      className="edit-alloc-remove"
                      onClick={() => removeAllocationDay(idx)}
                      disabled={isPast}
                      title={isPast ? 'Cannot remove past allocations' : 'Remove this day (hours will spill over)'}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {editAllocations.length === 0 && (
                <div className="edit-alloc-empty">No allocations. Task will be removed.</div>
              )}
            </div>

            <p className="edit-alloc-help">
              Reduce hours or remove days to free up time. Removed hours will automatically spill over to the next available working days.
            </p>

            {editTaskError && <div className="form-error block">{editTaskError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={closeEditTask}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitEditTask} disabled={editTaskSubmitting}>
                {editTaskSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Day Detail Modal */}
      {dayDetailOpen && (
        <div className="dev-planning-modal-overlay" onClick={closeDayDetail}>
          <div className="dev-planning-modal dev-planning-day-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Tasks for {formatDisplayDateWithDay(dayDetailDate)}</h3>
              <button type="button" className="modal-close-btn" onClick={closeDayDetail} title="Close">×</button>
            </div>
            <p className="modal-subtitle">Employee: {dayDetailEmployee}</p>

            {dayDetailLoading ? (
              <div className="dev-planning-skeleton">Loading…</div>
            ) : dayDetailTasks.length === 0 ? (
              <div className="day-detail-empty">No tasks allocated for this day.</div>
            ) : (
              <div className="day-detail-task-list">
                {dayDetailTasks.map((t, i) => (
                  <div key={t.task_id || i} className={`day-detail-task-item ${t.over_estimate ? 'over-estimate' : ''}`}>
                    <div className="day-detail-task-header">
                      <span className="day-detail-task-id" style={{ color: TASK_CATEGORY_COLORS[t.category] || TASK_CATEGORY_COLORS.Miscellaneous }}>
                        {t.ticket_id ? (
                          getTicketTrackingUrl(t.ticket_id) ? (
                            <a href={getTicketTrackingUrl(t.ticket_id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>#{t.ticket_id}</a>
                          ) : (
                            `#${t.ticket_id}`
                          )
                        ) : (
                          t.generic_category
                        )}
                      </span>
                      {t.ticket_priority && <span className="day-detail-priority-badge">{t.ticket_priority}</span>}
                      <span className="day-detail-task-hours">{t.hours}h</span>
                      {t.over_estimate && <span className="day-detail-over-badge">Over estimate</span>}
                    </div>
                    <div className="day-detail-task-desc">{t.activity_description}</div>
                    {t.ticket_id && (t.dev_estimate_hours != null || t.actual_dev_hours != null) && (
                      <div className="day-detail-task-meta">
                        Est: {t.dev_estimate_hours ?? '—'}h · Actual: {t.actual_dev_hours ?? '—'}h
                        {t.remaining_dev_hours != null && (
                          <span className={t.remaining_dev_hours < 0 ? 'over' : ''}>
                            {' '}· Remaining: {t.remaining_dev_hours}h
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DevelopmentTaskPlanning;
