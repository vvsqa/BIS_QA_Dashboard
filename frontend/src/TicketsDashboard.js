import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bar, Doughnut } from "react-chartjs-2";
import { useTableSort, SortableHeader } from "./useTableSort";
import { formatDisplayDate, formatDisplayDateTime, formatDisplayDateWithDay } from "./dateUtils";
import "./dashboard.css";

const BACKEND_URL = "http://127.0.0.1:8000";

// Status to Team Mapping
const STATUS_TEAM_MAPPING = {
  'NEW': 'BIS',
  'Ready For Development': 'DEV',
  'Quote Required': 'BIS',
  'Closed': 'Completed',
  'Backlog—Unranked': 'BIS',
  'Moved to Live': 'BIS',
  'Technical Review': 'DEV',
  'Approved for Live': 'DEV',
  'Live - awaiting fixes': 'DEV',
  'Express Lane Review': 'DEV',
  'In Progress': 'DEV',
  'Start Code Review': 'DEV',
  'Quote': 'BIS',
  'QC Testing': 'QA',
  'Under Review': 'BIS',
  'Code Review Failed': 'DEV',
  'QC Review Fail': 'DEV',
  'Pending Quote Approval': 'BIS',
  'BIS Testing': 'BIS - QA',
  'Planning': 'BIS',
  'Testing In Progress': 'BIS - QA',
  'Code Review Passed': 'DEV',
  'QC Testing in Progress': 'QA',
  'QC Testing Hold': 'QA',
  'Hold/Pending': 'BIS',
  'Design Review': 'BIS',
  'Ready for Design': 'BIS',
  'Design In Progress': 'BIS',
  'Tested - Awaiting Fixes': 'DEV',
  'Re-opened': 'DEV',
  'Reopened': 'DEV'
};

// Team Colors
const TEAM_COLORS = {
  'BIS': { bg: 'rgba(139, 92, 246, 0.8)', border: '#8b5cf6' },
  'DEV': { bg: 'rgba(59, 130, 246, 0.8)', border: '#3b82f6' },
  'QA': { bg: 'rgba(34, 197, 94, 0.8)', border: '#22c55e' },
  'BIS - QA': { bg: 'rgba(16, 185, 129, 0.8)', border: '#10b981' },
  'Completed': { bg: 'rgba(34, 197, 94, 0.8)', border: '#22c55e' },
  'Unknown': { bg: 'rgba(107, 114, 128, 0.8)', border: '#6b7280' }
};

function TicketsDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [etaAlerts, setEtaAlerts] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedAssignee, setSelectedAssignee] = useState(null);
  const [teamDetails, setTeamDetails] = useState(null);
  const [assigneeDetails, setAssigneeDetails] = useState(null);
  const [activeView, setActiveView] = useState('overview'); // overview, team, assignee, ticket-list, analysis
  const [ticketListFilter, setTicketListFilter] = useState(null); // {type: 'status'|'team'|'assignee'|'age', value: string, label: string}
  const [filteredTickets, setFilteredTickets] = useState([]);
  const [employeeMap, setEmployeeMap] = useState({});
  
  // Selected ticket for timesheet view
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [ticketTimesheetEntries, setTicketTimesheetEntries] = useState([]);
  const [loadingTimesheet, setLoadingTimesheet] = useState(false);
  
  // Time Analysis state
  const [timeAnalysis, setTimeAnalysis] = useState(null);
  const [analysisPeriod, setAnalysisPeriod] = useState('last_week');
  const [expandedAnalysisSections, setExpandedAnalysisSections] = useState({}); // All collapsed by default
  
  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  
  // Ref for timesheet section scrolling
  const timesheetSectionRef = useRef(null);

  const toggleAnalysisSection = (teamKey) => {
    setExpandedAnalysisSections(prev => ({
      ...prev,
      [teamKey]: !prev[teamKey]
    }));
  };

  const isAnalysisSectionExpanded = (teamKey) => {
    return expandedAnalysisSections[teamKey] || false; // Default collapsed
  };
  
  // Expand/Collapse state for sections
  const [expandedSections, setExpandedSections] = useState({
    achievement: true,
    teamCounts: true,
    etaAlerts: true,
    assignees: true
  });
  const [expandedTeamSections, setExpandedTeamSections] = useState({});
  const [expandedAssigneeLists, setExpandedAssigneeLists] = useState({}); // Track which team's assignee list is expanded
  
  // Chart maximize modal state
  const [maximizedChart, setMaximizedChart] = useState(null);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const toggleTeamSection = (teamName) => {
    setExpandedTeamSections(prev => ({
      ...prev,
      [teamName]: prev[teamName] === undefined ? false : !prev[teamName]
    }));
  };

  const isTeamSectionExpanded = (teamName) => {
    return expandedTeamSections[teamName] === undefined ? true : expandedTeamSections[teamName];
  };

  const toggleAssigneeList = (teamName) => {
    setExpandedAssigneeLists(prev => ({
      ...prev,
      [teamName]: !prev[teamName]
    }));
  };

  const isAssigneeListExpanded = (teamName) => {
    return expandedAssigneeLists[teamName] || false;
  };

  const maximizeChart = (chartData, title, chartType = 'doughnut') => {
    setMaximizedChart({ data: chartData, title, type: chartType });
  };

  const minimizeChart = () => {
    setMaximizedChart(null);
  };

  // Fetch sync status on mount
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/ticket-tracking/sync-status`);
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  }, []);

  // Sync latest TicketReport from Downloads
  const handleSyncNow = async () => {
    setSyncing(true);
    setLastSyncResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/ticket-tracking/sync-latest`, { method: 'POST' });
      const data = await res.json();
      setLastSyncResult(data);
      
      if (data.success) {
        // Refresh the data
        loadOverview();
        fetchSyncStatus();
      }
    } catch (err) {
      setLastSyncResult({ success: false, message: err.message });
    } finally {
      setSyncing(false);
      // Clear result message after 5 seconds
      setTimeout(() => setLastSyncResult(null), 5000);
    }
  };

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Check for ticket query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketId = params.get('ticket');
    if (ticketId) {
      setSelectedTicketId(ticketId);
      loadTicketTimesheetEntries(ticketId);
    } else {
      setSelectedTicketId(null);
      setTicketTimesheetEntries([]);
    }
  }, [location.search]);

  // Load timesheet entries for a specific ticket
  const loadTicketTimesheetEntries = async (ticketId) => {
    setLoadingTimesheet(true);
    try {
      const res = await fetch(`${BACKEND_URL}/calendar/ticket/${ticketId}/timesheet`);
      if (res.ok) {
        const data = await res.json();
        setTicketTimesheetEntries(data.entries || []);
      } else {
        setTicketTimesheetEntries([]);
      }
    } catch (err) {
      console.error('Failed to load timesheet entries:', err);
      setTicketTimesheetEntries([]);
    } finally {
      setLoadingTimesheet(false);
    }
  };

  // Auto-scroll to timesheet section when entries are loaded
  useEffect(() => {
    if (selectedTicketId && !loadingTimesheet && timesheetSectionRef.current) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        if (timesheetSectionRef.current) {
          timesheetSectionRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [selectedTicketId, loadingTimesheet, ticketTimesheetEntries.length]);

  // Clear ticket selection
  const clearTicketSelection = () => {
    setSelectedTicketId(null);
    setTicketTimesheetEntries([]);
    navigate('/tickets', { replace: true });
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Search for ticket in overview when both overview and ticket query param are available
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketId = params.get('ticket');
    if (ticketId && overview) {
      const allTickets = Object.values(overview.team_tickets || {}).flat();
      const foundTicket = allTickets.find(t => String(t.ticket_id) === String(ticketId));
      if (foundTicket) {
        setFilteredTickets([foundTicket]);
        setTicketListFilter({ 
          type: 'ticket-id', 
          value: ticketId, 
          label: `Ticket #${ticketId}` 
        });
        setActiveView('ticket-list');
      }
    }
  }, [overview, location.search]);

  // Load employees for name click functionality
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/employees`);
        if (res.ok) {
          const data = await res.json();
          const empMap = {};
          data.forEach(emp => {
            empMap[emp.name.toLowerCase()] = emp.employee_id;
          });
          setEmployeeMap(empMap);
        }
      } catch (err) {
        console.error('Failed to load employees:', err);
      }
    };
    loadEmployees();
  }, []);

  // Navigate to employee profile if they exist
  const handleNameClick = useCallback((name) => {
    if (!name) return;
    const normalizedName = name.toLowerCase().trim();
    const employeeId = employeeMap[normalizedName];
    if (employeeId) {
      navigate(`/employees/${employeeId}`);
    }
  }, [employeeMap, navigate]);

  // Check if a name is a valid employee
  const isValidEmployee = useCallback((name) => {
    if (!name) return false;
    return !!employeeMap[name.toLowerCase().trim()];
  }, [employeeMap]);

  // Navigate to ticket dashboard with ticket ID
  const handleTicketClick = useCallback((ticketId) => {
    if (ticketId) {
      navigate(`/?ticket=${ticketId}`);
    }
  }, [navigate]);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [overviewRes, etaRes] = await Promise.all([
        fetch(`${BACKEND_URL}/tickets-dashboard/overview`),
        fetch(`${BACKEND_URL}/tickets-dashboard/eta-alerts`)
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data);
      }

      if (etaRes.ok) {
        const data = await etaRes.json();
        setEtaAlerts(data);
      }
    } catch (err) {
      console.error('Error loading overview:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTeamDetails = async (teamName) => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/tickets-dashboard/team/${encodeURIComponent(teamName)}`);
      if (res.ok) {
        const data = await res.json();
        setTeamDetails(data);
        setSelectedTeam(teamName);
        setActiveView('team');
      }
    } catch (err) {
      console.error('Error loading team details:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAssigneeDetails = async (assigneeName) => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/tickets-dashboard/assignee/${encodeURIComponent(assigneeName)}`);
      if (res.ok) {
        const data = await res.json();
        setAssigneeDetails(data);
        setSelectedAssignee(assigneeName);
        setActiveView('assignee');
      }
    } catch (err) {
      console.error('Error loading assignee details:', err);
    } finally {
      setLoading(false);
    }
  };

  const backToOverview = () => {
    setActiveView('overview');
    setSelectedTeam(null);
    setSelectedAssignee(null);
    setTeamDetails(null);
    setAssigneeDetails(null);
    setTicketListFilter(null);
    setFilteredTickets([]);
    setTimeAnalysis(null);
  };

  const loadTimeAnalysis = async (period = analysisPeriod) => {
    setLoading(true);
    try {
      // Add timestamp to prevent caching
      const url = `${BACKEND_URL}/tickets-dashboard/time-analysis?period=${period}&_t=${Date.now()}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log('Time Analysis loaded:', { period, achievements: data.achievements, summary: data.summary });
        setTimeAnalysis(data);
        setActiveView('analysis');
      }
    } catch (err) {
      console.error('Error loading time analysis:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (newPeriod) => {
    console.log('Period changed to:', newPeriod);
    setAnalysisPeriod(newPeriod);
    // Always load when period changes
    loadTimeAnalysis(newPeriod);
  };

  const showTicketList = (filter) => {
    setTicketListFilter(filter);
    
    // Filter tickets based on the filter type
    let tickets = [];
    if (overview) {
      // Get base ticket pool - if team is specified in filter, start with that team's tickets
      let baseTickets = [];
      if (filter.team) {
        baseTickets = overview.team_tickets[filter.team] || [];
      } else {
        // Get all active tickets from all teams
        baseTickets = Object.values(overview.team_tickets).flat();
      }

      if (filter.type === 'team') {
        tickets = overview.team_tickets[filter.value] || [];
      } else if (filter.type === 'status') {
        // Case-insensitive status matching
        const filterStatus = filter.value?.toLowerCase();
        tickets = baseTickets.filter(t => {
          const ticketStatus = (t.status || '').toLowerCase();
          return ticketStatus === filterStatus;
        });
      } else if (filter.type === 'assignee') {
        // Case-insensitive assignee matching
        const filterAssignee = (filter.value || 'Unassigned').toLowerCase();
        if (filter.team) {
          tickets = baseTickets.filter(t => {
            const ticketAssignee = (t.assignee || 'Unassigned').toLowerCase();
            return ticketAssignee === filterAssignee;
          });
        } else {
          // Get from all team tickets
          tickets = baseTickets.filter(t => {
            const ticketAssignee = (t.assignee || 'Unassigned').toLowerCase();
            return ticketAssignee === filterAssignee;
          });
        }
      } else if (filter.type === 'age') {
        tickets = baseTickets.filter(t => {
          const age = t.age_days || 0;
          if (filter.value === '0-7') return age >= 0 && age <= 7;
          if (filter.value === '8-14') return age >= 8 && age <= 14;
          if (filter.value === '15-30') return age >= 15 && age <= 30;
          if (filter.value === '30+') return age > 30;
          return false;
        });
      } else if (filter.type === 'eta-overdue') {
        tickets = etaAlerts?.overdue || [];
      } else if (filter.type === 'eta-due-this-week') {
        tickets = etaAlerts?.due_this_week || [];
      } else if (filter.type === 'eta-no-eta') {
        tickets = etaAlerts?.no_eta || [];
      }
    }
    
    console.log('showTicketList filter:', filter, 'found tickets:', tickets.length);
    setFilteredTickets(tickets);
    setActiveView('ticket-list');
  };

  // Get team analytics data
  const getTeamAnalytics = (teamName) => {
    if (!overview) return null;
    
    const teamTickets = overview.team_tickets[teamName] || [];
    const statusBreakdown = overview.team_status_breakdown[teamName] || {};
    const assigneeBreakdown = {};
    const ageGroups = { '0-7': 0, '8-14': 0, '15-30': 0, '30+': 0 };
    
    teamTickets.forEach(ticket => {
      // Assignee breakdown
      const assignee = ticket.assignee || 'Unassigned';
      if (!assigneeBreakdown[assignee]) {
        assigneeBreakdown[assignee] = { count: 0, tickets: [] };
      }
      assigneeBreakdown[assignee].count++;
      assigneeBreakdown[assignee].tickets.push(ticket);
      
      // Age grouping
      const age = ticket.age_days || 0;
      if (age <= 7) ageGroups['0-7']++;
      else if (age <= 14) ageGroups['8-14']++;
      else if (age <= 30) ageGroups['15-30']++;
      else ageGroups['30+']++;
    });
    
    return {
      total: teamTickets.length,
      statusBreakdown,
      assigneeBreakdown,
      ageGroups,
      tickets: teamTickets
    };
  };

  // Chart data for team distribution
  const getTeamChartData = () => {
    if (!overview?.by_team) return null;
    
    const teams = Object.keys(overview.by_team);
    const counts = Object.values(overview.by_team);
    
    return {
      labels: teams,
      datasets: [{
        data: counts,
        backgroundColor: teams.map(t => TEAM_COLORS[t]?.bg || TEAM_COLORS['Unknown'].bg),
        borderColor: teams.map(t => TEAM_COLORS[t]?.border || TEAM_COLORS['Unknown'].border),
        borderWidth: 2
      }]
    };
  };

  // Chart data for status distribution
  const getStatusChartData = () => {
    if (!overview?.by_status) return null;
    
    // Sort by count descending and take top 10
    const statuses = Object.keys(overview.by_status)
      .sort((a, b) => overview.by_status[b] - overview.by_status[a])
      .slice(0, 10);
    const counts = statuses.map(s => overview.by_status[s]);
    
    const colors = [
      'rgba(59, 130, 246, 0.8)',
      'rgba(139, 92, 246, 0.8)',
      'rgba(34, 197, 94, 0.8)',
      'rgba(245, 158, 11, 0.8)',
      'rgba(239, 68, 68, 0.8)',
      'rgba(6, 182, 212, 0.8)',
      'rgba(236, 72, 153, 0.8)',
      'rgba(16, 185, 129, 0.8)',
      'rgba(249, 115, 22, 0.8)',
      'rgba(107, 114, 128, 0.8)'
    ];
    
    return {
      labels: statuses,
      datasets: [{
        label: 'Tickets',
        data: counts,
        backgroundColor: colors.slice(0, statuses.length),
        borderColor: colors.slice(0, statuses.length).map(c => c.replace('0.8', '1')),
        borderWidth: 1,
        borderRadius: 4
      }]
    };
  };

  // ETA Analysis Chart
  const getEtaChartData = () => {
    if (!overview?.eta_analysis) return null;
    
    const { overdue, due_this_week, no_eta, on_track } = overview.eta_analysis;
    
    return {
      labels: ['Overdue', 'Due This Week', 'No ETA', 'On Track'],
      datasets: [{
        data: [overdue, due_this_week, no_eta, on_track],
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(107, 114, 128, 0.8)',
          'rgba(34, 197, 94, 0.8)'
        ],
        borderColor: [
          '#ef4444',
          '#f59e0b',
          '#6b7280',
          '#22c55e'
        ],
        borderWidth: 2
      }]
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: theme === 'dark' ? '#e2e8f0' : '#1e293b',
          padding: 15,
          usePointStyle: true
        }
      },
      datalabels: {
        display: false
      }
    }
  };

  const barChartOptions = {
    ...chartOptions,
    indexAxis: 'y',
    plugins: {
      ...chartOptions.plugins,
      legend: { display: false }
    },
    scales: {
      x: {
        grid: { color: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
        ticks: { color: theme === 'dark' ? '#94a3b8' : '#64748b' }
      },
      y: {
        grid: { display: false },
        ticks: { color: theme === 'dark' ? '#94a3b8' : '#64748b' }
      }
    }
  };

  // Table sorting for ETA alerts
  const { sortedData: sortedOverdue, sortConfig: overdueSortConfig, handleSort: handleOverdueSort } = useTableSort(etaAlerts?.overdue || [], {
    defaultSortKey: 'days_overdue',
    defaultSortDirection: 'desc'
  });

  const { sortedData: sortedDueThisWeek, sortConfig: dueThisWeekSortConfig, handleSort: handleDueThisWeekSort } = useTableSort(etaAlerts?.due_this_week || [], {
    defaultSortKey: 'days_until_eta',
    defaultSortDirection: 'asc'
  });

  // Table sorting for team details
  const { sortedData: sortedTeamTickets, sortConfig: teamSortConfig, handleSort: handleTeamSort } = useTableSort(teamDetails?.tickets || [], {
    defaultSortKey: 'ticket_id',
    defaultSortDirection: 'desc'
  });

  // Table sorting for assignee details
  const { sortedData: sortedAssigneeTickets, sortConfig: assigneeSortConfig, handleSort: handleAssigneeSort } = useTableSort(assigneeDetails?.tickets || [], {
    defaultSortKey: 'ticket_id',
    defaultSortDirection: 'desc'
  });

  // Table sorting for filtered tickets list
  const { sortedData: sortedFilteredTickets, sortConfig: filteredSortConfig, handleSort: handleFilteredSort } = useTableSort(filteredTickets, {
    defaultSortKey: 'ticket_id',
    defaultSortDirection: 'desc'
  });

  return (
    <div className="dashboard tickets-dashboard" data-theme={theme}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            <span>QA Dashboard</span>
          </div>
        </div>
        <div className="sidebar-content">
          <button
            className="theme-toggle-sidebar"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            )}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
        <nav className="nav-menu">
          <Link to="/" className={`nav-item ${location.pathname === '/' || location.pathname === '/ticket' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Dashboard
          </Link>
          <Link to="/all-bugs" className={`nav-item ${location.pathname === '/all-bugs' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4l2 2"/>
            </svg>
            All Bugs
          </Link>
          <Link to="/tickets" className={`nav-item ${location.pathname === '/tickets' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            Tickets
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
      <main className="main-content">
        {/* Loading Indicator */}
        {loading && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Loading...</span>
          </div>
        )}

        {/* Top Header */}
        <header className="top-header">
          <div className="header-left">
            <img 
              src="/techversant-logo.png" 
              alt="Techversant Infotech" 
              className="company-logo"
            />
            <div className="header-divider"></div>
            <h1 className="page-title">Tickets Overview</h1>
            <p className="page-subtitle">Management Dashboard - Team & Status Tracking</p>
          </div>
          <div className="header-right">
            <div className="view-tabs">
              <button 
                className={`view-tab ${activeView === 'overview' || activeView === 'team' || activeView === 'assignee' || activeView === 'ticket-list' ? 'active' : ''}`}
                onClick={backToOverview}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                Overview
              </button>
              <button 
                className={`view-tab ${activeView === 'analysis' ? 'active' : ''}`}
                onClick={() => loadTimeAnalysis()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18"/>
                  <path d="M18 9l-5 5-4-4-3 3"/>
                </svg>
                Time Analysis
              </button>
            </div>
            
            {/* Sync Button */}
            <div className="sync-controls">
              <button 
                className={`sync-btn ${syncing ? 'syncing' : ''}`}
                onClick={handleSyncNow}
                disabled={syncing}
                title={syncStatus?.latest_download ? `Latest: ${syncStatus.latest_download}` : 'Sync from Downloads'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={syncing ? 'spinning' : ''}>
                  <path d="M21 12a9 9 0 11-9-9"/>
                  <path d="M21 3v6h-6"/>
                </svg>
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
              {syncStatus?.last_db_update && (
                <span className="sync-status-text" title={`Last sync: ${formatDisplayDateTime(syncStatus.last_db_update)}`}>
                  Updated: {formatDisplayDate(syncStatus.last_db_update)}
                </span>
              )}
              {lastSyncResult && (
                <span className={`sync-result ${lastSyncResult.success ? 'success' : 'error'}`}>
                  {lastSyncResult.success 
                    ? `✓ ${lastSyncResult.imported} new, ${lastSyncResult.updated} updated`
                    : `✗ ${lastSyncResult.message}`}
                </span>
              )}
            </div>
          </div>
        </header>
        {/* Breadcrumb */}
        {activeView !== 'overview' && (
          <div className="breadcrumb">
            <button onClick={backToOverview} className="breadcrumb-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
              Back to Overview
            </button>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">
              {activeView === 'team' ? `Team: ${selectedTeam}` : 
               activeView === 'assignee' ? `Assignee: ${selectedAssignee}` :
               activeView === 'ticket-list' ? ticketListFilter?.label :
               activeView === 'analysis' ? 'Time Analysis' : ''}
            </span>
          </div>
        )}

        {/* Overview View */}
        {activeView === 'overview' && overview && (
          <>
            {/* Achievement Section - Completed Tickets */}
            {overview.completed_count > 0 && (
              <div className="achievement-section">
                <div className="achievement-card">
                  <div className="achievement-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <path d="M22 4L12 14.01l-3-3"/>
                    </svg>
                  </div>
                  <div className="achievement-content">
                    <h2 className="achievement-title">Achievement Unlocked!</h2>
                    <div className="achievement-value">{overview.completed_count}</div>
                    <div className="achievement-label">Tickets Completed</div>
                    <div className="achievement-subtitle">
                      {((overview.completed_count / overview.total_tickets) * 100).toFixed(1)}% completion rate
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Active Tickets Summary */}
            <div className="tickets-summary-grid">
              <div className="summary-card active">
                <div className="summary-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18"/>
                  </svg>
                </div>
                <div className="summary-content">
                  <span className="summary-value">{overview.active_tickets || (overview.total_tickets - (overview.completed_count || 0))}</span>
                  <span className="summary-label">Active Tickets</span>
                </div>
              </div>

              {etaAlerts && (
                <>
                  <div 
                    className="summary-card overdue clickable"
                    onClick={() => showTicketList({ type: 'eta-overdue', label: 'Overdue Tickets' })}
                  >
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <span className="summary-value">{etaAlerts.summary.overdue_count}</span>
                      <span className="summary-label">Overdue</span>
                    </div>
                  </div>

                  <div 
                    className="summary-card due-soon clickable"
                    onClick={() => showTicketList({ type: 'eta-due-this-week', label: 'Due This Week' })}
                  >
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        <path d="M12 9v4M12 17h.01"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <span className="summary-value">{etaAlerts.summary.due_this_week_count}</span>
                      <span className="summary-label">Due This Week</span>
                    </div>
                  </div>

                  <div 
                    className="summary-card no-eta clickable"
                    onClick={() => showTicketList({ type: 'eta-no-eta', label: 'Tickets Without ETA' })}
                  >
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 8v4M12 16h.01"/>
                      </svg>
                    </div>
                    <div className="summary-content">
                      <span className="summary-value">{etaAlerts.summary.no_eta_count}</span>
                      <span className="summary-label">No ETA</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Team Counts Summary */}
            <div className="tickets-section">
              <h2 className="section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                </svg>
                Active Tickets by Team
              </h2>
              
              <div className="team-counts-grid">
                {Object.entries(overview.by_team)
                  .filter(([team]) => team !== 'Completed')
                  .map(([team, count]) => (
                    <div 
                      key={team} 
                      className={`team-count-card team-${team.toLowerCase().replace(/\s+/g, '-').replace('/', '-')} clickable`}
                      onClick={() => showTicketList({ type: 'team', value: team, label: `${team} Team - Active Tickets` })}
                    >
                      <div className="team-count-header">
                        <span className="team-name">{team}</span>
                        <span className="team-count-badge">{count}</span>
                      </div>
                      <div className="team-count-subtitle">Active Tickets</div>
                      <div className="team-count-action">Click to view →</div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Team-Specific Analytics Sections */}
            {Object.entries(overview.by_team)
              .filter(([team]) => team !== 'Completed' && overview.by_team[team] > 0)
              .map(([teamName, count]) => {
                const analytics = getTeamAnalytics(teamName);
                if (!analytics) return null;
                
                return (
                  <div key={teamName} className={`team-analytics-section team-${teamName.toLowerCase().replace(/\s+/g, '-').replace('/', '-')}`}>
                    <div 
                      className="team-section-header clickable"
                      onClick={() => toggleTeamSection(teamName)}
                    >
                      <h2 className="team-section-title">
                        <span className="team-title-icon">{teamName === 'BIS' ? '📋' : teamName === 'DEV' ? '💻' : teamName === 'QA' ? '✅' : '👥'}</span>
                        {teamName} Team Analytics
                      </h2>
                      <div className="team-section-controls">
                        <span className="team-total-badge">{analytics.total} Tickets</span>
                        <button className="section-toggle-btn" title={isTeamSectionExpanded(teamName) ? 'Collapse' : 'Expand'}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isTeamSectionExpanded(teamName) ? 'expanded' : ''}>
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    {isTeamSectionExpanded(teamName) && (
                    <div className="team-analytics-grid">
                      {/* Status Breakdown Chart */}
                      <div className="analytics-card">
                        <div className="analytics-card-header">
                          <h3 className="analytics-card-title">Status Distribution</h3>
                          <button 
                            className="chart-maximize-btn" 
                            onClick={(e) => {
                              e.stopPropagation();
                              maximizeChart({
                                labels: Object.keys(analytics.statusBreakdown),
                                datasets: [{
                                  data: Object.values(analytics.statusBreakdown),
                                  backgroundColor: [
                                    'rgba(59, 130, 246, 0.8)',
                                    'rgba(139, 92, 246, 0.8)',
                                    'rgba(34, 197, 94, 0.8)',
                                    'rgba(245, 158, 11, 0.8)',
                                    'rgba(239, 68, 68, 0.8)',
                                    'rgba(6, 182, 212, 0.8)'
                                  ]
                                }]
                              }, `${teamName} - Status Distribution`, 'doughnut');
                            }}
                            title="Maximize"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                            </svg>
                          </button>
                        </div>
                        <div className="chart-container-small clickable" style={{ height: '200px' }} onClick={() => showTicketList({ type: 'team', value: teamName, label: `${teamName} Team` })}>
                          {Object.keys(analytics.statusBreakdown).length > 0 && (
                            <Doughnut 
                              data={{
                                labels: Object.keys(analytics.statusBreakdown),
                                datasets: [{
                                  data: Object.values(analytics.statusBreakdown),
                                  backgroundColor: [
                                    'rgba(59, 130, 246, 0.8)',
                                    'rgba(139, 92, 246, 0.8)',
                                    'rgba(34, 197, 94, 0.8)',
                                    'rgba(245, 158, 11, 0.8)',
                                    'rgba(239, 68, 68, 0.8)',
                                    'rgba(6, 182, 212, 0.8)'
                                  ]
                                }]
                              }}
                              options={{
                                ...chartOptions,
                                onClick: (e, elements) => {
                                  if (elements.length > 0) {
                                    const index = elements[0].index;
                                    const status = Object.keys(analytics.statusBreakdown)[index];
                                    showTicketList({ type: 'status', value: status, team: teamName, label: `${status} in ${teamName}` });
                                  }
                                }
                              }}
                            />
                          )}
                        </div>
                        <div className="analytics-card-footer">Click chart to view tickets • Click ⛶ to expand</div>
                      </div>

                      {/* Assignee Breakdown */}
                      <div className="analytics-card">
                        <div className="analytics-card-header">
                          <h3 className="analytics-card-title">By Assignee</h3>
                          <span className="assignee-total-badge">{Object.keys(analytics.assigneeBreakdown).length} total</span>
                        </div>
                        <div className="assignee-list">
                          {Object.entries(analytics.assigneeBreakdown)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, isAssigneeListExpanded(teamName) ? undefined : 5)
                            .map(([assignee, data]) => (
                              <div 
                                key={assignee} 
                                className="assignee-item clickable"
                                onClick={() => showTicketList({ type: 'assignee', value: assignee, team: teamName, label: `${assignee} in ${teamName}` })}
                              >
                                <div className="assignee-avatar-small">{assignee.charAt(0).toUpperCase()}</div>
                                <div className="assignee-info-small">
                                  <span className="assignee-name-small">{assignee}</span>
                                  <span className="assignee-count-small">{data.count} tickets</span>
                                </div>
                              </div>
                            ))}
                        </div>
                        {Object.keys(analytics.assigneeBreakdown).length > 5 && (
                          <button 
                            className="view-more-btn"
                            onClick={() => toggleAssigneeList(teamName)}
                          >
                            {isAssigneeListExpanded(teamName) ? (
                              <>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 15l-6-6-6 6"/>
                                </svg>
                                Show Less
                              </>
                            ) : (
                              <>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M6 9l6 6 6-6"/>
                                </svg>
                                +{Object.keys(analytics.assigneeBreakdown).length - 5} more assignees
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Ageing Analysis */}
                      <div className="analytics-card">
                        <div className="analytics-card-header">
                          <h3 className="analytics-card-title">Ticket Ageing</h3>
                          <button 
                            className="chart-maximize-btn" 
                            onClick={(e) => {
                              e.stopPropagation();
                              maximizeChart({
                                labels: ['0-7 days', '8-14 days', '15-30 days', '30+ days'],
                                datasets: [{
                                  label: 'Tickets',
                                  data: [
                                    analytics.ageGroups['0-7'],
                                    analytics.ageGroups['8-14'],
                                    analytics.ageGroups['15-30'],
                                    analytics.ageGroups['30+']
                                  ],
                                  backgroundColor: [
                                    'rgba(34, 197, 94, 0.8)',
                                    'rgba(245, 158, 11, 0.8)',
                                    'rgba(249, 115, 22, 0.8)',
                                    'rgba(239, 68, 68, 0.8)'
                                  ],
                                  borderRadius: 4
                                }]
                              }, `${teamName} - Ticket Ageing`, 'bar');
                            }}
                            title="Maximize"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                            </svg>
                          </button>
                        </div>
                        <div className="chart-container-small" style={{ height: '200px' }}>
                          <Bar
                            data={{
                              labels: ['0-7 days', '8-14 days', '15-30 days', '30+ days'],
                              datasets: [{
                                label: 'Tickets',
                                data: [
                                  analytics.ageGroups['0-7'],
                                  analytics.ageGroups['8-14'],
                                  analytics.ageGroups['15-30'],
                                  analytics.ageGroups['30+']
                                ],
                                backgroundColor: [
                                  'rgba(34, 197, 94, 0.8)',
                                  'rgba(245, 158, 11, 0.8)',
                                  'rgba(249, 115, 22, 0.8)',
                                  'rgba(239, 68, 68, 0.8)'
                                ],
                                borderRadius: 4
                              }]
                            }}
                            options={{
                              ...barChartOptions,
                              onClick: (e, elements) => {
                                if (elements.length > 0) {
                                  const index = elements[0].index;
                                  const ageRanges = ['0-7', '8-14', '15-30', '30+'];
                                  showTicketList({ type: 'age', value: ageRanges[index], team: teamName, label: `${ageRanges[index]} days in ${teamName}` });
                                }
                              }
                            }}
                          />
                        </div>
                        <div className="analytics-card-footer">Click bars to view tickets • Click ⛶ to expand</div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}

            {/* Charts Row */}
            <div className="charts-row">
              {/* Team Distribution Chart */}
              <div className="chart-panel">
                <div className="chart-panel-header">
                  <h3 className="chart-title">Team Distribution</h3>
                  <button 
                    className="chart-maximize-btn" 
                    onClick={() => maximizeChart(getTeamChartData(), 'Team Distribution', 'doughnut')}
                    title="Maximize"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container" style={{ height: '300px' }}>
                  {getTeamChartData() && (
                    <Doughnut 
                      data={getTeamChartData()} 
                      options={{
                        ...chartOptions,
                        onClick: (e, elements) => {
                          if (elements.length > 0 && overview) {
                            const index = elements[0].index;
                            const chartData = getTeamChartData();
                            const team = chartData.labels[index];
                            console.log('Team chart clicked:', { index, team, availableTeams: Object.keys(overview.team_tickets) });
                            showTicketList({ type: 'team', value: team, label: `${team} Team` });
                          }
                        }
                      }} 
                    />
                  )}
                </div>
                <div className="chart-hint">Click segment to view tickets</div>
              </div>

              {/* ETA Analysis Chart */}
              <div className="chart-panel">
                <div className="chart-panel-header">
                  <h3 className="chart-title">ETA Analysis</h3>
                  <button 
                    className="chart-maximize-btn" 
                    onClick={() => maximizeChart(getEtaChartData(), 'ETA Analysis', 'doughnut')}
                    title="Maximize"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container" style={{ height: '300px' }}>
                  {getEtaChartData() && (
                    <Doughnut 
                      data={getEtaChartData()} 
                      options={{
                        ...chartOptions,
                        onClick: (e, elements) => {
                          if (elements.length > 0) {
                            const index = elements[0].index;
                            const etaTypes = ['eta-overdue', 'eta-due-this-week', 'eta-no-eta', 'eta-on-track'];
                            const etaLabels = ['Overdue Tickets', 'Due This Week', 'Tickets with No ETA', 'On Track Tickets'];
                            if (index < 3) { // Only overdue, due this week, no eta are clickable
                              showTicketList({ type: etaTypes[index], label: etaLabels[index] });
                            }
                          }
                        }
                      }} 
                    />
                  )}
                </div>
                <div className="chart-hint">Click segment to view tickets</div>
              </div>

              {/* Status Distribution Chart */}
              <div className="chart-panel wide">
                <div className="chart-panel-header">
                  <h3 className="chart-title">Top Statuses</h3>
                  <button 
                    className="chart-maximize-btn" 
                    onClick={() => maximizeChart(getStatusChartData(), 'Status Distribution', 'bar')}
                    title="Maximize"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container" style={{ height: '300px' }}>
                  {getStatusChartData() && (
                    <Bar 
                      data={getStatusChartData()} 
                      options={{
                        ...barChartOptions,
                        onClick: (e, elements) => {
                          if (elements.length > 0 && overview) {
                            const index = elements[0].index;
                            const chartData = getStatusChartData();
                            const status = chartData.labels[index];
                            console.log('Status chart clicked:', { index, status, count: overview.by_status[status] });
                            showTicketList({ type: 'status', value: status, label: `Status: ${status}` });
                          }
                        }
                      }} 
                    />
                  )}
                </div>
                <div className="chart-hint">Click bar to view tickets</div>
              </div>
            </div>

            {/* ETA Alerts Section */}
            {etaAlerts && (etaAlerts.overdue.length > 0 || etaAlerts.due_this_week.length > 0) && (
              <div className="tickets-section alerts-section">
                <h2 className="section-title alert-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <path d="M12 9v4M12 17h.01"/>
                  </svg>
                  ETA Alerts
                </h2>

                {etaAlerts.overdue.length > 0 && (
                  <div className="alert-group overdue">
                    <h3 className="alert-group-title">🚨 Overdue Tickets ({etaAlerts.overdue.length})</h3>
                    <div className="alerts-table-wrapper">
                      <table className="alerts-table">
                        <thead>
                          <tr>
                            <SortableHeader columnKey="ticket_id" onSort={handleOverdueSort} sortConfig={overdueSortConfig}>Ticket</SortableHeader>
                            <SortableHeader columnKey="status" onSort={handleOverdueSort} sortConfig={overdueSortConfig}>Status</SortableHeader>
                            <SortableHeader columnKey="team" onSort={handleOverdueSort} sortConfig={overdueSortConfig}>Team</SortableHeader>
                            <SortableHeader columnKey="assignee" onSort={handleOverdueSort} sortConfig={overdueSortConfig}>Assignee</SortableHeader>
                            <SortableHeader columnKey="days_overdue" onSort={handleOverdueSort} sortConfig={overdueSortConfig}>Days Overdue</SortableHeader>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOverdue.slice(0, 10).map(ticket => (
                            <tr key={ticket.ticket_id}>
                              <td>
                                <Link to={`/?ticket=${ticket.ticket_id}`} className="ticket-link">
                                  #{ticket.ticket_id}
                                </Link>
                              </td>
                              <td><span className="status-badge">{ticket.status}</span></td>
                              <td><span className={`team-badge team-${ticket.team.toLowerCase().replace(/\s+/g, '-')}`}>{ticket.team}</span></td>
                              <td onClick={() => loadAssigneeDetails(ticket.assignee)} className="clickable">{ticket.assignee}</td>
                              <td><span className="days-overdue">{ticket.days_overdue} days</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {etaAlerts.due_this_week.length > 0 && (
                  <div className="alert-group due-soon">
                    <h3 className="alert-group-title">⏰ Due This Week ({etaAlerts.due_this_week.length})</h3>
                    <div className="alerts-table-wrapper">
                      <table className="alerts-table">
                        <thead>
                          <tr>
                            <SortableHeader columnKey="ticket_id" onSort={handleDueThisWeekSort} sortConfig={dueThisWeekSortConfig}>Ticket</SortableHeader>
                            <SortableHeader columnKey="status" onSort={handleDueThisWeekSort} sortConfig={dueThisWeekSortConfig}>Status</SortableHeader>
                            <SortableHeader columnKey="team" onSort={handleDueThisWeekSort} sortConfig={dueThisWeekSortConfig}>Team</SortableHeader>
                            <SortableHeader columnKey="assignee" onSort={handleDueThisWeekSort} sortConfig={dueThisWeekSortConfig}>Assignee</SortableHeader>
                            <SortableHeader columnKey="days_until_eta" onSort={handleDueThisWeekSort} sortConfig={dueThisWeekSortConfig}>Days Until ETA</SortableHeader>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDueThisWeek.slice(0, 10).map(ticket => (
                            <tr key={ticket.ticket_id}>
                              <td>
                                <Link to={`/?ticket=${ticket.ticket_id}`} className="ticket-link">
                                  #{ticket.ticket_id}
                                </Link>
                              </td>
                              <td><span className="status-badge">{ticket.status}</span></td>
                              <td><span className={`team-badge team-${ticket.team.toLowerCase().replace(/\s+/g, '-')}`}>{ticket.team}</span></td>
                              <td onClick={() => loadAssigneeDetails(ticket.assignee)} className="clickable">{ticket.assignee}</td>
                              <td><span className="days-until">{ticket.days_until_eta} days</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Assignees Section */}
            <div className="tickets-section">
              <h2 className="section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="7" r="4"/>
                  <path d="M5.5 21v-2a6.5 6.5 0 0113 0v2"/>
                </svg>
                Tickets by Assignee
              </h2>
              
              <div className="assignees-grid">
                {Object.entries(overview.by_assignee)
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 20)
                  .map(([assignee, data]) => (
                    <div 
                      key={assignee} 
                      className="assignee-card"
                      onClick={() => loadAssigneeDetails(assignee)}
                    >
                      <div className="assignee-avatar">
                        {assignee.charAt(0).toUpperCase()}
                      </div>
                      <div className="assignee-info">
                        <span className="assignee-name">{assignee}</span>
                        <span className="assignee-count">{data.count} tickets</span>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="assignee-arrow">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* Team Detail View */}
        {activeView === 'team' && teamDetails && (
          <div className="team-detail-view">
            <div className="detail-header">
              <h2 className={`team-title team-${selectedTeam.toLowerCase().replace(/\s+/g, '-')}`}>
                {selectedTeam} Team
              </h2>
              <span className="detail-count">{teamDetails.total_tickets} Tickets</span>
            </div>

            {/* Status Breakdown */}
            <div className="detail-section">
              <h3>Status Breakdown</h3>
              <div className="status-breakdown-grid">
                {Object.entries(teamDetails.status_breakdown).map(([status, count]) => (
                  <div key={status} className="status-breakdown-card">
                    <span className="status-name">{status}</span>
                    <span className="status-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Assignee Breakdown */}
            <div className="detail-section">
              <h3>Team Members</h3>
              <div className="assignee-breakdown-grid">
                {Object.entries(teamDetails.assignee_breakdown)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([assignee, data]) => (
                    <div 
                      key={assignee} 
                      className="assignee-breakdown-card"
                      onClick={() => loadAssigneeDetails(assignee)}
                    >
                      <div className="assignee-avatar">{assignee.charAt(0).toUpperCase()}</div>
                      <div className="assignee-details">
                        <span className="assignee-name">{assignee}</span>
                        <span className="assignee-tickets">{data.count} tickets</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Tickets Table */}
            <div className="detail-section">
              <h3>All Tickets</h3>
              <div className="tickets-table-wrapper">
                <table className="tickets-table">
                  <thead>
                    <tr>
                      <SortableHeader columnKey="ticket_id" onSort={handleTeamSort} sortConfig={teamSortConfig}>Ticket ID</SortableHeader>
                      <SortableHeader columnKey="status" onSort={handleTeamSort} sortConfig={teamSortConfig}>Status</SortableHeader>
                      <SortableHeader columnKey="assignee" onSort={handleTeamSort} sortConfig={teamSortConfig}>Assignee</SortableHeader>
                      <SortableHeader columnKey="eta" onSort={handleTeamSort} sortConfig={teamSortConfig}>ETA</SortableHeader>
                      <SortableHeader columnKey="dev_estimate" onSort={handleTeamSort} sortConfig={teamSortConfig}>Dev Est.</SortableHeader>
                      <SortableHeader columnKey="dev_actual" onSort={handleTeamSort} sortConfig={teamSortConfig}>Dev Actual</SortableHeader>
                      <SortableHeader columnKey="qa_estimate" onSort={handleTeamSort} sortConfig={teamSortConfig}>QA Est.</SortableHeader>
                      <SortableHeader columnKey="qa_actual" onSort={handleTeamSort} sortConfig={teamSortConfig}>QA Actual</SortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTeamTickets.map(ticket => (
                      <tr key={ticket.ticket_id}>
                        <td>
                          <Link to={`/?ticket=${ticket.ticket_id}`} className="ticket-link">
                            #{ticket.ticket_id}
                          </Link>
                        </td>
                        <td><span className="status-badge">{ticket.status}</span></td>
                        <td>
                          <span 
                            className={isValidEmployee(ticket.assignee) ? 'clickable-name' : ''}
                            onClick={() => handleNameClick(ticket.assignee)}
                            style={isValidEmployee(ticket.assignee) ? { cursor: 'pointer', color: '#6366f1' } : {}}
                          >
                            {ticket.assignee}
                          </span>
                        </td>
                        <td>{formatDisplayDate(ticket.eta)}</td>
                        <td>{ticket.dev_estimate || '-'}h</td>
                        <td>{ticket.dev_actual || '-'}h</td>
                        <td>{ticket.qa_estimate || '-'}h</td>
                        <td>{ticket.qa_actual || '-'}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Assignee Detail View */}
        {activeView === 'assignee' && assigneeDetails && (
          <div className="assignee-detail-view">
            <div className="detail-header">
              <div className="assignee-avatar large">{selectedAssignee.charAt(0).toUpperCase()}</div>
              <div>
                <h2 
                  className={`assignee-title ${isValidEmployee(selectedAssignee) ? 'clickable-name' : ''}`}
                  onClick={() => handleNameClick(selectedAssignee)}
                  style={isValidEmployee(selectedAssignee) ? { cursor: 'pointer' } : {}}
                >
                  {selectedAssignee}
                  {isValidEmployee(selectedAssignee) && (
                    <span style={{ fontSize: '14px', marginLeft: '8px', opacity: 0.7 }}>→ View Profile</span>
                  )}
                </h2>
                <span className="detail-count">{assigneeDetails.total_tickets} Tickets Assigned</span>
              </div>
            </div>

            {/* Team & Status Breakdown */}
            <div className="breakdown-row">
              <div className="detail-section">
                <h3>By Team</h3>
                <div className="mini-breakdown">
                  {Object.entries(assigneeDetails.team_breakdown).map(([team, count]) => (
                    <div key={team} className={`mini-breakdown-item team-${team.toLowerCase().replace(/\s+/g, '-')}`}>
                      <span>{team}</span>
                      <span className="count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="detail-section">
                <h3>By Status</h3>
                <div className="mini-breakdown">
                  {Object.entries(assigneeDetails.status_breakdown).map(([status, count]) => (
                    <div key={status} className="mini-breakdown-item">
                      <span>{status}</span>
                      <span className="count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tickets Table */}
            <div className="detail-section">
              <h3>All Tickets</h3>
              <div className="tickets-table-wrapper">
                <table className="tickets-table">
                  <thead>
                    <tr>
                      <SortableHeader columnKey="ticket_id" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>Ticket ID</SortableHeader>
                      <SortableHeader columnKey="status" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>Status</SortableHeader>
                      <SortableHeader columnKey="team" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>Team</SortableHeader>
                      <SortableHeader columnKey="eta" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>ETA</SortableHeader>
                      <SortableHeader columnKey="dev_estimate" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>Dev Est.</SortableHeader>
                      <SortableHeader columnKey="dev_actual" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>Dev Actual</SortableHeader>
                      <SortableHeader columnKey="qa_estimate" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>QA Est.</SortableHeader>
                      <SortableHeader columnKey="qa_actual" onSort={handleAssigneeSort} sortConfig={assigneeSortConfig}>QA Actual</SortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssigneeTickets.map(ticket => (
                      <tr key={ticket.ticket_id}>
                        <td>
                          <Link to={`/?ticket=${ticket.ticket_id}`} className="ticket-link">
                            #{ticket.ticket_id}
                          </Link>
                        </td>
                        <td><span className="status-badge">{ticket.status}</span></td>
                        <td><span className={`team-badge team-${ticket.team.toLowerCase().replace(/\s+/g, '-')}`}>{ticket.team}</span></td>
                        <td>{formatDisplayDate(ticket.eta)}</td>
                        <td>{ticket.dev_estimate || '-'}h</td>
                        <td>{ticket.dev_actual || '-'}h</td>
                        <td>{ticket.qa_estimate || '-'}h</td>
                        <td>{ticket.qa_actual || '-'}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Ticket List View */}
        {activeView === 'ticket-list' && ticketListFilter && (
          <div className="ticket-list-view">
            <div className="ticket-list-header">
              <h2 className="ticket-list-title">{ticketListFilter.label}</h2>
              <span className="ticket-list-count">{filteredTickets.length} tickets</span>
            </div>

            <div className="tickets-table-wrapper">
              <table className="tickets-table">
                <thead>
                  <tr>
                    <SortableHeader columnKey="ticket_id" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Ticket ID</SortableHeader>
                    <SortableHeader columnKey="status" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Status</SortableHeader>
                    <SortableHeader columnKey="team" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Team</SortableHeader>
                    <SortableHeader columnKey="assignee" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Assignee</SortableHeader>
                    <SortableHeader columnKey="age_days" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Age (Days)</SortableHeader>
                    <SortableHeader columnKey="eta" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>ETA</SortableHeader>
                    <SortableHeader columnKey="dev_estimate" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Dev Est.</SortableHeader>
                    <SortableHeader columnKey="dev_actual" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>Dev Actual</SortableHeader>
                    <SortableHeader columnKey="qa_estimate" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>QA Est.</SortableHeader>
                    <SortableHeader columnKey="qa_actual" onSort={handleFilteredSort} sortConfig={filteredSortConfig}>QA Actual</SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredTickets.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        No tickets found
                      </td>
                    </tr>
                  ) : (
                    sortedFilteredTickets.map(ticket => (
                      <tr key={ticket.ticket_id}>
                        <td>
                          <Link to={`/?ticket=${ticket.ticket_id}`} className="ticket-link">
                            #{ticket.ticket_id}
                          </Link>
                        </td>
                        <td><span className="status-badge">{ticket.status}</span></td>
                        <td><span className={`team-badge team-${(ticket.team || 'Unknown').toLowerCase().replace(/\s+/g, '-')}`}>{ticket.team || 'Unknown'}</span></td>
                        <td onClick={() => loadAssigneeDetails(ticket.assignee)} className="clickable">{ticket.assignee || 'Unassigned'}</td>
                        <td>
                          <span className={`age-badge ${(ticket.age_days || 0) > 30 ? 'age-critical' : (ticket.age_days || 0) > 14 ? 'age-warning' : 'age-normal'}`}>
                            {ticket.age_days || 0} days
                          </span>
                        </td>
                        <td>{formatDisplayDate(ticket.eta)}</td>
                        <td>{ticket.dev_estimate || '-'}h</td>
                        <td>{ticket.dev_actual || '-'}h</td>
                        <td>{ticket.qa_estimate || '-'}h</td>
                        <td>{ticket.qa_actual || '-'}h</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Time Analysis View */}
        {activeView === 'analysis' && (
          <div className="analysis-view">
            {/* Period Selector */}
            <div className="analysis-controls">
              <div className="control-group">
                <label className="control-label">Time Period</label>
                <div className="period-selector">
                  <button 
                    className={`period-btn ${analysisPeriod === 'last_week' ? 'active' : ''}`}
                    onClick={() => handlePeriodChange('last_week')}
                  >
                    Last Week
                  </button>
                  <button 
                    className={`period-btn ${analysisPeriod === 'last_2_weeks' ? 'active' : ''}`}
                    onClick={() => handlePeriodChange('last_2_weeks')}
                  >
                    Last 2 Weeks
                  </button>
                  <button 
                    className={`period-btn ${analysisPeriod === 'last_month' ? 'active' : ''}`}
                    onClick={() => handlePeriodChange('last_month')}
                  >
                    Last Month
                  </button>
                </div>
              </div>
              
              {timeAnalysis && (
                <div className="period-info">
                  <span className="period-dates">{timeAnalysis.period.start_date} → {timeAnalysis.period.end_date}</span>
                  <span className="period-total">{timeAnalysis.summary.active_tickets || 0} active tickets</span>
                  <span className="period-closed">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <path d="M22 4L12 14.01l-3-3"/>
                    </svg>
                    {timeAnalysis.summary.closed_tickets || 0} closed
                  </span>
                  {timeAnalysis._debug && (
                    <span className="period-debug" title={JSON.stringify(timeAnalysis._debug, null, 2)}>
                      📊 {timeAnalysis._debug.period_tickets_count} in period
                    </span>
                  )}
                </div>
              )}
            </div>

            {timeAnalysis && timeAnalysis.teams && (
              <>
                {/* Achievements Section */}
                {timeAnalysis.achievements && (
                  <div className="achievements-section">
                    <h2 className="achievements-title">
                      <span className="trophy-icon">🏆</span>
                      Achievements for this Period
                    </h2>
                    <div className="achievements-grid">
                      {/* DEV Achievement */}
                      <div className="achievement-card dev">
                        <div className="achievement-icon">{timeAnalysis.achievements.DEV?.icon || '🧪'}</div>
                        <div className="achievement-content">
                          <span className="achievement-team">DEV Team</span>
                          <span className="achievement-count">{timeAnalysis.achievements.DEV?.count || 0}</span>
                          <span className="achievement-label">{timeAnalysis.achievements.DEV?.label || 'Moved to QC Testing'}</span>
                        </div>
                      </div>

                      {/* QA Achievement - BIS Testing */}
                      <div className="achievement-card qa">
                        <div className="achievement-icon">{timeAnalysis.achievements.QA?.bis_testing?.icon || '🔍'}</div>
                        <div className="achievement-content">
                          <span className="achievement-team">QA Team</span>
                          <span className="achievement-count">{timeAnalysis.achievements.QA?.bis_testing?.count || 0}</span>
                          <span className="achievement-label">{timeAnalysis.achievements.QA?.bis_testing?.label || 'Moved to BIS Testing'}</span>
                        </div>
                      </div>

                      {/* QA Achievement - Closed */}
                      <div className="achievement-card qa-closed">
                        <div className="achievement-icon">{timeAnalysis.achievements.QA?.closed?.icon || '✅'}</div>
                        <div className="achievement-content">
                          <span className="achievement-team">QA Team</span>
                          <span className="achievement-count">{timeAnalysis.achievements.QA?.closed?.count || 0}</span>
                          <span className="achievement-label">{timeAnalysis.achievements.QA?.closed?.label || 'Moved to Closed'}</span>
                        </div>
                      </div>

                      {/* BIS-QA Achievement */}
                      <div className="achievement-card bis-qa">
                        <div className="achievement-icon">{timeAnalysis.achievements.BIS_QA?.icon || '🚀'}</div>
                        <div className="achievement-content">
                          <span className="achievement-team">BIS-QA Team</span>
                          <span className="achievement-count">{timeAnalysis.achievements.BIS_QA?.count || 0}</span>
                          <span className="achievement-label">{timeAnalysis.achievements.BIS_QA?.label || 'Approved for Live'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Team Sections - QA first, then DEV, BIS, BIS-QA */}
                {['QA', 'DEV', 'BIS', 'BIS - QA'].map(teamKey => {
                  const teamData = timeAnalysis.teams[teamKey];
                  if (!teamData) return null;
                  
                  const isExpanded = isAnalysisSectionExpanded(teamKey);
                  
                  return (
                    <div key={teamKey} className={`team-section-analysis team-${teamKey.toLowerCase().replace(/\s+/g, '-').replace('/', '-')} ${isExpanded ? 'expanded' : 'collapsed'}`}>
                      <div 
                        className="team-section-header-analysis clickable"
                        onClick={() => toggleAnalysisSection(teamKey)}
                      >
                        <div className="team-header-left">
                          <button className="section-expand-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isExpanded ? 'expanded' : ''}>
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </button>
                          <span className="team-icon">
                            {teamKey === 'BIS' ? '📋' : teamKey === 'DEV' ? '💻' : teamKey === 'QA' ? '✅' : '🔍'}
                          </span>
                          <div className="team-header-info">
                            <h2 className="team-name-large">{teamData.name}</h2>
                            <span className="team-description">{teamData.description}</span>
                          </div>
                        </div>
                        <div className="team-header-stats">
                          <div className="team-stat-badge primary">
                            <span className="stat-number">{teamData.total_tickets}</span>
                            <span className="stat-label">Tickets</span>
                          </div>
                          <div className="team-stat-badge">
                            <span className="stat-number">{teamData.members.length}</span>
                            <span className="stat-label">Members</span>
                          </div>
                          {/* QA-specific metrics */}
                          {teamKey === 'QA' && teamData.moved_to_bis_testing !== undefined && (
                            <div className="team-stat-badge success">
                              <span className="stat-number">{teamData.moved_to_bis_testing}</span>
                              <span className="stat-label">→ BIS Testing</span>
                            </div>
                          )}
                          {teamKey === 'QA' && teamData.moved_to_dev !== undefined && teamData.moved_to_dev > 0 && (
                            <div className="team-stat-badge warning">
                              <span className="stat-number">{teamData.moved_to_dev}</span>
                              <span className="stat-label">→ Back to Dev</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Collapsible Content */}
                      {isExpanded && (
                        <div className="team-section-content">
                          {/* Status Breakdown */}
                          <div className="team-status-breakdown">
                            <h3 className="subsection-title">Status Distribution</h3>
                            <div className="status-bar-chart">
                              {Object.entries(teamData.status_breakdown)
                                .sort(([,a], [,b]) => b - a)
                                .map(([status, count]) => (
                                  <div 
                                    key={status} 
                                    className="status-bar-item clickable"
                                    onClick={() => {
                                      const tickets = teamData.members.flatMap(m => m.tickets).filter(t => t.status === status);
                                      setFilteredTickets(tickets);
                                      setTicketListFilter({ label: `${teamKey}: ${status}` });
                                      setActiveView('ticket-list');
                                    }}
                                  >
                                    <div className="status-bar-label">
                                      <span className="status-name">{status}</span>
                                      <span className="status-count">{count}</span>
                                    </div>
                                    <div className="status-bar-track">
                                      <div 
                                        className="status-bar-fill"
                                        style={{ width: `${(count / teamData.total_tickets) * 100}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>

                          {/* Team Members */}
                          <div className="team-members-section">
                            <h3 className="subsection-title">Team Members & Their Work</h3>
                            <div className="team-members-grid">
                              {teamData.members.map(member => (
                                <div key={member.name} className="team-member-card">
                                  <div className="member-header">
                                    <div className="member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                                    <div className="member-info">
                                      <span className="member-name">{member.name}</span>
                                      <span className="member-ticket-count">{member.ticket_count} tickets</span>
                                    </div>
                                  </div>
                                  
                                  <div className="member-statuses">
                                    {Object.entries(member.status_breakdown)
                                      .sort(([,a], [,b]) => b - a)
                                      .slice(0, 4)
                                      .map(([status, count]) => (
                                        <span key={status} className="member-status-pill">
                                          {status}: {count}
                                        </span>
                                      ))}
                                  </div>
                                  
                                  <button 
                                    className="view-member-tickets-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFilteredTickets(member.tickets);
                                      setTicketListFilter({ label: `${member.name}'s Tickets (${teamKey})` });
                                      setActiveView('ticket-list');
                                    }}
                                  >
                                    View Tickets →
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Other Teams (if any) */}
                {Object.entries(timeAnalysis.teams)
                  .filter(([key]) => !['BIS', 'DEV', 'QA', 'BIS - QA'].includes(key))
                  .map(([teamKey, teamData]) => {
                    const isExpanded = isAnalysisSectionExpanded(teamKey);
                    return (
                      <div key={teamKey} className={`team-section-analysis team-other ${isExpanded ? 'expanded' : 'collapsed'}`}>
                        <div 
                          className="team-section-header-analysis clickable"
                          onClick={() => toggleAnalysisSection(teamKey)}
                        >
                          <div className="team-header-left">
                            <button className="section-expand-btn">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isExpanded ? 'expanded' : ''}>
                                <path d="M6 9l6 6 6-6"/>
                              </svg>
                            </button>
                            <span className="team-icon">📁</span>
                            <div className="team-header-info">
                              <h2 className="team-name-large">{teamData.name}</h2>
                            </div>
                          </div>
                          <div className="team-header-stats">
                            <div className="team-stat-badge primary">
                              <span className="stat-number">{teamData.total_tickets}</span>
                              <span className="stat-label">Tickets</span>
                            </div>
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <div className="team-section-content">
                            <div className="team-members-section">
                              <div className="team-members-grid">
                                {teamData.members.map(member => (
                                  <div key={member.name} className="team-member-card compact">
                                    <div className="member-header">
                                      <div className="member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                                      <div className="member-info">
                                        <span className="member-name">{member.name}</span>
                                        <span className="member-ticket-count">{member.ticket_count} tickets</span>
                                      </div>
                                    </div>
                                    <button 
                                      className="view-member-tickets-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFilteredTickets(member.tickets);
                                        setTicketListFilter({ label: `${member.name}'s Tickets` });
                                        setActiveView('ticket-list');
                                      }}
                                    >
                                      View →
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </>
            )}

            {!timeAnalysis && !loading && (
              <div className="analysis-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18"/>
                  <path d="M18 9l-5 5-4-4-3 3"/>
                </svg>
                <p>Select a time period to view analysis</p>
              </div>
            )}
          </div>
        )}

        {/* Ticket Timesheet Entries Section */}
        {selectedTicketId && (
          <div className="ticket-timesheet-section" ref={timesheetSectionRef}>
            <div className="timesheet-header">
              <div className="timesheet-title-group">
                <h2 className="timesheet-title">
                  <span className="ticket-badge">#{selectedTicketId}</span>
                  Timesheet Entries
                </h2>
                <span className="timesheet-count">
                  {ticketTimesheetEntries.length} entries found
                </span>
              </div>
              <button className="close-timesheet-btn" onClick={clearTicketSelection}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
                Close
              </button>
            </div>

            {loadingTimesheet ? (
              <div className="timesheet-loading">
                <div className="loading-spinner"></div>
                <span>Loading timesheet entries...</span>
              </div>
            ) : ticketTimesheetEntries.length > 0 ? (
              <>
                {/* Summary Stats */}
                <div className="timesheet-summary">
                  <div className="timesheet-stat">
                    <span className="stat-value">
                      {ticketTimesheetEntries.reduce((sum, e) => sum + (e.hours_logged || 0), 0).toFixed(1)}h
                    </span>
                    <span className="stat-label">Total Hours</span>
                  </div>
                  <div className="timesheet-stat">
                    <span className="stat-value">
                      {[...new Set(ticketTimesheetEntries.map(e => e.employee_name))].length}
                    </span>
                    <span className="stat-label">Contributors</span>
                  </div>
                  <div className="timesheet-stat">
                    <span className="stat-value">
                      {[...new Set(ticketTimesheetEntries.map(e => e.date))].length}
                    </span>
                    <span className="stat-label">Days Worked</span>
                  </div>
                </div>

                {/* Timesheet Table */}
                <div className="timesheet-table-wrapper">
                  <table className="timesheet-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Team</th>
                        <th>Hours</th>
                        <th>Task Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticketTimesheetEntries
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .map((entry, idx) => (
                          <tr key={idx}>
                            <td className="date-cell">
                              {formatDisplayDateWithDay(entry.date)}
                            </td>
                            <td className="employee-cell">
                              <span 
                                className={employeeMap[entry.employee_name?.toLowerCase()] ? 'clickable-name' : ''}
                                onClick={() => handleNameClick(entry.employee_name)}
                              >
                                {entry.employee_name}
                              </span>
                            </td>
                            <td>
                              <span className={`team-badge team-${(entry.team || 'unknown').toLowerCase()}`}>
                                {entry.team || 'Unknown'}
                              </span>
                            </td>
                            <td className="hours-cell">
                              <span className="hours-value">{parseFloat(entry.hours_logged || 0).toFixed(1)}h</span>
                            </td>
                            <td className="desc-cell">{entry.task_description || '-'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="timesheet-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                <p>No timesheet entries found for ticket #{selectedTicketId}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Chart Maximize Modal */}
      {maximizedChart && (
        <div className="chart-modal-overlay" onClick={minimizeChart}>
          <div className="chart-modal-content" onClick={e => e.stopPropagation()}>
            <div className="chart-modal-header">
              <h2 className="chart-modal-title">{maximizedChart.title}</h2>
              <button className="chart-modal-close" onClick={minimizeChart}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="chart-modal-body">
              <div className="chart-modal-chart">
                {maximizedChart.type === 'doughnut' && maximizedChart.data && (
                  <Doughnut 
                    data={maximizedChart.data} 
                    options={{
                      ...chartOptions,
                      plugins: {
                        ...chartOptions.plugins,
                        legend: {
                          ...chartOptions.plugins.legend,
                          position: 'right',
                          labels: {
                            ...chartOptions.plugins.legend.labels,
                            font: { size: 14 }
                          }
                        }
                      }
                    }} 
                  />
                )}
                {maximizedChart.type === 'bar' && maximizedChart.data && (
                  <Bar 
                    data={maximizedChart.data} 
                    options={{
                      ...barChartOptions,
                      indexAxis: 'y',
                      plugins: {
                        ...barChartOptions.plugins,
                        legend: { display: true }
                      }
                    }} 
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TicketsDashboard;
