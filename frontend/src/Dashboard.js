import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { formatDisplayDate, formatDisplayDateTime } from "./dateUtils";
import { TicketExternalLink } from "./ticketUtils";
import "./dashboard.css";

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

const BACKEND_URL = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:8000`;

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
  'Tested - Awaiting Fixes': 'DEV'
};

// Speedometer Gauge Component
function SpeedometerGauge({ value, label, maxValue = 100, theme = 'dark' }) {
  const percentage = Math.min((value / maxValue) * 100, 100);
  const rotation = (percentage / 100) * 180;
  
  // Color based on value
  const getColor = () => {
    if (percentage < 30) return "#ef4444";
    if (percentage < 60) return "#f59e0b";
    return "#22c55e";
  };

  // Generate more tick marks for speedometer lines (20 ticks for better granularity)
  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const angle = (i * 9) - 90; // 9 degrees per tick (180/20)
    const isMain = i % 5 === 0; // Every 5th tick is main (0, 25, 50, 75, 100)
    const isMedium = i % 2 === 0 && !isMain; // Every 2nd tick is medium
    ticks.push(
      <div
        key={i}
        className={`tick ${isMain ? 'main' : isMedium ? 'medium' : 'minor'}`}
        style={{ transform: `rotate(${angle}deg)` }}
      />
    );
  }

  return (
    <div className="speedometer-container">
      <div className="speedometer-label">{label}</div>
      <div className="speedometer">
        <div className="speedometer-body">
          {/* Background arc */}
          <div className="speedometer-track"></div>
          
          {/* Colored progress arc */}
          <div 
            className="speedometer-progress"
            style={{ 
              background: `conic-gradient(
                from 180deg,
                ${getColor()} 0deg,
                ${getColor()} ${rotation}deg,
                transparent ${rotation}deg,
                transparent 180deg
              )`
            }}
          ></div>
          
          {/* Tick marks - speedometer lines */}
          <div className="speedometer-ticks">
            {ticks}
          </div>
          
          {/* Needle */}
          <div 
            className="speedometer-needle"
            style={{ transform: `rotate(${rotation - 90}deg)` }}
          >
            <div className="needle-pointer"></div>
          </div>
          
          {/* Center cap */}
          <div className="speedometer-center"></div>
        </div>
        
        {/* Scale labels */}
        <div className="speedometer-scale">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>
      
      {/* Percentage display outside gauge */}
      <div className="speedometer-percentage">
        <span className="percentage-value" style={{ color: getColor() }}>{value.toFixed(1)}</span>
        <span className="percentage-unit">%</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('dashboard-theme');
      return savedTheme || 'dark';
    } catch (e) {
      return 'dark';
    }
  });
  
  // Read ticket ID from URL params on load
  const [ticketId, setTicketId] = useState(() => {
    const urlTicketId = searchParams.get('ticket');
    return urlTicketId || "";
  });
  
  // Employee data for name lookups
  const [employeeMap, setEmployeeMap] = useState({});
  const [environment, setEnvironment] = useState("All");
  const [platform, setPlatform] = useState("All");
  const [ticketInfo, setTicketInfo] = useState({ ticket_title: "", platform: "Web" });

  const [summary, setSummary] = useState({
    total_bugs: 0,
    open_bugs: 0,
    pending_retest: 0,
    closed_bugs: 0,
    deferred_bugs: 0,
    rejected_bugs: 0,
  });

  const [severityData, setSeverityData] = useState(null);
  const [priorityData, setPriorityData] = useState(null);
  const [metrics, setMetrics] = useState({ closure_rate: 0, critical_percentage: 0 });

  // New widget data states
  const [assigneeData, setAssigneeData] = useState(null);
  const [authorData, setAuthorData] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [featureData, setFeatureData] = useState(null);
  const [browserOsData, setBrowserOsData] = useState(null);
  const [platformData, setPlatformData] = useState(null);
  const [ageData, setAgeData] = useState(null);
  const [resolutionTimeData, setResolutionTimeData] = useState(null);
  const [reopenedData, setReopenedData] = useState(null);

  const [bugs, setBugs] = useState([]);
  const [deferredBugs, setDeferredBugs] = useState([]);
  const [testRailSummary, setTestRailSummary] = useState({
    total_test_cases: 0,
    total_test_results: 0,
    status_counts: { Passed: 0, Failed: 0, Blocked: 0, Retest: 0, Untested: 0 },
    test_plans_count: 0,
    test_runs_count: 0,
    test_plan_name: null
  });
  const [testCases, setTestCases] = useState([]);
  const [testStatusData, setTestStatusData] = useState(null);
  const [testRuns, setTestRuns] = useState([]);
  const [expandedTestCasesSection, setExpandedTestCasesSection] = useState(true);
  
  // Ticket Tracking state
  const [ticketTracking, setTicketTracking] = useState(null);
  const [expandedTicketTracking, setExpandedTicketTracking] = useState(true);
  
  // Employees for team classification
  const [employeeTeamMap, setEmployeeTeamMap] = useState({});
  
  // Full employee data for lead lookup
  const [allEmployees, setAllEmployees] = useState([]);
  
  // Team leads (derived from ticket team members) - arrays to support multiple leads
  const [teamLeads, setTeamLeads] = useState({ dev_leads: [], qa_leads: [] });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Ticket autocomplete state
  const [ticketSuggestions, setTicketSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [ticketInputValue, setTicketInputValue] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const ticketInputRef = useRef(null);

  // Maximize/minimize state for charts
  const [maximizedChart, setMaximizedChart] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    'team-performance': true,
    'technical-breakdown': true,
    'temporal-analysis': true,
    'additional-metrics': true,
  });
  const [expandedBugLists, setExpandedBugLists] = useState({
    'open-bugs': true,
    'deferred-bugs': true,
    'test-cases': true,
  });
  const [expandedOtherTestRuns, setExpandedOtherTestRuns] = useState(true);

  const maximizeChart = (chartId) => {
    setMaximizedChart(chartId);
    // Prevent body scroll when modal is open
    document.body.classList.add('modal-open');
  };

  const minimizeChart = () => {
    setMaximizedChart(null);
    // Restore body scroll when modal is closed
    document.body.classList.remove('modal-open');
  };

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  const toggleBugList = (listId) => {
    setExpandedBugLists(prev => ({
      ...prev,
      [listId]: !prev[listId]
    }));
  };

  // Fetch ticket suggestions for autocomplete
  const fetchTicketSuggestions = useCallback(async (query) => {
    if (!query || query.length < 1) {
      setTicketSuggestions([]);
      return;
    }
    
    try {
      const response = await fetch(`${BACKEND_URL}/tickets/search?query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setTicketSuggestions(data);
      }
    } catch (err) {
      console.error('Error fetching ticket suggestions:', err);
      setTicketSuggestions([]);
    }
  }, []);

  // Debounced ticket search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTicketSuggestions(ticketInputValue);
    }, 200);
    
    return () => clearTimeout(timer);
  }, [ticketInputValue, fetchTicketSuggestions]);

  // Handle ticket selection from dropdown
  const handleTicketSelect = (ticket) => {
    setTicketId(String(ticket.ticket_id));
    setTicketInputValue(String(ticket.ticket_id));
    setShowSuggestions(false);
    setSearchParams({ ticket: String(ticket.ticket_id) });
  };

  // Handle input change for ticket autocomplete
  const handleTicketInputChange = (value) => {
    // Only allow numeric input
    const numericValue = value.replace(/[^0-9]/g, '');
    setTicketInputValue(numericValue);
    setShowSuggestions(numericValue.length > 0);
    
    // Update dropdown position while typing
    if (ticketInputRef.current) {
      const rect = ticketInputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width
      });
    }
    
    // Clear the actual ticketId if input is cleared
    if (!numericValue) {
      handleTicketIdChange("");
    }
  };

  // Theme toggle handler - set theme on mount and when it changes
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dashboard-theme', theme);
      }
    } catch (e) {
      console.warn('Could not save theme to localStorage:', e);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Sort bugs by severity (Critical > Major > Minor > Low Bug)
  const sortBugsBySeverity = (bugsArray) => {
    const severityOrder = {
      'Critical': 1,
      'Major': 2,
      'Minor': 3,
      'Low Bug': 4
    };
    
    return [...bugsArray].sort((a, b) => {
      const aSeverity = a.severity || 'Low Bug';
      const bSeverity = b.severity || 'Low Bug';
      const aOrder = severityOrder[aSeverity] || 99;
      const bOrder = severityOrder[bSeverity] || 99;
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      
      // If same severity, sort by bug_id descending (newer first)
      return (b.bug_id || 0) - (a.bug_id || 0);
    });
  };

  // Classify a person's team - returns 'DEV', 'QA', or 'BIS Team'
  const classifyPerson = (name) => {
    if (!name) return 'Unknown';
    const normalizedName = name.trim().toLowerCase();
    if (employeeTeamMap[normalizedName]) {
      const team = employeeTeamMap[normalizedName];
      if (team === 'DEVELOPMENT') return 'DEV';
      if (team === 'QA') return 'QA';
      return team;
    }
    // Not in employee database = BIS Team (client)
    return 'BIS Team';
  };

  // Segregate team members by their team type
  const segregateTeamMembers = (members) => {
    if (!members || members.length === 0) return { dev: [], qa: [], bis: [] };
    
    const dev = [];
    const qa = [];
    const bis = [];
    
    members.forEach(member => {
      const team = classifyPerson(member);
      if (team === 'DEV') dev.push(member);
      else if (team === 'QA') qa.push(member);
      else bis.push(member);
    });
    
    return { dev, qa, bis };
  };

  // Test backend connection on mount
  useEffect(() => {
    const testConnection = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/`);
        if (res.ok) {
          console.log('Backend connection OK');
        } else {
          console.error('Backend returned error:', res.status);
        }
      } catch (err) {
        console.error('Backend connection failed:', err);
        setError(`Cannot connect to backend at ${BACKEND_URL}. Please ensure the backend server is running.`);
      }
    };
    testConnection();
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape' && maximizedChart) {
        minimizeChart();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [maximizedChart]);

  // Load employees for name click functionality and lead lookup
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/employees`);
        if (res.ok) {
          const data = await res.json();
          // Store all employee data for lead lookup
          setAllEmployees(data);
          
          // Create a map of employee names (lowercase) to their employee_id
          const empMap = {};
          const teamMap = {};
          data.forEach(emp => {
            const nameLower = emp.name.toLowerCase();
            empMap[nameLower] = emp.employee_id;
            teamMap[nameLower] = emp.team; // Store team info
          });
          setEmployeeMap(empMap);
          setEmployeeTeamMap(teamMap);
        }
      } catch (err) {
        console.error('Failed to load employees for name lookup:', err);
      }
    };
    loadEmployees();
  }, []);

  // Derive team leads from ticket team members
  useEffect(() => {
    if (!ticketId || ticketId.trim() === '' || !ticketTracking || allEmployees.length === 0) {
      // Clear team leads when no ticket is selected or no data
      setTeamLeads({ dev_leads: [], qa_leads: [] });
      return;
    }
    
    // Helper function to find employee by name (case-insensitive)
    const findEmployee = (name) => {
      if (!name) return null;
      const normalizedName = name.trim().toLowerCase();
      return allEmployees.find(emp => emp.name.toLowerCase() === normalizedName);
    };
    
    // Helper to find lead info from employee data
    const findLeadInfo = (leadName) => {
      if (!leadName) return null;
      const leadEmployee = findEmployee(leadName);
      if (leadEmployee) {
        return {
          employee_id: leadEmployee.employee_id,
          name: leadEmployee.name,
          email: leadEmployee.email,
          role: leadEmployee.role
        };
      }
      // Lead exists but not in our employee database
      return { name: leadName, employee_id: null, email: null, role: null };
    };
    
    // Collect all unique DEV leads from developers working on this ticket
    const devLeadsMap = new Map(); // Use Map to avoid duplicates by name
    const developers = ticketTracking.developers || [];
    for (const devName of developers) {
      const devEmployee = findEmployee(devName);
      if (devEmployee && devEmployee.team === 'DEVELOPMENT' && devEmployee.lead) {
        const leadInfo = findLeadInfo(devEmployee.lead);
        if (leadInfo && !devLeadsMap.has(leadInfo.name.toLowerCase())) {
          devLeadsMap.set(leadInfo.name.toLowerCase(), leadInfo);
        }
      }
    }
    
    // Collect all unique QA leads from QA testers working on this ticket
    const qaLeadsMap = new Map();
    const qaTesters = ticketTracking.qc_testers || [];
    for (const qaName of qaTesters) {
      const qaEmployee = findEmployee(qaName);
      if (qaEmployee && qaEmployee.team === 'QA' && qaEmployee.lead) {
        const leadInfo = findLeadInfo(qaEmployee.lead);
        if (leadInfo && !qaLeadsMap.has(leadInfo.name.toLowerCase())) {
          qaLeadsMap.set(leadInfo.name.toLowerCase(), leadInfo);
        }
      }
    }
    
    setTeamLeads({ 
      dev_leads: Array.from(devLeadsMap.values()), 
      qa_leads: Array.from(qaLeadsMap.values()) 
    });
  }, [ticketId, ticketTracking, allEmployees]);

  // Sync URL params with ticket ID
  useEffect(() => {
    const urlTicketId = searchParams.get('ticket');
    if (urlTicketId && urlTicketId !== ticketId) {
      setTicketId(urlTicketId);
      setTicketInputValue(urlTicketId);
    }
  }, [searchParams]);

  // Update URL when ticket ID changes (from input)
  const handleTicketIdChange = (newTicketId) => {
    setTicketId(newTicketId);
    if (newTicketId) {
      setSearchParams({ ticket: newTicketId });
    } else {
      // Clear URL params
      setSearchParams({});
      // Clear all related data when ticket ID is cleared
      setBugs([]);
      setDeferredBugs([]);
      setTicketTracking(null);
      setTeamLeads({ dev_leads: [], qa_leads: [] });
      setTestRailSummary({
        total_test_cases: 0,
        total_test_results: 0,
        status_counts: { Passed: 0, Failed: 0, Blocked: 0, Retest: 0, Untested: 0 },
        test_plans_count: 0,
        test_runs_count: 0,
        test_plan_name: null
      });
      setTestRuns([]);
      setTestStatusData(null);
      setError("");
    }
  };

  // Navigate to employee profile if they exist
  const handleNameClick = useCallback((name) => {
    if (!name) return;
    const normalizedName = name.toLowerCase().trim();
    const employeeId = employeeMap[normalizedName];
    if (employeeId) {
      navigate(`/employees/${employeeId}`);
    }
  }, [employeeMap, navigate]);

  // Check if a name is a valid employee (for styling clickable names)
  const isValidEmployee = useCallback((name) => {
    if (!name) return false;
    return !!employeeMap[name.toLowerCase().trim()];
  }, [employeeMap]);

  // Auto-load data when ticket ID or environment changes
  useEffect(() => {
    if (ticketId && ticketId.trim() !== "") {
      const timer = setTimeout(() => {
        loadBugs();
      }, 500); // Debounce for 500ms to avoid too many requests
      
      return () => clearTimeout(timer);
    } else {
      // Clear data when ticket ID is empty
      setBugs([]);
      setDeferredBugs([]);
      setSummary({
        total_bugs: 0,
        open_bugs: 0,
        pending_retest: 0,
        closed_bugs: 0,
        deferred_bugs: 0,
        rejected_bugs: 0,
      });
      setSeverityData(null);
      setPriorityData(null);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, environment]);

  // Auto-calculate derived metrics
  const closurePercentage = summary.total_bugs > 0 
    ? ((summary.closed_bugs / summary.total_bugs) * 100) 
    : 0;

  const criticalBugsCount = bugs.filter(b => b.severity === "Critical").length;
  const criticalPercentage = summary.total_bugs > 0 
    ? ((criticalBugsCount / summary.total_bugs) * 100) 
    : 0;

  // Calculate RAG Status based on bug metrics
  const calculateRAGStatus = () => {
    if (summary.total_bugs === 0) {
      return { status: 'GREEN', label: 'No Issues', color: '#22c55e', score: 100 };
    }

    let score = 100;
    const factors = [];

    // Factor 1: Critical bugs (0-40 points)
    // Red if > 20%, Amber if 10-20%, Green if < 10%
    if (criticalPercentage > 20) {
      score -= 40;
      factors.push('High critical bugs');
    } else if (criticalPercentage > 10) {
      score -= 20;
      factors.push('Moderate critical bugs');
    }

    // Factor 2: Closure rate (0-30 points)
    // Red if < 30%, Amber if 30-60%, Green if > 60%
    if (closurePercentage < 30) {
      score -= 30;
      factors.push('Low closure rate');
    } else if (closurePercentage < 60) {
      score -= 15;
      factors.push('Moderate closure rate');
    }

    // Factor 3: Open bugs ratio (0-30 points)
    // Red if > 70% open, Amber if 40-70%, Green if < 40%
    const openRatio = summary.total_bugs > 0 
      ? ((summary.open_bugs / summary.total_bugs) * 100) 
      : 0;
    if (openRatio > 70) {
      score -= 30;
      factors.push('High open bugs');
    } else if (openRatio > 40) {
      score -= 15;
      factors.push('Moderate open bugs');
    }

    // Determine RAG status
    if (score >= 70) {
      return { 
        status: 'GREEN', 
        label: 'Healthy', 
        color: '#22c55e', 
        score: Math.round(score),
        factors: factors.length > 0 ? factors : ['All metrics good']
      };
    } else if (score >= 40) {
      return { 
        status: 'AMBER', 
        label: 'Needs Attention', 
        color: '#f59e0b', 
        score: Math.round(score),
        factors: factors
      };
    } else {
      return { 
        status: 'RED', 
        label: 'Critical', 
        color: '#ef4444', 
        score: Math.round(score),
        factors: factors
      };
    }
  };

  const ragStatus = calculateRAGStatus();

  const loadBugs = async () => {
    if (!ticketId) {
      setError("Please enter Ticket ID");
      return;
    }

    setLoading(true);
    setError("");
    // Don't clear bugs immediately - keep existing data visible during refresh

    try {
      const baseUrl = `${BACKEND_URL}/bugs`;
      const envParam = `environment=${environment}`;
      const platformParam = `platform=${platform}`;
      const ticketParam = `ticket_id=${parseInt(ticketId)}`;
      
      console.log('Loading ticket data for Ticket ID:', ticketId, 'Environment:', environment, 'Platform:', platform);
      
      const [
        summaryRes, bugsRes, ticketInfoRes, severityRes, priorityRes, metricsRes,
        assigneeRes, authorRes, moduleRes, featureRes, browserOsRes, platformRes,
        ageRes, resolutionRes, reopenedRes, deferredRes, testRailSummaryRes, testCasesRes, testStatusRes, testRunsRes,
        ticketTrackingRes, employeesRes
      ] = await Promise.all([
        fetch(`${baseUrl}/summary?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch summary:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}?${ticketParam}&${envParam}&only_open=true`).catch(err => {
          console.error('Failed to fetch bugs:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/ticket-info?${ticketParam}`).catch(err => {
          console.error('Failed to fetch ticket-info:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/severity-breakdown?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch severity-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/priority-breakdown?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch priority-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/metrics?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch metrics:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/assignee-breakdown?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch assignee-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/author-breakdown?${ticketParam}&${envParam}`).catch(err => {
          console.error('Failed to fetch author-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/module-breakdown?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch module-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/feature-breakdown?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch feature-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/browser-os-breakdown?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch browser-os-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/platform-breakdown?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch platform-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/age-analysis?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch age-analysis:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/resolution-time?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch resolution-time:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/reopened-analysis?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch reopened-analysis:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/deferred-bugs?${ticketParam}&${envParam}&${platformParam}`).catch(err => {
          console.error('Failed to fetch deferred-bugs:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/testrail/summary?${ticketParam}`).catch(err => {
          console.error('Failed to fetch testrail-summary:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/testrail/test-cases?${ticketParam}`).catch(err => {
          console.error('Failed to fetch testrail-test-cases:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/testrail/status-breakdown?${ticketParam}`).catch(err => {
          console.error('Failed to fetch testrail-status-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/testrail/test-runs?${ticketParam}`).catch(err => {
          console.error('Failed to fetch testrail-test-runs:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/ticket-tracking/${parseInt(ticketId)}`).catch(err => {
          console.error('Failed to fetch ticket-tracking:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${BACKEND_URL}/employees`).catch(err => {
          console.error('Failed to fetch employees:', err);
          return { ok: false, status: 500 };
        }),
      ]);

      if (!summaryRes.ok) {
        const errorText = await summaryRes.text().catch(() => 'Unknown error');
        console.error('Summary endpoint failed:', summaryRes.status, errorText);
        throw new Error(`Failed to load summary data: ${summaryRes.status}. Please check if Ticket ID ${ticketId} exists.`);
      }

      if (!bugsRes.ok) {
        console.warn('Bugs endpoint failed:', bugsRes.status);
      }

      const [
        summaryData, bugsData, severityBreakdown, priorityBreakdown, metricsData,
        assigneeBreakdown, authorBreakdown, moduleBreakdown, featureBreakdown,
        browserOsBreakdown, platformBreakdown, ageAnalysis, resolutionTime, reopenedAnalysis, deferredBugsData,
        testRailSummaryData, testCasesData, testStatusBreakdownData, testRunsData, ticketTrackingData, employeesData
      ] = await Promise.all([
        summaryRes.json(),
        bugsRes.ok ? bugsRes.json() : Promise.resolve([]),
        severityRes.ok ? severityRes.json() : Promise.resolve(null),
        priorityRes.ok ? priorityRes.json() : Promise.resolve(null),
        metricsRes.ok ? metricsRes.json() : Promise.resolve(null),
        assigneeRes.ok ? assigneeRes.json() : Promise.resolve(null),
        authorRes.ok ? authorRes.json() : Promise.resolve(null),
        moduleRes.ok ? moduleRes.json() : Promise.resolve(null),
        featureRes.ok ? featureRes.json() : Promise.resolve(null),
        browserOsRes.ok ? browserOsRes.json() : Promise.resolve(null),
        platformRes.ok ? platformRes.json() : Promise.resolve(null),
        ageRes.ok ? ageRes.json() : Promise.resolve(null),
        resolutionRes.ok ? resolutionRes.json() : Promise.resolve(null),
        reopenedRes.ok ? reopenedRes.json() : Promise.resolve(null),
        deferredRes.ok ? deferredRes.json() : Promise.resolve([]),
        testRailSummaryRes.ok ? testRailSummaryRes.json().catch(() => ({
          total_test_cases: 0,
          total_test_results: 0,
          status_counts: { Passed: 0, Failed: 0, Blocked: 0, Retest: 0, Untested: 0 },
          test_plans_count: 0,
          test_runs_count: 0,
          test_plan_name: null
        })) : Promise.resolve({
          total_test_cases: 0,
          total_test_results: 0,
          status_counts: { Passed: 0, Failed: 0, Blocked: 0, Retest: 0, Untested: 0 },
          test_plans_count: 0,
          test_runs_count: 0,
          test_plan_name: null
        }),
        testCasesRes.ok ? testCasesRes.json() : Promise.resolve([]),
        testStatusRes.ok ? testStatusRes.json() : Promise.resolve(null),
        testRunsRes.ok ? testRunsRes.json() : Promise.resolve([]),
        ticketTrackingRes.ok ? ticketTrackingRes.json() : Promise.resolve(null),
        employeesRes.ok ? employeesRes.json() : Promise.resolve([]),
      ]);

      console.log('Summary data loaded:', summaryData);
      console.log('Bugs loaded:', bugsData?.length || 0);
      console.log('TestRail Summary Data:', testRailSummaryData);
      console.log('Test Runs Data:', testRunsData);
      console.log('TestRail Summary:', testRailSummaryData);
      console.log('Test Runs:', testRunsData);

      // Handle ticket info separately to avoid breaking if it fails
      let ticketInfoData = { ticket_title: "", platform: "Web" };
      try {
        if (ticketInfoRes.ok) {
          ticketInfoData = await ticketInfoRes.json();
          console.log('Ticket info loaded:', ticketInfoData);
        }
      } catch (e) {
        console.warn('Failed to load ticket info:', e);
      }

      // Sort bugs by severity before setting
      const sortedBugs = bugsData ? sortBugsBySeverity(bugsData) : [];

      // Update all data at once to prevent flickering
      setSummary(summaryData);
      setBugs(sortedBugs);
      setTicketInfo(ticketInfoData);
      setSeverityData(severityBreakdown);
      setPriorityData(priorityBreakdown);
      setMetrics(metricsData);
      
      // Set new widget data
      setAssigneeData(assigneeBreakdown);
      setAuthorData(authorBreakdown);
      setModuleData(moduleBreakdown);
      setFeatureData(featureBreakdown);
      setBrowserOsData(browserOsBreakdown);
      setPlatformData(platformBreakdown);
      setAgeData(ageAnalysis);
      setResolutionTimeData(resolutionTime);
      setReopenedData(reopenedAnalysis);
      setDeferredBugs(deferredBugsData || []);
      const finalTestRailSummary = testRailSummaryData || {
        total_test_cases: 0,
        total_test_results: 0,
        status_counts: { Passed: 0, Failed: 0, Blocked: 0, Retest: 0, Untested: 0 },
        test_plans_count: 0,
        test_runs_count: 0,
        test_plan_name: null
      };
      console.log('Final TestRail Summary to set:', finalTestRailSummary);
      console.log('Total test cases count:', finalTestRailSummary.total_test_cases);
      setTestRailSummary(finalTestRailSummary);
      setTestCases(testCasesData || []);
      setTestStatusData(testStatusBreakdownData);
      setTestRuns(testRunsData || []);
      
      // Set ticket tracking data
      console.log('Ticket Tracking Data:', ticketTrackingData);
      setTicketTracking(ticketTrackingData);
      
      // Build employee team map for name classification
      if (employeesData && Array.isArray(employeesData)) {
        const teamMap = {};
        employeesData.forEach(emp => {
          if (emp.name) {
            teamMap[emp.name.trim().toLowerCase()] = emp.team || 'UNKNOWN';
          }
        });
        setEmployeeTeamMap(teamMap);
      }

    } catch (err) {
      console.error('Error loading bugs:', err);
      setError(`Unable to load data: ${err.message}. Please check Ticket ID or backend connection at ${BACKEND_URL}`);
    } finally {
      setLoading(false);
    }
  };

  // Professional Bar Chart Data with attractive color scheme
  const getBarChartData = () => {
    if (!severityData) return null;

    // Professional gradient color scheme
    const colorPalette = [
      {
        bg: "rgba(99, 102, 241, 0.9)",      // Indigo
        border: "rgba(79, 70, 229, 1)",
      },
      {
        bg: "rgba(139, 92, 246, 0.9)",      // Purple
        border: "rgba(124, 58, 237, 1)",
      },
      {
        bg: "rgba(236, 72, 153, 0.9)",      // Pink
        border: "rgba(219, 39, 119, 1)",
      },
      {
        bg: "rgba(59, 130, 246, 0.9)",     // Blue
        border: "rgba(37, 99, 235, 1)",
      },
    ];

    const datasets = severityData.severities.map((severity, index) => {
      const colors = colorPalette[index % colorPalette.length];
      return {
        label: severity,
        data: severityData.statuses.map((status) => severityData.data[status][severity]),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      };
    });

    return {
      labels: severityData.statuses,
      datasets,
    };
  };

  // TestRail Status Chart Data
  const getTestStatusChartData = () => {
    if (!testStatusData || !testStatusData.status_distribution) return null;

    const statusColors = {
      "Passed": "rgba(34, 197, 94, 0.95)",
      "Failed": "rgba(239, 68, 68, 0.95)",
      "Blocked": "rgba(245, 158, 11, 0.95)",
      "Retest": "rgba(139, 92, 246, 0.95)",
      "Untested": "rgba(107, 114, 128, 0.95)",
    };

    const statusBorders = {
      "Passed": "rgba(22, 163, 74, 1)",
      "Failed": "rgba(185, 28, 28, 1)",
      "Blocked": "rgba(217, 119, 6, 1)",
      "Retest": "rgba(124, 58, 237, 1)",
      "Untested": "rgba(75, 85, 99, 1)",
    };

    const labels = Object.keys(testStatusData.status_distribution).filter(
      k => testStatusData.status_distribution[k] > 0
    );
    const values = labels.map(k => testStatusData.status_distribution[k]);
    const bgColors = labels.map(k => statusColors[k] || statusColors["Untested"]);
    const borderColors = labels.map(k => statusBorders[k] || statusBorders["Untested"]);

    return {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 3,
        hoverOffset: 15,
        offset: 5,
      }],
    };
  };

  // Test Run Comparison Bar Chart Data
  const getTestRunComparisonData = () => {
    if (!testRuns || testRuns.length === 0) return null;

    // Take up to 5 most recent runs for comparison
    const runsToShow = testRuns.slice(0, 5);
    const labels = runsToShow.map((run, idx) => 
      run.name ? (run.name.length > 20 ? run.name.substring(0, 20) + '...' : run.name) : `Run ${idx + 1}`
    );

    return {
      labels,
      datasets: [
        {
          label: 'Passed',
          data: runsToShow.map(r => r.status_counts?.Passed || 0),
          backgroundColor: 'rgba(34, 197, 94, 0.85)',
          borderColor: 'rgba(22, 163, 74, 1)',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Failed',
          data: runsToShow.map(r => r.status_counts?.Failed || 0),
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderColor: 'rgba(185, 28, 28, 1)',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Blocked',
          data: runsToShow.map(r => r.status_counts?.Blocked || 0),
          backgroundColor: 'rgba(245, 158, 11, 0.85)',
          borderColor: 'rgba(217, 119, 6, 1)',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Untested',
          data: runsToShow.map(r => r.status_counts?.Untested || 0),
          backgroundColor: 'rgba(107, 114, 128, 0.85)',
          borderColor: 'rgba(75, 85, 99, 1)',
          borderWidth: 2,
          borderRadius: 6,
        },
      ],
    };
  };

  // Test Pass Rate Data (for each run)
  const getTestPassRateData = () => {
    if (!testRuns || testRuns.length === 0) return null;

    const runsToShow = testRuns.slice(0, 6);
    const labels = runsToShow.map((run, idx) => 
      run.name ? (run.name.length > 15 ? run.name.substring(0, 15) + '...' : run.name) : `Run ${idx + 1}`
    );

    const passRates = runsToShow.map(run => {
      const total = (run.status_counts?.Passed || 0) + (run.status_counts?.Failed || 0) + 
                    (run.status_counts?.Blocked || 0) + (run.status_counts?.Untested || 0);
      if (total === 0) return 0;
      return ((run.status_counts?.Passed || 0) / total * 100).toFixed(1);
    });

    return {
      labels,
      datasets: [{
        label: 'Pass Rate %',
        data: passRates,
        backgroundColor: passRates.map(rate => 
          rate >= 80 ? 'rgba(34, 197, 94, 0.85)' : 
          rate >= 50 ? 'rgba(245, 158, 11, 0.85)' : 
          'rgba(239, 68, 68, 0.85)'
        ),
        borderColor: passRates.map(rate => 
          rate >= 80 ? 'rgba(22, 163, 74, 1)' : 
          rate >= 50 ? 'rgba(217, 119, 6, 1)' : 
          'rgba(185, 28, 28, 1)'
        ),
        borderWidth: 2,
        borderRadius: 8,
      }],
    };
  };

  // Professional Pie Chart Data with attractive color scheme
  const getPieChartData = () => {
    if (!priorityData) return null;

    // Professional gradient color scheme
    const colorPalette = [
      {
        bg: "rgba(99, 102, 241, 0.95)",      // Indigo
        border: "rgba(79, 70, 229, 1)",
      },
      {
        bg: "rgba(139, 92, 246, 0.95)",     // Purple
        border: "rgba(124, 58, 237, 1)",
      },
      {
        bg: "rgba(236, 72, 153, 0.95)",     // Pink
        border: "rgba(219, 39, 119, 1)",
      },
      {
        bg: "rgba(59, 130, 246, 0.95)",     // Blue
        border: "rgba(37, 99, 235, 1)",
      },
      {
        bg: "rgba(16, 185, 129, 0.95)",    // Teal
        border: "rgba(5, 150, 105, 1)",
      },
    ];

    const labels = Object.keys(priorityData).filter(k => priorityData[k] > 0);
    const values = labels.map(k => priorityData[k]);
    const bgColors = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColors = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 3,
        hoverOffset: 15,
        offset: 5,
      }],
    };
  };

  const getTextColor = () => theme === 'dark' ? '#e5e7eb' : '#0f172a';
  const getMutedColor = () => theme === 'dark' ? '#9ca3af' : '#64748b';
  const getGridColor = () => theme === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(203, 213, 225, 0.4)';
  const getTooltipBg = () => theme === 'dark' ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.98)';
  const getTooltipBorder = () => theme === 'dark' ? '#374151' : '#e2e8f0';

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: { 
          color: getTextColor(), 
          font: { size: 11, weight: '500' },
          padding: 15,
          usePointStyle: true,
          pointStyle: 'rectRounded',
        },
      },
      title: { display: false },
      tooltip: {
        backgroundColor: getTooltipBg(),
        titleColor: getTextColor(),
        bodyColor: getTextColor(),
        borderColor: getTooltipBorder(),
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
      datalabels: {
        anchor: 'end',
        align: 'top',
        color: getTextColor(),
        font: {
          size: 11,
          weight: '600',
        },
        formatter: (value) => value > 0 ? value : '',
        padding: {
          top: 4,
        },
      },
    },
    scales: {
      x: {
        ticks: { 
          color: getMutedColor(), 
          font: { size: 10 },
          maxRotation: 45,
        },
        grid: { 
          color: getGridColor(),
          drawBorder: false,
        },
      },
      y: {
        ticks: { 
          color: getMutedColor(), 
          stepSize: 1,
          font: { size: 11 },
        },
        grid: { 
          color: getGridColor(),
          drawBorder: false,
        },
      },
    },
    animation: {
      duration: 1000,
      easing: 'easeOutQuart',
    },
  };

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: {
        position: "right",
        labels: { 
          color: getTextColor(), 
          font: { size: 12, weight: '500' },
          padding: 20,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: getTooltipBg(),
        titleColor: getTextColor(),
        bodyColor: getTextColor(),
        borderColor: getTooltipBorder(),
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
      datalabels: {
        color: theme === 'dark' ? '#fff' : '#0f172a',
        font: {
          size: 13,
          weight: '700',
        },
        formatter: (value, ctx) => {
          const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
          const percentage = ((value / total) * 100).toFixed(1);
          return value > 0 ? `${percentage}%` : '';
        },
        textStrokeColor: theme === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.8)',
        textStrokeWidth: 2,
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 1000,
    },
  };

  // Helper functions for new widget charts
  const getAssigneeChartData = () => {
    if (!assigneeData) return null;
    const assignees = Object.entries(assigneeData)
      .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
      .slice(0, 15) // Limit to top 15 for better visibility
      .map(([name]) => name);
    const openData = assignees.map(a => assigneeData[a].open || 0);
    const closedData = assignees.map(a => assigneeData[a].closed || 0);
    
    return {
      labels: assignees,
      datasets: [
        {
          label: 'Open',
          data: openData,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderColor: 'rgba(185, 28, 28, 1)',
        },
        {
          label: 'Closed',
          data: closedData,
          backgroundColor: 'rgba(34, 197, 94, 0.85)',
          borderColor: 'rgba(22, 163, 74, 1)',
        }
      ]
    };
  };

  const getAuthorChartData = () => {
    if (!authorData) return null;
    const authors = Object.keys(authorData).sort((a, b) => authorData[b].total - authorData[a].total).slice(0, 10);
    const totals = authors.map(a => authorData[a].total);
    
    return {
      labels: authors,
      datasets: [{
        label: 'Bugs Reported',
        data: totals,
        backgroundColor: 'rgba(34, 197, 94, 0.85)',
        borderColor: 'rgba(22, 163, 74, 1)',
        borderWidth: 2,
        borderRadius: 6,
      }]
    };
  };

  const getModuleChartData = () => {
    if (!moduleData) return null;
    const modules = Object.entries(moduleData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const labels = modules.map(m => m[0]);
    const values = modules.map(m => m[1]);
    const colors = [
      "rgba(34, 197, 94, 0.9)", "rgba(22, 163, 74, 0.9)", "rgba(16, 185, 129, 0.9)",
      "rgba(5, 150, 105, 0.9)", "rgba(34, 197, 94, 0.7)", "rgba(22, 163, 74, 0.7)",
      "rgba(16, 185, 129, 0.7)", "rgba(5, 150, 105, 0.7)", "rgba(34, 197, 94, 0.5)", "rgba(22, 163, 74, 0.5)"
    ];
    
    return {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: 'rgba(22, 163, 74, 1)',
        borderWidth: 2,
      }]
    };
  };

  const getFeatureChartData = () => {
    if (!featureData) return null;
    const features = Object.entries(featureData)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15); // Limit to top 15 for better visibility
    const labels = features.map(f => f[0]);
    const openData = features.map(f => f[1].open || 0);
    const closedData = features.map(f => f[1].closed || 0);
    
    return {
      labels,
      datasets: [
        {
          label: 'Open',
          data: openData,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderColor: 'rgba(185, 28, 28, 1)',
        },
        {
          label: 'Closed',
          data: closedData,
          backgroundColor: 'rgba(34, 197, 94, 0.85)',
          borderColor: 'rgba(22, 163, 74, 1)',
        }
      ]
    };
  };

  const getBrowserOsChartData = () => {
    if (!browserOsData) return null;
    const combinations = Object.entries(browserOsData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15); // Limit to top 15 for better visibility
    const labels = combinations.map(c => c[0]);
    const values = combinations.map(c => c[1]);
    
    return {
      labels,
      datasets: [{
        label: 'Bug Count',
        data: values,
        backgroundColor: 'rgba(34, 197, 94, 0.85)',
        borderColor: 'rgba(22, 163, 74, 1)',
        borderWidth: 2,
        borderRadius: 6,
      }]
    };
  };

  const getPlatformChartData = () => {
    if (!platformData) return null;
    const platforms = Object.keys(platformData);
    const openData = platforms.map(p => platformData[p].open || 0);
    const closedData = platforms.map(p => platformData[p].closed || 0);
    
    return {
      labels: platforms,
      datasets: [
        {
          label: 'Open',
          data: openData,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderColor: 'rgba(185, 28, 28, 1)',
        },
        {
          label: 'Closed',
          data: closedData,
          backgroundColor: 'rgba(34, 197, 94, 0.85)',
          borderColor: 'rgba(22, 163, 74, 1)',
        }
      ]
    };
  };

  const getAgeDistributionData = () => {
    if (!ageData) return null;
    return {
      labels: ['0-7 days', '7-30 days', '30-60 days', '60+ days'],
      datasets: [{
        label: 'Open Bugs',
        data: [
          ageData.age_buckets?.["0-7"] || 0,
          ageData.age_buckets?.["7-30"] || 0,
          ageData.age_buckets?.["30-60"] || 0,
          ageData.age_buckets?.["60+"] || 0,
        ],
        backgroundColor: [
          'rgba(34, 197, 94, 0.85)',
          'rgba(245, 158, 11, 0.85)',
          'rgba(239, 68, 68, 0.85)',
          'rgba(139, 92, 246, 0.85)',
        ],
        borderColor: 'rgba(22, 163, 74, 1)',
        borderWidth: 2,
        borderRadius: 6,
      }]
    };
  };

  const getResolutionTimeDistributionData = () => {
    if (!resolutionTimeData) return null;
    return {
      labels: ['<1 day', '1-3 days', '3-7 days', '7-30 days', '30+ days'],
      datasets: [{
        label: 'Resolved Bugs',
        data: [
          resolutionTimeData.time_buckets?.["<1"] || 0,
          resolutionTimeData.time_buckets?.["1-3"] || 0,
          resolutionTimeData.time_buckets?.["3-7"] || 0,
          resolutionTimeData.time_buckets?.["7-30"] || 0,
          resolutionTimeData.time_buckets?.["30+"] || 0,
        ],
        backgroundColor: 'rgba(34, 197, 94, 0.85)',
        borderColor: 'rgba(22, 163, 74, 1)',
        borderWidth: 2,
        borderRadius: 6,
      }]
    };
  };

  // Horizontal bar chart options
  const horizontalBarOptions = {
    ...barChartOptions,
    indexAxis: 'y',
    scales: {
      x: {
        ticks: { 
          color: getMutedColor(), 
          stepSize: 1,
          font: { size: 11 },
        },
        grid: { 
          color: getGridColor(),
          drawBorder: false,
        },
      },
      y: {
        ticks: { 
          color: getMutedColor(), 
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: false,
        },
        grid: { 
          color: getGridColor(),
          drawBorder: false,
        },
        afterFit: (scale) => {
          // Dynamically adjust font size based on number of labels
          const labelCount = scale.ticks.length;
          if (labelCount > 10) {
            scale.options.ticks.font.size = 9;
          }
        },
      },
    },
    plugins: {
      ...barChartOptions.plugins,
      datalabels: {
        ...barChartOptions.plugins.datalabels,
        display: (context) => {
          // Only show labels if there's enough space (less than 15 items)
          return context.dataset.data.length <= 15;
        },
      },
    },
  };

  // Enhanced chart options for modal (larger sizes)
  const modalBarChartOptions = {
    ...barChartOptions,
    maintainAspectRatio: true,
    plugins: {
      ...barChartOptions.plugins,
      legend: {
        ...barChartOptions.plugins.legend,
        labels: {
          ...barChartOptions.plugins.legend.labels,
          font: { size: 14, weight: '500' },
          padding: 20,
        },
      },
      datalabels: {
        ...barChartOptions.plugins.datalabels,
        font: { size: 14, weight: '600' },
      },
    },
    scales: {
      ...barChartOptions.scales,
      x: {
        ...barChartOptions.scales.x,
        ticks: {
          ...barChartOptions.scales.x.ticks,
          font: { size: 13 },
        },
      },
      y: {
        ...barChartOptions.scales.y,
        ticks: {
          ...barChartOptions.scales.y.ticks,
          font: { size: 13 },
        },
      },
    },
  };

  const modalPieChartOptions = {
    ...pieChartOptions,
    maintainAspectRatio: true,
    plugins: {
      ...pieChartOptions.plugins,
      legend: {
        ...pieChartOptions.plugins.legend,
        labels: {
          ...pieChartOptions.plugins.legend.labels,
          font: { size: 14, weight: '500' },
          padding: 25,
        },
      },
      datalabels: {
        ...pieChartOptions.plugins.datalabels,
        font: { size: 16, weight: '700' },
      },
    },
  };

  const modalHorizontalBarOptions = {
    ...horizontalBarOptions,
    maintainAspectRatio: true,
    plugins: {
      ...horizontalBarOptions.plugins,
      legend: {
        ...horizontalBarOptions.plugins.legend,
        labels: {
          ...horizontalBarOptions.plugins.legend.labels,
          font: { size: 14, weight: '500' },
          padding: 20,
        },
      },
      datalabels: {
        ...horizontalBarOptions.plugins.datalabels,
        font: { size: 14, weight: '600' },
        display: true, // Always show in modal
      },
    },
    scales: {
      ...horizontalBarOptions.scales,
      x: {
        ...horizontalBarOptions.scales.x,
        ticks: {
          ...horizontalBarOptions.scales.x.ticks,
          font: { size: 13 },
        },
      },
      y: {
        ...horizontalBarOptions.scales.y,
        ticks: {
          ...horizontalBarOptions.scales.y.ticks,
          font: { size: 13 },
        },
      },
    },
  };

  // Helper function to get chart data and component for maximized view
  const getMaximizedChart = () => {
    if (!maximizedChart) return null;

    const chartConfigs = {
      'severity': {
        title: 'Bug Status by Severity',
        data: getBarChartData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'priority': {
        title: 'Priority Distribution',
        data: getPieChartData(),
        options: modalPieChartOptions,
        type: 'doughnut'
      },
      'assignee': {
        title: 'Assignee Distribution',
        data: getAssigneeChartData(),
        options: modalHorizontalBarOptions,
        type: 'bar'
      },
      'author': {
        title: 'Author Activity',
        data: getAuthorChartData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'module': {
        title: 'Module Breakdown',
        data: getModuleChartData(),
        options: modalPieChartOptions,
        type: 'doughnut'
      },
      'feature': {
        title: 'Feature Breakdown',
        data: getFeatureChartData(),
        options: modalHorizontalBarOptions,
        type: 'bar'
      },
      'browser-os': {
        title: 'Browser/OS Matrix',
        data: getBrowserOsChartData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'platform': {
        title: 'Platform Comparison',
        data: getPlatformChartData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'age-dist': {
        title: 'Age Distribution',
        data: getAgeDistributionData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'resolution-time-dist': {
        title: 'Resolution Time Distribution',
        data: getResolutionTimeDistributionData(),
        options: modalBarChartOptions,
        type: 'bar'
      },
      'top-issues': {
        title: 'Top Issues',
        data: null,
        options: null,
        type: 'list'
      },
      'test-status': {
        title: 'Test Status Distribution',
        data: getTestStatusChartData(),
        options: modalPieChartOptions,
        type: 'doughnut'
      },
      'test-run-comparison': {
        title: 'Test Run Comparison',
        data: getTestRunComparisonData(),
        options: {
          ...modalBarChartOptions,
          plugins: {
            ...modalBarChartOptions.plugins,
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: 'var(--text-primary)',
                usePointStyle: true,
                padding: 20,
                font: { family: "'Inter', sans-serif", size: 13 }
              }
            }
          }
        },
        type: 'bar'
      },
      'pass-rate': {
        title: 'Pass Rate by Test Run',
        data: getTestPassRateData(),
        options: {
          ...modalBarChartOptions,
          plugins: {
            ...modalBarChartOptions.plugins,
            legend: { display: false }
          },
          scales: {
            ...modalBarChartOptions.scales,
            y: {
              ...modalBarChartOptions.scales?.y,
              max: 100,
              ticks: {
                color: 'var(--text-secondary)',
                font: { family: "'Inter', sans-serif", size: 12 },
                callback: (val) => val + '%'
              }
            }
          }
        },
        type: 'bar'
      }
    };

    return chartConfigs[maximizedChart] || null;
  };

  const maximizedChartConfig = getMaximizedChart();

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">QA</div>
          <span className="logo-text">Bug Tracker</span>
        </div>
        <div className="theme-toggle-container">
          <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
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
            Ticket Dashboard
          </Link>
          <Link to="/all-bugs" className={`nav-item ${location.pathname === '/all-bugs' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4l2 2"/>
            </svg>
            All Bugs Dashboard
          </Link>
          <Link to="/tickets" className={`nav-item ${location.pathname === '/tickets' ? 'active' : ''}`}>
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
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Calendar
          </Link>
          <Link to="/planning" className={`nav-item ${location.pathname === '/planning' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="M9 12h6"/>
              <path d="M9 16h6"/>
            </svg>
            Task Planning
          </Link>
          <Link to="/comparison" className={`nav-item ${location.pathname === '/comparison' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 20V10"/>
              <path d="M12 20V4"/>
              <path d="M6 20v-6"/>
            </svg>
            Plan vs Actual
          </Link>
          <Link to="/reports" className={`nav-item ${location.pathname === '/reports' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Reports
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Subtle Loading Indicator */}
        {loading && (
          <div className="loading-indicator">
            <div className="loading-spinner-small"></div>
            <span>Updating data...</span>
          </div>
        )}

        {/* Top Header with Bugs Count */}
        <header className="top-header">
          <div className="header-left">
            <img 
              src="/techversant-logo.png" 
              alt="Techversant Infotech" 
              className="company-logo"
            />
            <div className="header-divider"></div>
            <h1 className="page-title">QA Dashboard</h1>
            {summary.total_bugs > 0 && (
              <div className="bugs-count-header">
                <span className="bugs-count-value">{summary.total_bugs}</span>
                <span className="bugs-count-label">Total Bugs</span>
              </div>
            )}
          </div>
        </header>

        {/* Filter Section - Compact */}
        <div className="filter-section compact">
          <div className="filter-controls">
            <div className="filter-group">
              <label className="filter-label">Ticket ID</label>
              <div className="ticket-input-wrapper ticket-autocomplete" ref={ticketInputRef}>
                <input
                  type="text"
                  placeholder="Search or enter Ticket ID"
                  value={ticketInputValue || ticketId}
                  onChange={(e) => handleTicketInputChange(e.target.value)}
                  onFocus={() => {
                    if (ticketInputValue || ticketId) {
                      fetchTicketSuggestions(ticketInputValue || ticketId);
                      setShowSuggestions(true);
                    }
                    // Update dropdown position
                    if (ticketInputRef.current) {
                      const rect = ticketInputRef.current.getBoundingClientRect();
                      setDropdownPosition({
                        top: rect.bottom + window.scrollY + 4,
                        left: rect.left + window.scrollX,
                        width: rect.width
                      });
                    }
                  }}
                  onBlur={() => {
                    // Delay hiding to allow click on suggestion
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (ticketInputValue || ticketId)) {
                      handleTicketIdChange(ticketInputValue || ticketId);
                      setShowSuggestions(false);
                    }
                    if (e.key === 'Escape') {
                      setShowSuggestions(false);
                    }
                  }}
                  className="ticket-input"
                />
                {(ticketId || ticketInputValue) && (
                  <button
                    className="clear-btn"
                    onClick={() => {
                      handleTicketIdChange("");
                      setTicketInputValue("");
                      setShowSuggestions(false);
                    }}
                    title="Clear Ticket ID"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                )}
                {showSuggestions && ticketSuggestions.length > 0 && createPortal(
                  <div 
                    className="ticket-suggestions-dropdown"
                    style={{
                      position: 'fixed',
                      top: dropdownPosition.top,
                      left: dropdownPosition.left,
                      width: dropdownPosition.width,
                    }}
                  >
                    {ticketSuggestions.map((ticket) => (
                      <div
                        key={ticket.ticket_id}
                        className="ticket-suggestion-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleTicketSelect(ticket);
                        }}
                      >
                        <span className="suggestion-id">#{ticket.ticket_id}</span>
                        <span className="suggestion-title">{ticket.title}</span>
                        {ticket.status && (
                          <span className="suggestion-status">{ticket.status}</span>
                        )}
                      </div>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            </div>
            <div className="filter-group">
              <label className="filter-label">Environment</label>
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
                className="env-select"
        >
          <option>All</option>
          <option>Staging</option>
          <option>Pre-production</option>
          <option>Production</option>
          <option>BIS Testing (Pre)</option>
        </select>
            </div>
            <button 
              className="refresh-btn" 
              onClick={() => {
                handleTicketIdChange("");
                setEnvironment("All");
                setPlatform("All");
              }}
              disabled={loading}
              title="Clear data"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
              Clear
        </button>
          </div>
      </div>

        {/* Error Message */}
        {error && (
          <div className="error-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M15 9l-6 6M9 9l6 6"/>
            </svg>
            {error}
          </div>
        )}

        {/* Ticket Info Banner */}
        {ticketId && (
          <div className="ticket-banner">
            <div className="ticket-info">
              <div className="ticket-id-group">
                <span className="ticket-label">Ticket</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span className="ticket-id">#{ticketId}</span>
                  <TicketExternalLink ticketId={ticketId} />
                  {testRailSummary && testRailSummary.test_plan_name && (
                    <span className="ticket-plan-name">
                      {testRailSummary.test_plan_name}
                    </span>
                  )}
                  {testRailSummary && testRailSummary.total_test_cases > 0 && (
                    <span className="ticket-test-cases-count">
                      {testRailSummary.total_test_cases} Test Cases
                    </span>
                  )}
        </div>
              </div>
            </div>
            <div className="ticket-meta">
              <span className="meta-badge">{environment}</span>
              <span className="meta-badge platform">{ticketInfo.platform || "Web"}</span>
            </div>
          </div>
        )}

        {/* Ticket Tracking Section - Management View (Top Priority) */}
        {ticketTracking && (() => {
          // Calculate ETA status
          const isTicketClosed = ticketTracking.status?.toLowerCase().includes('closed') || 
                                 ticketTracking.status?.toLowerCase().includes('moved to live') ||
                                 ticketTracking.status?.toLowerCase().includes('completed');
          const hasEta = ticketTracking.eta && ticketTracking.eta !== null;
          const etaDate = hasEta ? new Date(ticketTracking.eta) : null;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const etaPassed = etaDate && etaDate < today;
          const daysUntilEta = etaDate ? Math.ceil((etaDate - today) / (1000 * 60 * 60 * 24)) : null;
          const daysPastEta = etaDate && etaPassed ? Math.abs(daysUntilEta) : 0;
          
          // Calculate QA vs Actual Dev comparison
          const actualDevHours = ticketTracking.actual_dev_hours || 0;
          const actualQaHours = ticketTracking.actual_qa_hours || 0;
          let qaVsDevDiff = null;
          let qaVsDevLabel = '';
          if (actualDevHours > 0 && actualQaHours > 0) {
            const diffPercent = ((actualQaHours - actualDevHours) / actualDevHours) * 100;
            qaVsDevDiff = diffPercent;
            if (diffPercent > 0) {
              qaVsDevLabel = `${Math.abs(diffPercent).toFixed(0)}% higher than Dev`;
            } else if (diffPercent < 0) {
              qaVsDevLabel = `${Math.abs(diffPercent).toFixed(0)}% lower than Dev`;
            } else {
              qaVsDevLabel = 'Equal to Dev time';
            }
          }

          // Calculate Overall Ticket Health Score (0-100)
          let healthScore = 100;
          let healthStatus = 'Excellent';
          let healthColor = 'green';
          let healthIssues = [];

          // Factor 1: ETA Status (30 points)
          if (isTicketClosed) {
            healthScore += 0; // Already closed, no penalty
            healthIssues.push('✅ Ticket closed');
          } else if (!hasEta) {
            healthScore -= 20; // Missing ETA is concerning
            healthIssues.push('⚠️ ETA not provided');
          } else if (etaPassed) {
            const penalty = Math.min(daysPastEta * 2, 30); // Max 30 point penalty
            healthScore -= penalty;
            healthIssues.push(`🚨 ${daysPastEta} day${daysPastEta !== 1 ? 's' : ''} past ETA`);
          } else if (daysUntilEta <= 3) {
            healthScore -= 10; // Urgent deadline approaching
            healthIssues.push(`⏰ ${daysUntilEta} day${daysUntilEta !== 1 ? 's' : ''} to ETA`);
          } else {
            healthIssues.push(`📅 ${daysUntilEta} day${daysUntilEta !== 1 ? 's' : ''} to ETA`);
          }

          // Factor 2: Dev Time Variance (25 points)
          const devEstimate = ticketTracking.dev_estimate_hours || 0;
          if (devEstimate > 0 && actualDevHours > 0) {
            const devVariance = ticketTracking.dev_deviation || 0;
            if (devVariance > 0) {
              const overrunPercent = (devVariance / devEstimate) * 100;
              const penalty = Math.min(overrunPercent * 0.25, 25); // Max 25 point penalty
              healthScore -= penalty;
              healthIssues.push(`🔴 Dev ${devVariance.toFixed(1)}h over budget (${overrunPercent.toFixed(0)}% overrun)`);
            } else if (devVariance < 0) {
              healthScore += 5; // Bonus for being under budget
              healthIssues.push(`🟢 Dev ${Math.abs(devVariance).toFixed(1)}h under budget`);
            }
          }

          // Factor 3: QA Time Variance (25 points)
          const qaEstimate = ticketTracking.qa_estimate_hours || 0;
          if (qaEstimate > 0 && actualQaHours > 0) {
            const qaVariance = ticketTracking.qa_deviation || 0;
            if (qaVariance > 0) {
              const overrunPercent = (qaVariance / qaEstimate) * 100;
              const penalty = Math.min(overrunPercent * 0.25, 25); // Max 25 point penalty
              healthScore -= penalty;
              healthIssues.push(`🔴 QA ${qaVariance.toFixed(1)}h over budget (${overrunPercent.toFixed(0)}% overrun)`);
            } else if (qaVariance < 0) {
              healthScore += 5; // Bonus for being under budget
              healthIssues.push(`🟢 QA ${Math.abs(qaVariance).toFixed(1)}h under budget`);
            }
          }

          // Factor 4: QA vs Dev Efficiency (20 points)
          if (actualDevHours > 0 && actualQaHours > 0) {
            const qaRatio = (actualQaHours / actualDevHours) * 100;
            // Ideal QA ratio is 30-50% of dev time
            if (qaRatio > 80) {
              healthScore -= 15; // QA taking too long relative to dev
              healthIssues.push(`⚠️ QA time is ${qaRatio.toFixed(0)}% of Dev (high)`);
            } else if (qaRatio < 20) {
              healthScore -= 10; // QA might be rushed
              healthIssues.push(`⚠️ QA time is ${qaRatio.toFixed(0)}% of Dev (low)`);
            } else {
              healthScore += 5; // Good balance
              healthIssues.push(`✅ QA time is ${qaRatio.toFixed(0)}% of Dev (optimal)`);
            }
          }

          // Clamp health score between 0 and 100
          healthScore = Math.max(0, Math.min(100, healthScore));

          // Determine health status and color
          if (healthScore >= 85) {
            healthStatus = 'Excellent';
            healthColor = 'green';
          } else if (healthScore >= 70) {
            healthStatus = 'Good';
            healthColor = 'blue';
          } else if (healthScore >= 55) {
            healthStatus = 'Fair';
            healthColor = 'amber';
          } else if (healthScore >= 40) {
            healthStatus = 'Poor';
            healthColor = 'orange';
          } else {
            healthStatus = 'Critical';
            healthColor = 'red';
          }

          // Get responsible team for current status
          const currentStatus = ticketTracking.status || 'N/A';
          const responsibleTeam = STATUS_TEAM_MAPPING[currentStatus] || 'Unknown';

          return (
          <div className="management-tracking-panel">
            <div className="tracking-header">
              <div className="tracking-title-row">
                <h2 className="tracking-main-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18"/>
                    <path d="M9 21V9"/>
                  </svg>
                  Project Tracking
                </h2>
                <button 
                  className="export-pdf-btn"
                  onClick={async () => {
                    try {
                      const response = await fetch(`${BACKEND_URL}/reports/ticket/${ticketId}`);
                      if (!response.ok) throw new Error('Failed to generate report');
                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `Ticket_Report_${ticketId}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      a.remove();
                    } catch (err) {
                      console.error('Failed to export PDF:', err);
                      alert('Failed to generate PDF report');
                    }
                  }}
                  title="Export ticket data as PDF"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  Export PDF
                </button>
              </div>
              <div className="tracking-status-row">
                <div className="tracking-status-badge-large">
                  {/* Ticket Status - Prominent on Left */}
                  <div className="ticket-status-highlight">
                    <div className="status-label-text">Status</div>
                    <div className={`status-pill-large ${ticketTracking.status?.toLowerCase().replace(/\s+/g, '-') || 'unknown'}`}>
                      {ticketTracking.status || 'N/A'}
                    </div>
                    <div className="responsible-team-badge">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                      </svg>
                      <span className="team-label">Responsible:</span>
                      <span className={`team-name team-${responsibleTeam.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-')}`}>
                        {responsibleTeam}
                      </span>
                    </div>
        </div>

                  {/* RAG Status Badge */}
                  <div className={`rag-status-badge rag-${healthColor}`}>
                    <div className="rag-score">{Math.round(healthScore)}</div>
                    <div className="rag-label">{healthStatus}</div>
                  </div>

                  {/* ETA Display Logic */}
                  {!hasEta ? (
                    <span className="eta-badge eta-missing blink-warning">
                      ⚠️ ETA Not Provided
                    </span>
                  ) : isTicketClosed ? (
                    <span className="eta-badge eta-completed">
                      ETA: {formatDisplayDate(etaDate)}
                    </span>
                  ) : etaPassed ? (
                    <span className="eta-badge eta-overdue blink-danger">
                      🚨 {daysPastEta} day{daysPastEta !== 1 ? 's' : ''} past ETA ({formatDisplayDate(etaDate)})
                    </span>
                  ) : (
                    <span className={`eta-badge ${daysUntilEta <= 3 ? 'eta-urgent' : 'eta-normal'}`}>
                      {daysUntilEta === 0 ? '⏰ ETA Today!' : `📅 ${daysUntilEta} day${daysUntilEta !== 1 ? 's' : ''} to ETA`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="tracking-content">
              {/* Time Metrics Row */}
              <div className="time-metrics-row">
                {/* Development Time */}
                <div className="time-block dev-block">
                  <div className="time-block-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 18l2-2v-8a2 2 0 00-2-2H8a2 2 0 00-2 2v8l2 2"/>
                      <path d="M12 6V2M8 22h8M12 18v4"/>
                    </svg>
                    <span>Development Time</span>
                  </div>
                  <div className="time-values">
                    <div className="time-item">
                      <span className="time-label">Time Planned</span>
                      {(!ticketTracking.dev_estimate_hours || ticketTracking.dev_estimate_hours === 0) && !isTicketClosed ? (
                        <span className="time-number estimate-missing blink-warning">Not Provided</span>
                      ) : (
                        <span className="time-number">{ticketTracking.dev_estimate_hours || 0}h</span>
                      )}
                    </div>
                    <div className="time-item">
                      <span className="time-label">Time Spent</span>
                      <span className="time-number">{ticketTracking.actual_dev_hours || 0}h</span>
                    </div>
                    <div className="time-item deviation">
                      <span className="time-label">Variance</span>
                      {(() => {
                        const devEstimate = ticketTracking.dev_estimate_hours || 0;
                        const devActual = ticketTracking.actual_dev_hours || 0;
                        // If no estimate, variance = actual hours (treating estimate as 0)
                        const variance = devActual - devEstimate;
                        const hasNoEstimate = devEstimate === 0 && devActual > 0;
                        
                        if (devActual === 0 && devEstimate === 0) {
                          return <span className="deviation-value neutral">-</span>;
                        }
                        
                        return (
                          <span className={`deviation-value ${variance > 0 ? 'negative blink-danger' : variance < 0 ? 'positive' : 'neutral'} ${hasNoEstimate ? 'no-estimate' : ''}`}>
                            {variance > 0 ? '+' : ''}{variance}h
                            {hasNoEstimate && <span className="variance-note"> (no est.)</span>}
                          </span>
                        );
                      })()}
                    </div>
        </div>
      </div>

                {/* QA Time */}
                <div className="time-block qa-block">
                  <div className="time-block-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4"/>
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                    </svg>
                    <span>QA Testing Time</span>
                  </div>
                  <div className="time-values">
                    <div className="time-item">
                      <span className="time-label">Time Planned</span>
                      {(!ticketTracking.qa_estimate_hours || ticketTracking.qa_estimate_hours === 0) && !isTicketClosed ? (
                        <span className="time-number estimate-missing blink-warning">Not Provided</span>
                      ) : (
                        <span className="time-number">{ticketTracking.qa_estimate_hours || 0}h</span>
                      )}
                    </div>
                    <div className="time-item">
                      <span className="time-label">Time Spent</span>
                      <span className="time-number">{ticketTracking.actual_qa_hours || 0}h</span>
                    </div>
                    <div className="time-item deviation">
                      <span className="time-label">Variance</span>
                      {(() => {
                        const qaEstimate = ticketTracking.qa_estimate_hours || 0;
                        const qaActual = ticketTracking.actual_qa_hours || 0;
                        // If no estimate, variance = actual hours (treating estimate as 0)
                        const variance = qaActual - qaEstimate;
                        const hasNoEstimate = qaEstimate === 0 && qaActual > 0;
                        
                        if (qaActual === 0 && qaEstimate === 0) {
                          return <span className="deviation-value neutral">-</span>;
                        }
                        
                        return (
                          <span className={`deviation-value ${variance > 0 ? 'negative blink-danger' : variance < 0 ? 'positive' : 'neutral'} ${hasNoEstimate ? 'no-estimate' : ''}`}>
                            {variance > 0 ? '+' : ''}{variance}h
                            {hasNoEstimate && <span className="variance-note"> (no est.)</span>}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* QA vs Dev Comparison */}
                <div className="time-block comparison-block">
                  <div className="time-block-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    <span>QA vs Dev Comparison</span>
                  </div>
                  <div className="comparison-value">
                    {actualQaHours > 0 && actualDevHours > 0 ? (
                      <>
                        <span className={`ratio-number ${qaVsDevDiff > 0 ? 'higher' : qaVsDevDiff < 0 ? 'lower' : ''}`}>
                          {qaVsDevDiff > 0 ? '↑' : qaVsDevDiff < 0 ? '↓' : '='} {Math.abs(qaVsDevDiff).toFixed(0)}%
                        </span>
                        <span className="ratio-label">{qaVsDevLabel}</span>
                        <span className="ratio-detail">QA: {actualQaHours}h vs Dev: {actualDevHours}h</span>
                      </>
                    ) : (
                      <span className="ratio-label">Insufficient data</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Team Leads Section */}
              {ticketId && ticketTracking && (teamLeads.dev_leads?.length > 0 || teamLeads.qa_leads?.length > 0) && (
                <div className="team-leads-section">
                  {teamLeads.dev_leads?.length > 0 && (
                    <div className="team-lead-card dev-lead">
                      <span className="lead-label">DEV Lead{teamLeads.dev_leads.length > 1 ? 's' : ''}</span>
                      <div className="lead-names">
                        {teamLeads.dev_leads.map((lead, idx) => (
                          <span 
                            key={idx}
                            className="lead-name clickable-name"
                            onClick={() => handleNameClick(lead.name)}
                            style={{ cursor: isValidEmployee(lead.name) ? 'pointer' : 'default' }}
                          >
                            {lead.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {teamLeads.qa_leads?.length > 0 && (
                    <div className="team-lead-card qa-lead">
                      <span className="lead-label">QA Lead{teamLeads.qa_leads.length > 1 ? 's' : ''}</span>
                      <div className="lead-names">
                        {teamLeads.qa_leads.map((lead, idx) => (
                          <span 
                            key={idx}
                            className="lead-name clickable-name"
                            onClick={() => handleNameClick(lead.name)}
                            style={{ cursor: isValidEmployee(lead.name) ? 'pointer' : 'default' }}
                          >
                            {lead.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Team Section */}
              <div className="team-section">
                {/* Developers - Only show internal DEV team members */}
                {(() => {
                  const devSegregated = segregateTeamMembers(ticketTracking.developers || []);
                  const hasDevs = devSegregated.dev.length > 0;
                  
                  return (
                    <div className="team-group">
                      <div className="team-group-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                        </svg>
                        <span>DEV Team</span>
                      </div>
                      <div className="team-members">
                        {hasDevs ? (
                          devSegregated.dev.map((dev, idx) => (
                            <span 
                              key={idx} 
                              className={`member-chip developer ${isValidEmployee(dev) ? 'clickable' : ''}`}
                              onClick={() => handleNameClick(dev)}
                              style={isValidEmployee(dev) ? { cursor: 'pointer' } : {}}
                            >{dev}</span>
                          ))
                        ) : (
                          <span className="no-members">No DEV team members</span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* QA Team - Only show internal QA team members */}
                {(() => {
                  const qaSegregated = segregateTeamMembers(ticketTracking.qc_testers || []);
                  const hasQa = qaSegregated.qa.length > 0;
                  
                  return (
                    <div className="team-group">
                      <div className="team-group-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 11l3 3L22 4"/>
                          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                        </svg>
                        <span>QA Team</span>
                      </div>
                      <div className="team-members">
                        {hasQa ? (
                          qaSegregated.qa.map((tester, idx) => (
                            <span 
                              key={idx} 
                              className={`member-chip qa ${isValidEmployee(tester) ? 'clickable' : ''}`}
                              onClick={() => handleNameClick(tester)}
                              style={isValidEmployee(tester) ? { cursor: 'pointer' } : {}}
                            >{tester}</span>
                          ))
                        ) : (
                          <span className="no-members">No QA team members</span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* BIS Team (Client) - Show all BIS members with real names after QA */}
                {(() => {
                  const devSegregated = segregateTeamMembers(ticketTracking.developers || []);
                  const qaSegregated = segregateTeamMembers(ticketTracking.qc_testers || []);
                  // Combine all BIS members from both dev and QA lists
                  const allBisMembers = [...new Set([...devSegregated.bis, ...qaSegregated.bis])];
                  
                  return allBisMembers.length > 0 && (
                    <div className="team-group">
                      <div className="team-group-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                          <path d="M2 17l10 5 10-5"/>
                          <path d="M2 12l10 5 10-5"/>
                        </svg>
                        <span>BIS Team (Client)</span>
                      </div>
                      <div className="team-members">
                        {allBisMembers.map((member, idx) => (
                          <span 
                            key={idx} 
                            className={`member-chip bis-team ${isValidEmployee(member) ? 'clickable' : ''}`}
                            onClick={() => handleNameClick(member)}
                            style={isValidEmployee(member) ? { cursor: 'pointer' } : {}}
                          >{member}</span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {ticketTracking.current_assignee && (
                  <div className="team-group">
                    <div className="team-group-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="7" r="4"/>
                        <path d="M5.5 21v-2a6.5 6.5 0 0113 0v2"/>
                      </svg>
                      <span>Currently Assigned To</span>
                    </div>
                    <div className="team-members">
                      <span 
                        className={`member-chip ${classifyPerson(ticketTracking.current_assignee) === 'DEV' ? 'developer' : classifyPerson(ticketTracking.current_assignee) === 'QA' ? 'qa' : 'bis-team'} ${isValidEmployee(ticketTracking.current_assignee) ? 'clickable' : ''}`}
                        onClick={() => handleNameClick(ticketTracking.current_assignee)}
                        style={isValidEmployee(ticketTracking.current_assignee) ? { cursor: 'pointer' } : {}}
                      >
                        {ticketTracking.current_assignee}
                        {classifyPerson(ticketTracking.current_assignee) === 'BIS Team' && ' (BIS)'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Last Updated */}
              {ticketTracking.updated_on && (
                <div className="tracking-footer">
                  Last synced: {formatDisplayDateTime(ticketTracking.updated_on)}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card gradient-blue">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.total_bugs}</span>
              <span className="stat-label">Total Bugs</span>
            </div>
            <div className="stat-trend">All Issues</div>
          </div>

          <div className="stat-card gradient-red">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <path d="M12 9v4M12 17h.01"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.open_bugs}</span>
              <span className="stat-label">Open Bugs</span>
            </div>
            <div className="stat-trend negative">Needs attention</div>
          </div>

          <div className="stat-card gradient-amber">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.pending_retest}</span>
              <span className="stat-label">Pending Retest</span>
            </div>
            <div className="stat-trend">Awaiting verification</div>
          </div>

          <div className="stat-card gradient-orange">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M2 12h20"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.deferred_bugs}</span>
              <span className="stat-label">Deferred Bugs</span>
            </div>
            <div className="stat-trend">Postponed</div>
          </div>

          <div className="stat-card gradient-green">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <path d="M22 4L12 14.01l-3-3"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.closed_bugs}</span>
              <span className="stat-label">Closed Bugs</span>
            </div>
            <div className="stat-trend positive">Resolved</div>
          </div>
        </div>

        {/* Most Recent Test Run Status - Above Open Bugs */}
        {testRuns && testRuns.length > 0 && (() => {
          const mostRecentRun = testRuns[0]; // Already sorted by created_on desc
          return (
            <div className="test-run-panel recent-run" style={{ marginTop: '24px', marginBottom: '24px' }}>
              <div className="panel-header">
                <h3 className="panel-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                  Most Recent Test Run: {mostRecentRun.name || `Test Run #${mostRecentRun.run_id}`}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="table-count">
                    {mostRecentRun.unique_test_cases} cases, {mostRecentRun.total_tests} executions
                  </span>
                  {mostRecentRun.created_on && (
                    <span className="meta-badge" style={{ fontSize: '11px' }}>
                      {formatDisplayDate(mostRecentRun.created_on)}
                    </span>
                  )}
                </div>
              </div>
              <div className="test-run-stats">
                <div className="test-run-stat-item">
                  <span className="test-run-stat-value" style={{ color: 'var(--accent-green)' }}>
                    {mostRecentRun.status_counts?.Passed || 0}
                  </span>
                  <span className="test-run-stat-label">Passed</span>
                </div>
                <div className="test-run-stat-item">
                  <span className="test-run-stat-value" style={{ color: 'var(--accent-red)' }}>
                    {mostRecentRun.status_counts?.Failed || 0}
                  </span>
                  <span className="test-run-stat-label">Failed</span>
                </div>
                <div className="test-run-stat-item">
                  <span className="test-run-stat-value" style={{ color: 'var(--accent-amber)' }}>
                    {mostRecentRun.status_counts?.Blocked || 0}
                  </span>
                  <span className="test-run-stat-label">Blocked</span>
                </div>
                <div className="test-run-stat-item">
                  <span className="test-run-stat-value" style={{ color: '#6b7280' }}>
                    {mostRecentRun.status_counts?.Untested || 0}
                  </span>
                  <span className="test-run-stat-label">Untested</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Bug Table - Moved to top */}
        <div className="table-panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
              Open Bugs (New, Assigned to Dev, Fixed, Reopened)
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="table-count">{bugs.length} open bugs</span>
              <button
                className="table-toggle-btn"
                onClick={() => toggleBugList('open-bugs')}
                title={expandedBugLists['open-bugs'] ? 'Collapse list' : 'Expand list'}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={expandedBugLists['open-bugs'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
          </div>
          {expandedBugLists['open-bugs'] && (
          <div className="table-wrapper">
      <table>
        <thead>
          <tr>
                  <th>Bug ID</th>
            <th>Status</th>
            <th>Severity</th>
                  <th>Priority</th>
            <th>Assignee</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {bugs.length === 0 && !loading && (
            <tr>
                    <td colSpan="6" className="empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
                      </svg>
                      <span>No open bugs found. Enter a Ticket ID to load data.</span>
                    </td>
            </tr>
          )}

          {bugs.map((bug) => (
            <tr key={bug.bug_id}>
                    <td className="bug-id">#{bug.bug_id}</td>
                    <td>
                      <span className={`badge status ${bug.status?.toLowerCase().replace(/\s+/g, '-')}`}>
                        {bug.status}
                      </span>
                    </td>
                    <td>
                      <span className={`badge severity ${bug.severity?.toLowerCase().replace(/\s+/g, '-')}`}>
                        {bug.severity}
                      </span>
                    </td>
                    <td>{bug.priority || "—"}</td>
                    <td className="assignee">{bug.assignee || "Unassigned"}</td>
                    <td className="subject">{bug.subject}</td>
            </tr>
          ))}
        </tbody>
      </table>
          </div>
          )}
        </div>

        {/* Deferred Bugs Table */}
        {deferredBugs.length > 0 && (
          <div className="table-panel">
            <div className="panel-header">
              <h3 className="panel-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M2 12h20"/>
                  <circle cx="12" cy="12" r="2"/>
                </svg>
                Deferred Bugs
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="table-count">{deferredBugs.length} deferred bugs</span>
                <button
                  className="table-toggle-btn"
                  onClick={() => toggleBugList('deferred-bugs')}
                  title={expandedBugLists['deferred-bugs'] ? 'Collapse list' : 'Expand list'}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={expandedBugLists['deferred-bugs'] ? 'expanded' : ''}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
              </div>
            </div>
            {expandedBugLists['deferred-bugs'] && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Bug ID</th>
                    <th>Severity</th>
                    <th>Priority</th>
                    <th>Assignee</th>
                    <th>Subject</th>
                    <th>Ageing (Days)</th>
                  </tr>
                </thead>
                <tbody>
                  {deferredBugs.map((bug) => (
                    <tr key={bug.bug_id}>
                      <td className="bug-id">#{bug.bug_id}</td>
                      <td>
                        <span className={`badge severity ${bug.severity?.toLowerCase().replace(/\s+/g, '-')}`}>
                          {bug.severity || "—"}
                        </span>
                      </td>
                      <td>{bug.priority || "—"}</td>
                      <td className="assignee">{bug.assignee || "Unassigned"}</td>
                      <td className="subject">{bug.subject}</td>
                      <td>
                        <span className={`age-badge ${bug.age_days > 60 ? 'age-high' : bug.age_days > 30 ? 'age-medium' : 'age-low'}`}>
                          {bug.age_days} days
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {/* Charts Row */}
        <div className="charts-row">
          {/* Bar Chart */}
          <div className="chart-panel large">
            <div className="panel-header">
              <h3 className="panel-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 20V10M12 20V4M6 20v-6"/>
                </svg>
                Bug Status by Severity
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="panel-badge">Live Data</div>
                <button 
                  className="chart-maximize-btn"
                  onClick={() => maximizeChart('severity')}
                  title="Maximize chart"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="chart-container bar-chart">
              {severityData ? (
                <Bar data={getBarChartData()} options={barChartOptions} />
              ) : (
                <div className="chart-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M18 20V10M12 20V4M6 20v-6"/>
                  </svg>
                  <p>Enter a Ticket ID and click Load Data</p>
                </div>
              )}
            </div>
          </div>

          {/* Doughnut Chart */}
          <div className="chart-panel">
            <div className="panel-header">
              <h3 className="panel-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 2a10 10 0 0110 10"/>
                </svg>
                Priority Distribution
              </h3>
              <button 
                className="chart-maximize-btn"
                onClick={() => maximizeChart('priority')}
                title="Maximize chart"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>
              </button>
            </div>
            <div className="chart-container pie-chart">
              {priorityData && Object.values(priorityData).some(v => v > 0) ? (
                <Doughnut data={getPieChartData()} options={pieChartOptions} />
              ) : (
                <div className="chart-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2a10 10 0 0110 10"/>
                  </svg>
                  <p>No priority data available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Gauges Row */}
        <div className="gauges-row">
          <div className="gauge-panel">
            <SpeedometerGauge 
              value={closurePercentage} 
              label="Bug Closure Rate"
              theme={theme}
            />
            <div className="gauge-details">
              <div className="detail-item">
                <span className="detail-label">Closed</span>
                <span className="detail-value">{summary.closed_bugs}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Total</span>
                <span className="detail-value">{summary.total_bugs}</span>
              </div>
            </div>
          </div>

          <div className="gauge-panel">
            <SpeedometerGauge 
              value={criticalPercentage} 
              label="Critical Bug Severity"
              theme={theme}
            />
            <div className="gauge-details">
              <div className="detail-item">
                <span className="detail-label">Critical</span>
                <span className="detail-value">{metrics.critical_bugs || criticalBugsCount}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Total</span>
                <span className="detail-value">{summary.total_bugs}</span>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="quick-stats-panel">
            <h4 className="quick-stats-title">Quick Insights</h4>
            <div className="quick-stat">
              <div className="quick-stat-bar">
                <div 
                  className="quick-stat-fill green" 
                  style={{ width: `${closurePercentage}%` }}
                ></div>
              </div>
              <div className="quick-stat-info">
                <span>Closure Rate</span>
                <span>{closurePercentage.toFixed(1)}%</span>
              </div>
            </div>
            <div className="quick-stat">
              <div className="quick-stat-bar">
                <div 
                  className="quick-stat-fill red" 
                  style={{ width: `${criticalPercentage}%` }}
                ></div>
              </div>
              <div className="quick-stat-info">
                <span>Critical Issues</span>
                <span>{criticalPercentage.toFixed(1)}%</span>
              </div>
            </div>
            <div className="quick-stat">
              <div className="quick-stat-bar">
                <div 
                  className="quick-stat-fill amber" 
                  style={{ width: `${summary.total_bugs > 0 ? (summary.open_bugs / summary.total_bugs * 100) : 0}%` }}
                ></div>
              </div>
              <div className="quick-stat-info">
                <span>Open Rate</span>
                <span>{summary.total_bugs > 0 ? ((summary.open_bugs / summary.total_bugs) * 100).toFixed(1) : 0}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Test Case Summary Cards - Collapsible Section Before Team Performance */}
        {testRailSummary && testRailSummary.total_test_cases > 0 && (
          <div className="widgets-section" style={{ marginTop: '32px' }}>
            <div className="section-header" style={{ cursor: 'pointer' }} onClick={() => setExpandedTestCasesSection(!expandedTestCasesSection)}>
              <h2 className="section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                Test Case Status Summary
              </h2>
              <button className="section-toggle" title={expandedTestCasesSection ? 'Collapse' : 'Expand'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={expandedTestCasesSection ? 'expanded' : ''}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedTestCasesSection && (
              <div className="section-content">
                <div className="stats-grid">
                  <div className="stat-card gradient-cyan">
                    <div className="stat-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{testRailSummary.total_test_cases}</span>
                      <span className="stat-label">Total Test Cases</span>
                    </div>
                    <div className="stat-trend">Unique cases</div>
                  </div>

                  <div className="stat-card gradient-green">
                    <div className="stat-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                        <path d="M22 4L12 14.01l-3-3"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{testRailSummary.status_counts.Passed || 0}</span>
                      <span className="stat-label">Passed</span>
                    </div>
                    <div className="stat-trend positive">Success</div>
                  </div>

                  <div className="stat-card gradient-red">
                    <div className="stat-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M15 9l-6 6M9 9l6 6"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{testRailSummary.status_counts.Failed || 0}</span>
                      <span className="stat-label">Failed</span>
                    </div>
                    <div className="stat-trend negative">Needs attention</div>
                  </div>

                  <div className="stat-card gradient-orange">
                    <div className="stat-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M12 8v8M8 12h8"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{testRailSummary.status_counts.Blocked || 0}</span>
                      <span className="stat-label">Blocked</span>
                    </div>
                    <div className="stat-trend">Cannot test</div>
                  </div>

                  <div className="stat-card gradient-gray">
                    <div className="stat-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{testRailSummary.status_counts.Untested || 0}</span>
                      <span className="stat-label">Untested</span>
                    </div>
                    <div className="stat-trend">Pending</div>
                  </div>
                </div>

                {/* Test Status Chart */}
                {testStatusData && testStatusData.status_distribution && Object.values(testStatusData.status_distribution).some(v => v > 0) && (
                  <div className="charts-row" style={{ marginTop: '20px' }}>
                    <div className="chart-panel">
                      <div className="panel-header">
                        <h3 className="panel-title">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 2a10 10 0 0110 10"/>
                          </svg>
                          Test Status Distribution
                        </h3>
                        <button 
                          className="chart-maximize-btn"
                          onClick={() => maximizeChart('test-status')}
                          title="Maximize chart"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                          </svg>
                        </button>
                      </div>
                      <div className="chart-container pie-chart">
                        <Doughnut data={getTestStatusChartData()} options={pieChartOptions} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}


        {/* Other Test Runs Section - After Test Case Summary */}
        {testRuns && testRuns.length > 1 && (
          <div className="widgets-section" style={{ marginTop: '32px' }}>
            <div className="section-header" style={{ cursor: 'pointer' }} onClick={() => setExpandedOtherTestRuns(!expandedOtherTestRuns)}>
              <h2 className="section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                Other Test Runs ({testRuns.length - 1})
              </h2>
              <button className="section-toggle" title={expandedOtherTestRuns ? 'Collapse' : 'Expand'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={expandedOtherTestRuns ? 'expanded' : ''}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedOtherTestRuns && (
              <div className="section-content">
                {/* Test Run Comparison Charts */}
                <div className="charts-row" style={{ marginBottom: '24px' }}>
                  {/* Test Run Comparison Bar Chart */}
                  {getTestRunComparisonData() && (
                    <div className="chart-panel large">
                      <div className="panel-header">
                        <h3 className="panel-title">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 20V10M12 20V4M6 20v-6"/>
                          </svg>
                          Test Run Comparison
                        </h3>
                        <button 
                          className="chart-maximize-btn"
                          onClick={(e) => { e.stopPropagation(); maximizeChart('test-run-comparison'); }}
                          title="Maximize chart"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                          </svg>
                        </button>
                      </div>
                      <div className="chart-container bar-chart">
                        <Bar data={getTestRunComparisonData()} options={{
                          ...barChartOptions,
                          plugins: {
                            ...barChartOptions.plugins,
                            legend: {
                              display: true,
                              position: 'top',
                              labels: {
                                color: 'var(--text-secondary)',
                                usePointStyle: true,
                                padding: 15,
                                font: { family: "'Inter', sans-serif", size: 11 }
                              }
                            }
                          }
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Pass Rate Chart */}
                  {getTestPassRateData() && (
                    <div className="chart-panel">
                      <div className="panel-header">
                        <h3 className="panel-title">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                          </svg>
                          Pass Rate by Run
                        </h3>
                        <button 
                          className="chart-maximize-btn"
                          onClick={(e) => { e.stopPropagation(); maximizeChart('pass-rate'); }}
                          title="Maximize chart"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                          </svg>
                        </button>
                      </div>
                      <div className="chart-container bar-chart">
                        <Bar data={getTestPassRateData()} options={{
                          ...barChartOptions,
                          plugins: {
                            ...barChartOptions.plugins,
                            legend: { display: false }
                          },
                          scales: {
                            ...barChartOptions.scales,
                            y: {
                              ...barChartOptions.scales?.y,
                              max: 100,
                              ticks: {
                                ...barChartOptions.scales?.y?.ticks,
                                callback: (val) => val + '%'
                              }
                            }
                          }
                        }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Individual Test Runs */}
                {testRuns.slice(1).map((run) => (
                  <div key={run.run_id} className="test-run-panel" style={{ marginBottom: '16px' }}>
                    <div className="panel-header">
                      <h3 className="panel-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                        </svg>
                        {run.name || `Test Run #${run.run_id}`}
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="table-count">
                          {run.unique_test_cases} cases, {run.total_tests} executions
                        </span>
                        {run.created_on && (
                          <span className="meta-badge" style={{ fontSize: '11px' }}>
                            {formatDisplayDate(run.created_on)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="test-run-stats">
                      <div className="test-run-stat-item">
                        <span className="test-run-stat-value" style={{ color: 'var(--accent-green)' }}>
                          {run.status_counts.Passed || 0}
                        </span>
                        <span className="test-run-stat-label">Passed</span>
                      </div>
                      <div className="test-run-stat-item">
                        <span className="test-run-stat-value" style={{ color: 'var(--accent-red)' }}>
                          {run.status_counts.Failed || 0}
                        </span>
                        <span className="test-run-stat-label">Failed</span>
                      </div>
                      <div className="test-run-stat-item">
                        <span className="test-run-stat-value" style={{ color: 'var(--accent-amber)' }}>
                          {run.status_counts.Blocked || 0}
                        </span>
                        <span className="test-run-stat-label">Blocked</span>
                      </div>
                      <div className="test-run-stat-item">
                        <span className="test-run-stat-value" style={{ color: '#6b7280' }}>
                          {run.status_counts.Untested || 0}
                        </span>
                        <span className="test-run-stat-label">Untested</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Team Performance Section */}
        {summary.total_bugs > 0 && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Team Performance</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('team-performance')}
                title={expandedSections['team-performance'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['team-performance'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['team-performance'] && (
            <div className="widgets-grid">
              {/* Assignee Distribution */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                    Assignee Distribution
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('assignee')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {assigneeData ? (
                    <Bar data={getAssigneeChartData()} options={horizontalBarOptions} />
                  ) : (
                    <div className="chart-empty">No assignee data</div>
                  )}
                </div>
              </div>

              {/* Author Activity */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    Author Activity
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('author')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {authorData ? (
                    <Bar data={getAuthorChartData()} options={barChartOptions} />
                  ) : (
                    <div className="chart-empty">No author data</div>
                  )}
                </div>
              </div>

              {/* Resolution Time Widget */}
              <div className="stat-card gradient-cyan">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">
                    {resolutionTimeData?.average_days ? `${resolutionTimeData.average_days.toFixed(1)}` : '—'}
                  </span>
                  <span className="stat-label">Avg Resolution (days)</span>
                </div>
                <div className="stat-trend">
                  {resolutionTimeData?.total_resolved || 0} bugs resolved
                </div>
                {resolutionTimeData && (
                  <div className="stat-details">
                    <div>Fastest: {resolutionTimeData.fastest_days}d</div>
                    <div>Slowest: {resolutionTimeData.slowest_days}d</div>
                    <div>Median: {resolutionTimeData.median_days}d</div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        )}

        {/* Technical Breakdown Section */}
        {summary.total_bugs > 0 && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Technical Breakdown</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('technical-breakdown')}
                title={expandedSections['technical-breakdown'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['technical-breakdown'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['technical-breakdown'] && (
            <div className="widgets-grid">
              {/* Module Breakdown */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M3 9h18M9 3v18"/>
                    </svg>
                    Module Breakdown
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('module')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container pie-chart">
                  {moduleData ? (
                    <Doughnut data={getModuleChartData()} options={pieChartOptions} />
                  ) : (
                    <div className="chart-empty">No module data</div>
                  )}
                </div>
              </div>

              {/* Feature Breakdown */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                    Feature Breakdown
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('feature')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {featureData ? (
                    <Bar data={getFeatureChartData()} options={horizontalBarOptions} />
                  ) : (
                    <div className="chart-empty">No feature data</div>
                  )}
                </div>
              </div>

              {/* Browser/OS Matrix */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2"/>
                      <path d="M8 21h8M12 17v4"/>
                    </svg>
                    Browser/OS Matrix
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('browser-os')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {browserOsData ? (
                    <Bar data={getBrowserOsChartData()} options={barChartOptions} />
                  ) : (
                    <div className="chart-empty">No browser/OS data</div>
                  )}
                </div>
              </div>

              {/* Platform Comparison */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="7" width="20" height="14" rx="2"/>
                      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>
                    </svg>
                    Platform Comparison
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('platform')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {platformData ? (
                    <Bar data={getPlatformChartData()} options={barChartOptions} />
                  ) : (
                    <div className="chart-empty">No platform data</div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {/* Temporal Analysis Section */}
        {summary.total_bugs > 0 && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Temporal Analysis</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('temporal-analysis')}
                title={expandedSections['temporal-analysis'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['temporal-analysis'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['temporal-analysis'] && (
            <div className="widgets-grid">
              {/* Bug Age Widget */}
              <div className="stat-card gradient-blue">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">
                    {ageData?.average_age_days ? `${ageData.average_age_days.toFixed(1)}` : '—'}
                  </span>
                  <span className="stat-label">Avg Bug Age (days)</span>
                </div>
                <div className="stat-trend">
                  {ageData?.total_open_bugs || 0} open bugs
                </div>
                {ageData && (
                  <div className="stat-details">
                    <div>Oldest: {ageData.oldest_age_days}d</div>
                  </div>
                )}
              </div>

              {/* Age Distribution Chart */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    Age Distribution
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('age-dist')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {ageData ? (
                    <Bar data={getAgeDistributionData()} options={barChartOptions} />
                  ) : (
                    <div className="chart-empty">No age data</div>
                  )}
                </div>
              </div>

              {/* Resolution Time Distribution */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    Resolution Time Distribution
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('resolution-time-dist')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="chart-container bar-chart">
                  {resolutionTimeData ? (
                    <Bar data={getResolutionTimeDistributionData()} options={barChartOptions} />
                  ) : (
                    <div className="chart-empty">No resolution time data</div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {/* Additional Metrics Section */}
        {summary.total_bugs > 0 && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Additional Metrics</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('additional-metrics')}
                title={expandedSections['additional-metrics'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['additional-metrics'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['additional-metrics'] && (
            <div className="widgets-grid">
              {/* Reopened Bugs Widget */}
              <div className="stat-card gradient-purple">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 4v6h6M23 20v-6h-6"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{reopenedData?.total_reopened || 0}</span>
                  <span className="stat-label">Reopened Bugs</span>
                </div>
                <div className="stat-trend">
                  {reopenedData?.reopened_percentage || 0}% of total
                </div>
              </div>

              {/* Top Issues Widget */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <path d="M12 9v4M12 17h.01"/>
                    </svg>
                    Top Issues
                  </h3>
                  <button 
                    className="chart-maximize-btn"
                    onClick={() => maximizeChart('top-issues')}
                    title="Maximize chart"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                    </svg>
                  </button>
                </div>
                <div className="top-issues-list">
                  {moduleData ? (
                    Object.entries(moduleData)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([module, count], index) => (
                        <div key={module} className="top-issue-item">
                          <span className="issue-rank">#{index + 1}</span>
                          <span className="issue-name">{module}</span>
                          <span className="issue-count">{count}</span>
                        </div>
                      ))
                  ) : (
                    <div className="chart-empty">No module data</div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

      </main>

      {/* Chart Maximize Modal */}
      {maximizedChart && maximizedChartConfig && (
        <div className="chart-modal-overlay" onClick={minimizeChart}>
          <div className="chart-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="chart-modal-header">
              <h2 className="chart-modal-title">{maximizedChartConfig.title}</h2>
              <button 
                className="chart-modal-close"
                onClick={minimizeChart}
                title="Minimize chart"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="chart-modal-body">
              {maximizedChartConfig.type === 'list' && maximizedChart === 'top-issues' ? (
                <div className="top-issues-list-modal">
                  {moduleData ? (
                    Object.entries(moduleData)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 10)
                      .map(([module, count], index) => (
                        <div key={module} className="top-issue-item">
                          <span className="issue-rank">#{index + 1}</span>
                          <span className="issue-name">{module}</span>
                          <span className="issue-count">{count}</span>
                        </div>
                      ))
                  ) : (
                    <div className="chart-empty">No module data</div>
                  )}
                </div>
              ) : maximizedChartConfig.data ? (
                <div className="chart-modal-chart">
                  {maximizedChartConfig.type === 'doughnut' ? (
                    <Doughnut data={maximizedChartConfig.data} options={maximizedChartConfig.options} />
                  ) : (
                    <Bar data={maximizedChartConfig.data} options={maximizedChartConfig.options} />
                  )}
                </div>
              ) : (
                <div className="chart-empty">No data available</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
