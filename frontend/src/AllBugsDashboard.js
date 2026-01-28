import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { TicketExternalLink } from "./ticketUtils";
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
import { useTableSort, SortableHeader } from "./useTableSort";
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

// Speedometer Gauge Component (same as Dashboard)
function SpeedometerGauge({ value, label, maxValue = 100, theme = 'dark' }) {
  const percentage = Math.min((value / maxValue) * 100, 100);
  const rotation = (percentage / 100) * 180;
  
  const getColor = () => {
    if (percentage < 30) return "#ef4444";
    if (percentage < 60) return "#f59e0b";
    return "#22c55e";
  };

  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const angle = (i * 9) - 90;
    const isMain = i % 5 === 0;
    const isMedium = i % 2 === 0 && !isMain;
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
          <div className="speedometer-track"></div>
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
          <div className="speedometer-ticks">
            {ticks}
          </div>
          <div 
            className="speedometer-needle"
            style={{ transform: `rotate(${rotation - 90}deg)` }}
          >
            <div className="needle-pointer"></div>
          </div>
          <div className="speedometer-center"></div>
        </div>
        <div className="speedometer-scale">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>
      <div className="speedometer-percentage">
        <span className="percentage-value" style={{ color: getColor() }}>{value.toFixed(1)}</span>
        <span className="percentage-unit">%</span>
      </div>
    </div>
  );
}

function AllBugsDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('dashboard-theme');
      return savedTheme || 'dark';
    } catch (e) {
      return 'dark';
    }
  });
  const [environment, setEnvironment] = useState("All");
  const [employeeMap, setEmployeeMap] = useState({});

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
  
  // New extended Redmine data states
  const [timeTrackingData, setTimeTrackingData] = useState(null);
  const [slaData, setSlaData] = useState(null);
  const [lifecycleData, setLifecycleData] = useState(null);
  const [completionData, setCompletionData] = useState(null);
  const [teamSummaryData, setTeamSummaryData] = useState(null);

  const [bugs, setBugs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Maximize/minimize state for charts
  const [maximizedChart, setMaximizedChart] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    'team-performance': true,
    'technical-breakdown': true,
    'temporal-analysis': true,
    'additional-metrics': true,
    'time-tracking': true,
    'sla-analysis': true,
    'lifecycle-analysis': true,
  });

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

  // Auto-calculate derived metrics
  const closurePercentage = summary.total_bugs > 0 
    ? ((summary.closed_bugs / summary.total_bugs) * 100) 
    : 0;

  const criticalBugsCount = bugs.filter(b => b.severity === "Critical").length;
  const criticalPercentage = summary.total_bugs > 0 
    ? ((criticalBugsCount / summary.total_bugs) * 100) 
    : 0;

  // Calculate RAG Status
  const calculateRAGStatus = () => {
    if (summary.total_bugs === 0) {
      return { status: 'GREEN', label: 'No Issues', color: '#22c55e', score: 100 };
    }

    let score = 100;
    const factors = [];

    if (criticalPercentage > 20) {
      score -= 40;
      factors.push('High critical bugs');
    } else if (criticalPercentage > 10) {
      score -= 20;
      factors.push('Moderate critical bugs');
    }

    if (closurePercentage < 30) {
      score -= 30;
      factors.push('Low closure rate');
    } else if (closurePercentage < 60) {
      score -= 15;
      factors.push('Moderate closure rate');
    }

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
    setLoading(true);
    setError("");
    setBugs([]);

    try {
      const baseUrl = `${BACKEND_URL}/bugs`;
      const envParam = `environment=${environment}`;
      
      console.log('Loading all bugs data for environment:', environment);
      
      // No ticket_id parameter for all bugs view
      const [
        summaryRes, severityRes, priorityRes, metricsRes,
        assigneeRes, authorRes, moduleRes, featureRes, browserOsRes, platformRes,
        ageRes, resolutionRes, reopenedRes,
        timeTrackingRes, slaRes, lifecycleRes, completionRes, teamSummaryRes
      ] = await Promise.all([
        fetch(`${baseUrl}/all-summary?${envParam}`).catch(err => {
          console.error('Failed to fetch all-summary:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/severity-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch severity-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/priority-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch priority-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/metrics?${envParam}`).catch(err => {
          console.error('Failed to fetch metrics:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/assignee-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch assignee-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/author-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch author-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/module-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch module-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/feature-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch feature-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/browser-os-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch browser-os-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/platform-breakdown?${envParam}`).catch(err => {
          console.error('Failed to fetch platform-breakdown:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/age-analysis?${envParam}`).catch(err => {
          console.error('Failed to fetch age-analysis:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/resolution-time?${envParam}`).catch(err => {
          console.error('Failed to fetch resolution-time:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/reopened-analysis?${envParam}`).catch(err => {
          console.error('Failed to fetch reopened-analysis:', err);
          return { ok: false, status: 500 };
        }),
        // New extended endpoints
        fetch(`${baseUrl}/time-tracking?${envParam}`).catch(err => {
          console.error('Failed to fetch time-tracking:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/sla-analysis?${envParam}`).catch(err => {
          console.error('Failed to fetch sla-analysis:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/lifecycle-analysis?${envParam}`).catch(err => {
          console.error('Failed to fetch lifecycle-analysis:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/completion-progress?${envParam}`).catch(err => {
          console.error('Failed to fetch completion-progress:', err);
          return { ok: false, status: 500 };
        }),
        fetch(`${baseUrl}/team-summary?${envParam}`).catch(err => {
          console.error('Failed to fetch team-summary:', err);
          return { ok: false, status: 500 };
        }),
      ]);

      if (!summaryRes.ok) {
        const errorText = await summaryRes.text().catch(() => 'Unknown error');
        console.error('Summary endpoint failed:', summaryRes.status, errorText);
        throw new Error(`Failed to load summary data: ${summaryRes.status}`);
      }

      const [
        summaryData, severityBreakdown, priorityBreakdown, metricsData,
        assigneeBreakdown, authorBreakdown, moduleBreakdown, featureBreakdown,
        browserOsBreakdown, platformBreakdown, ageAnalysis, resolutionTime, reopenedAnalysis,
        timeTracking, slaAnalysis, lifecycleAnalysis, completionProgress, teamSummary
      ] = await Promise.all([
        summaryRes.json(),
        severityRes.ok ? severityRes.json() : null,
        priorityRes.ok ? priorityRes.json() : null,
        metricsRes.ok ? metricsRes.json() : null,
        assigneeRes.ok ? assigneeRes.json() : null,
        authorRes.ok ? authorRes.json() : null,
        moduleRes.ok ? moduleRes.json() : null,
        featureRes.ok ? featureRes.json() : null,
        browserOsRes.ok ? browserOsRes.json() : null,
        platformRes.ok ? platformRes.json() : null,
        ageRes.ok ? ageRes.json() : null,
        resolutionRes.ok ? resolutionRes.json() : null,
        reopenedRes.ok ? reopenedRes.json() : null,
        timeTrackingRes.ok ? timeTrackingRes.json() : null,
        slaRes.ok ? slaRes.json() : null,
        lifecycleRes.ok ? lifecycleRes.json() : null,
        completionRes.ok ? completionRes.json() : null,
        teamSummaryRes.ok ? teamSummaryRes.json() : null,
      ]);

      console.log('Summary data loaded:', summaryData);

      // Get all bugs for the table (no ticket filter)
      try {
        const allBugsRes = await fetch(`${baseUrl}?ticket_id=0&${envParam}`);
        if (allBugsRes.ok) {
          const allBugs = await allBugsRes.json();
          // Filter to get open bugs only
          const openBugs = allBugs.filter(b => 
            b.status && ["New", "Reopened", "Fixed", "Assigned to Dev"].includes(b.status)
          );
          // Sort bugs by severity before setting
          const sortedBugs = sortBugsBySeverity(openBugs);
          setBugs(sortedBugs);
          console.log('Loaded bugs:', sortedBugs.length);
        } else {
          console.warn('Failed to load bugs list:', allBugsRes.status);
        }
      } catch (e) {
        console.warn('Failed to load bugs list:', e);
      }

      setSummary(summaryData);
      setSeverityData(severityBreakdown);
      setPriorityData(priorityBreakdown);
      setMetrics(metricsData);
      
      setAssigneeData(assigneeBreakdown);
      setAuthorData(authorBreakdown);
      setModuleData(moduleBreakdown);
      setFeatureData(featureBreakdown);
      setBrowserOsData(browserOsBreakdown);
      setPlatformData(platformBreakdown);
      setAgeData(ageAnalysis);
      setResolutionTimeData(resolutionTime);
      setReopenedData(reopenedAnalysis);
      
      // Set new extended data
      setTimeTrackingData(timeTracking);
      setSlaData(slaAnalysis);
      setLifecycleData(lifecycleAnalysis);
      setCompletionData(completionProgress);
      setTeamSummaryData(teamSummary);

    } catch (err) {
      console.error('Error loading bugs:', err);
      setError(`Unable to load data: ${err.message}. Please check backend connection at ${BACKEND_URL}`);
    } finally {
      setLoading(false);
    }
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

  // Load data on mount and when environment changes
  useEffect(() => {
    loadBugs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

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
        console.error('Failed to load employees for name lookup:', err);
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

  // Chart data helper functions (same as Dashboard)
  const getBarChartData = () => {
    if (!severityData) return null;
    const baseColor = "rgba(34, 197, 94, 0.85)";
    const borderColor = "rgba(22, 163, 74, 1)";
    const colorVariations = [
      "rgba(34, 197, 94, 0.85)", "rgba(22, 163, 74, 0.85)", 
      "rgba(16, 185, 129, 0.85)", "rgba(5, 150, 105, 0.85)",
    ];

    const datasets = severityData.severities.map((severity, index) => ({
      label: severity,
      data: severityData.statuses.map((status) => severityData.data[status][severity]),
      backgroundColor: colorVariations[index % colorVariations.length] || baseColor,
      borderColor: borderColor,
      borderWidth: 2,
      borderRadius: 6,
      borderSkipped: false,
    }));

    return {
      labels: severityData.statuses,
      datasets,
    };
  };

  const getPieChartData = () => {
    if (!priorityData) return null;
    const baseColor = "rgba(34, 197, 94, 0.85)";
    const borderColor = "rgba(22, 163, 74, 1)";
    const colorShades = [
      "rgba(34, 197, 94, 0.9)", "rgba(22, 163, 74, 0.9)", 
      "rgba(16, 185, 129, 0.9)", "rgba(5, 150, 105, 0.9)",
    ];

    const labels = Object.keys(priorityData).filter(k => priorityData[k] > 0);
    const values = labels.map(k => priorityData[k]);
    const bgColors = labels.map((_, index) => colorShades[index % colorShades.length] || baseColor);

    return {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColor,
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
        font: { size: 11, weight: '600' },
        formatter: (value) => value > 0 ? value : '',
        padding: { top: 4 },
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
        font: { size: 13, weight: '700' },
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

  // Helper functions for new widget charts (same as Dashboard)
  // Team color mapping for charts
  const getTeamColor = (team, opacity = 0.85) => {
    switch (team) {
      case 'DEV': return `rgba(59, 130, 246, ${opacity})`; // Blue
      case 'QA': return `rgba(34, 197, 94, ${opacity})`; // Green
      case 'BIS Team': return `rgba(249, 115, 22, ${opacity})`; // Orange
      default: return `rgba(156, 163, 175, ${opacity})`; // Gray
    }
  };

  const getTeamBorderColor = (team) => {
    switch (team) {
      case 'DEV': return 'rgba(37, 99, 235, 1)'; // Blue
      case 'QA': return 'rgba(22, 163, 74, 1)'; // Green
      case 'BIS Team': return 'rgba(234, 88, 12, 1)'; // Orange
      default: return 'rgba(107, 114, 128, 1)'; // Gray
    }
  };

  const getAssigneeChartData = () => {
    if (!assigneeData) return null;
    const assignees = Object.entries(assigneeData)
      .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
      .slice(0, 15) // Limit to top 15 for better visibility
      .map(([name]) => name);
    
    // Get team colors for each assignee
    const teamColors = assignees.map(a => getTeamColor(assigneeData[a]?.team || 'Unknown'));
    const teamBorderColors = assignees.map(a => getTeamBorderColor(assigneeData[a]?.team || 'Unknown'));
    
    const totalData = assignees.map(a => assigneeData[a].total || 0);
    
    return {
      labels: assignees.map(a => `${a} (${assigneeData[a]?.team || 'Unknown'})`),
      datasets: [
        {
          label: 'Total Bugs',
          data: totalData,
          backgroundColor: teamColors,
          borderColor: teamBorderColors,
          borderWidth: 2,
          borderRadius: 6,
        }
      ]
    };
  };

  // Team-segregated assignee chart (grouped by team)
  const getTeamAssigneeChartData = () => {
    if (!teamSummaryData) return null;
    
    const teams = ['DEV', 'QA', 'BIS Team'];
    const teamTotals = teams.map(team => teamSummaryData[team]?.total_bugs || 0);
    const teamOpen = teams.map(team => teamSummaryData[team]?.open || 0);
    const teamClosed = teams.map(team => teamSummaryData[team]?.closed || 0);
    
    return {
      labels: teams,
      datasets: [
        {
          label: 'Open',
          data: teamOpen,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderColor: 'rgba(185, 28, 28, 1)',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Closed',
          data: teamClosed,
          backgroundColor: 'rgba(34, 197, 94, 0.85)',
          borderColor: 'rgba(22, 163, 74, 1)',
          borderWidth: 2,
          borderRadius: 6,
        }
      ]
    };
  };

  const getAuthorChartData = () => {
    if (!authorData) return null;
    const authors = Object.keys(authorData).sort((a, b) => authorData[b].total - authorData[a].total).slice(0, 10);
    const totals = authors.map(a => authorData[a].total);
    
    // Get team colors for each author
    const teamColors = authors.map(a => getTeamColor(authorData[a]?.team || 'Unknown'));
    const teamBorderColors = authors.map(a => getTeamBorderColor(authorData[a]?.team || 'Unknown'));
    return {
      labels: authors.map(a => `${a} (${authorData[a]?.team || 'Unknown'})`),
      datasets: [{
        label: 'Bugs Reported',
        data: totals,
        backgroundColor: teamColors,
        borderColor: teamBorderColors,
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
      }
    };

    return chartConfigs[maximizedChart] || null;
  };

  const maximizedChartConfig = getMaximizedChart();

  // Table sorting for bugs
  const { sortedData: sortedBugs, sortConfig: bugsSortConfig, handleSort: handleBugsSort } = useTableSort(bugs, {
    defaultSortKey: 'bug_id',
    defaultSortDirection: 'desc'
  });

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
        {/* Loading Overlay */}
        {loading && (
          <div className="loading-overlay">
            <div className="loading-spinner-large"></div>
            <p>Loading dashboard data...</p>
          </div>
        )}

        {/* Filter Section */}
        <div className="filter-section">
          <div className="filter-header">
            <h2 className="filter-title">All Bugs Analytics</h2>
            <p className="filter-subtitle">View aggregate bug data across all tickets</p>
          </div>
          <div className="filter-controls">
            <div className="filter-group">
              <label className="filter-label">Environment</label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="env-select-large"
              >
                <option>All</option>
                <option>Staging</option>
                <option>Pre-production</option>
                <option>Production</option>
                <option>BIS Testing (Pre)</option>
              </select>
            </div>
            <button className="load-btn-large" onClick={loadBugs} disabled={loading}>
              {loading ? (
                <>
                  <span className="loading-spinner"></span>
                  Loading...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    <path d="M9 12l2 2 4-4"/>
                  </svg>
                  Refresh Data
                </>
              )}
            </button>
          </div>
        </div>

        {/* Top Header */}
        <header className="top-header">
          <div className="header-left">
            <img 
              src="/techversant-logo.png" 
              alt="Techversant Infotech" 
              className="company-logo"
            />
            <div className="header-divider"></div>
            <h1 className="page-title">All Bugs Dashboard</h1>
            <p className="page-subtitle">Aggregate bug tracking & analysis</p>
          </div>
        </header>

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

        {/* Environment Banner */}
        {environment && (
          <div className="ticket-banner">
            <div className="ticket-info">
              <span className="ticket-label">Environment</span>
              <span className="ticket-id">{environment}</span>
            </div>
            <div className="ticket-title">All Tickets - Aggregate View</div>
            <div className="ticket-meta">
              <span className="meta-badge">{summary.total_bugs} Total Bugs</span>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card gradient-purple">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.total_bugs}</span>
              <span className="stat-label">Total Bugs</span>
            </div>
            <div className="stat-trend">All tracked issues</div>
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

          <div className="stat-card gradient-gray">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M15 9l-6 6M9 9l6 6"/>
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{summary.rejected_bugs || 0}</span>
              <span className="stat-label">Rejected Bugs</span>
            </div>
            <div className="stat-trend">Not accepted</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="charts-row">
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
                  <p>Loading data...</p>
                </div>
              )}
            </div>
          </div>

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

        {/* Time Tracking & Variance Section */}
        {summary.total_bugs > 0 && timeTrackingData && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Time Tracking & Variance</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('time-tracking')}
                title={expandedSections['time-tracking'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['time-tracking'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['time-tracking'] && (
            <div className="widgets-grid">
              {/* Not Estimated Warning Card */}
              <div className={`stat-card ${timeTrackingData.not_estimated_percent > 30 ? 'gradient-red' : 'gradient-orange'}`}>
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <path d="M12 9v4M12 17h.01"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{timeTrackingData.not_estimated_count || 0}</span>
                  <span className="stat-label">NOT ESTIMATED</span>
                </div>
                <div className="stat-trend negative">
                  {timeTrackingData.not_estimated_percent?.toFixed(1) || 0}% of bugs
                </div>
              </div>

              {/* Estimate vs Actual Card */}
              <div className="stat-card gradient-blue">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{timeTrackingData.total_estimated_hours || 0}h</span>
                  <span className="stat-label">Total Estimated</span>
                </div>
                <div className="stat-details">
                  <div>Spent: {timeTrackingData.total_spent_hours || 0}h</div>
                  <div className={`variance-text ${timeTrackingData.overall_variance_percent > 10 ? 'negative' : 'positive'}`}>
                    Variance: {timeTrackingData.overall_variance_percent > 0 ? '+' : ''}{timeTrackingData.overall_variance_percent?.toFixed(1) || 0}%
                  </div>
                </div>
              </div>

              {/* Variance Distribution Chart */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    Variance Distribution
                  </h3>
                </div>
                <div className="variance-bars">
                  <div className="variance-bar-item">
                    <span className="variance-label">Under Estimate</span>
                    <div className="variance-bar-track">
                      <div className="variance-bar-fill green" style={{ width: `${(timeTrackingData.variance_distribution?.under_estimate / timeTrackingData.estimated_count * 100) || 0}%` }}></div>
                    </div>
                    <span className="variance-count">{timeTrackingData.variance_distribution?.under_estimate || 0}</span>
                  </div>
                  <div className="variance-bar-item">
                    <span className="variance-label">On Track (±10%)</span>
                    <div className="variance-bar-track">
                      <div className="variance-bar-fill blue" style={{ width: `${(timeTrackingData.variance_distribution?.on_track / timeTrackingData.estimated_count * 100) || 0}%` }}></div>
                    </div>
                    <span className="variance-count">{timeTrackingData.variance_distribution?.on_track || 0}</span>
                  </div>
                  <div className="variance-bar-item">
                    <span className="variance-label">Over Estimate</span>
                    <div className="variance-bar-track">
                      <div className="variance-bar-fill red" style={{ width: `${(timeTrackingData.variance_distribution?.over_estimate / timeTrackingData.estimated_count * 100) || 0}%` }}></div>
                    </div>
                    <span className="variance-count">{timeTrackingData.variance_distribution?.over_estimate || 0}</span>
                  </div>
                </div>
              </div>

              {/* Top Variances List */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <path d="M12 9v4M12 17h.01"/>
                    </svg>
                    Top Variance Bugs
                  </h3>
                </div>
                <div className="top-issues-list">
                  {timeTrackingData.top_variances?.slice(0, 5).map((bug, index) => (
                    <div key={bug.bug_id} className="top-issue-item">
                      <span className="issue-rank">#{bug.bug_id}</span>
                      <span className="issue-name">{bug.subject}</span>
                      <span className={`badge variance ${bug.variance_status}`}>
                        {bug.variance_percent > 0 ? '+' : ''}{bug.variance_percent}%
                      </span>
                    </div>
                  ))}
                  {(!timeTrackingData.top_variances || timeTrackingData.top_variances.length === 0) && (
                    <div className="chart-empty">No variance data</div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {/* SLA/Due Date Analysis Section */}
        {summary.total_bugs > 0 && slaData && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">SLA & Due Date Analysis</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('sla-analysis')}
                title={expandedSections['sla-analysis'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['sla-analysis'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['sla-analysis'] && (
            <div className="widgets-grid">
              {/* SLA Compliance Rate */}
              <div className={`stat-card ${slaData.sla_compliance_rate >= 70 ? 'gradient-green' : slaData.sla_compliance_rate >= 50 ? 'gradient-amber' : 'gradient-red'}`}>
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <path d="M22 4L12 14.01l-3-3"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{slaData.sla_compliance_rate?.toFixed(1) || 0}%</span>
                  <span className="stat-label">SLA Compliance</span>
                </div>
                <div className="stat-trend">
                  {slaData.on_time_count || 0} on time / {slaData.overdue_count || 0} overdue
                </div>
              </div>

              {/* Overdue Count */}
              <div className="stat-card gradient-red">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4l2 2"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{slaData.overdue_count || 0}</span>
                  <span className="stat-label">Overdue Bugs</span>
                </div>
                <div className="stat-trend negative">Needs immediate attention</div>
              </div>

              {/* No Due Date */}
              <div className="stat-card gradient-gray">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <path d="M16 2v4M8 2v4M3 10h18"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{slaData.no_due_date_count || 0}</span>
                  <span className="stat-label">No Due Date</span>
                </div>
                <div className="stat-trend">Missing deadline info</div>
              </div>

              {/* Overdue Bugs List */}
              <div className="chart-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <path d="M12 9v4M12 17h.01"/>
                    </svg>
                    Overdue Bugs
                  </h3>
                </div>
                <div className="top-issues-list">
                  {slaData.overdue_bugs?.slice(0, 5).map((bug, index) => (
                    <div key={bug.bug_id} className="top-issue-item">
                      <span className="issue-rank">#{bug.bug_id}</span>
                      <span className="issue-name">{bug.subject}</span>
                      <span className="badge severity critical">{bug.days_overdue}d overdue</span>
                    </div>
                  ))}
                  {(!slaData.overdue_bugs || slaData.overdue_bugs.length === 0) && (
                    <div className="chart-empty">No overdue bugs!</div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {/* Bug Lifecycle Section */}
        {summary.total_bugs > 0 && lifecycleData && (
          <div className="widgets-section">
            <div className="section-header">
              <h2 className="section-title">Bug Lifecycle Analysis</h2>
              <button 
                className="section-toggle"
                onClick={() => toggleSection('lifecycle-analysis')}
                title={expandedSections['lifecycle-analysis'] ? 'Collapse section' : 'Expand section'}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={expandedSections['lifecycle-analysis'] ? 'expanded' : ''}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            {expandedSections['lifecycle-analysis'] && (
            <div className="widgets-grid">
              {/* Average Lifecycle */}
              <div className="stat-card gradient-purple">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="stat-content">
                  <span className="stat-value">{lifecycleData.avg_creation_to_close_days || 0}</span>
                  <span className="stat-label">Avg Days to Close</span>
                </div>
                <div className="stat-details">
                  <div>Min: {lifecycleData.min_lifecycle_days || 0}d</div>
                  <div>Max: {lifecycleData.max_lifecycle_days || 0}d</div>
                  <div>Median: {lifecycleData.median_lifecycle_days || 0}d</div>
                </div>
              </div>

              {/* Lifecycle Distribution Chart */}
              <div className="chart-panel" style={{ gridColumn: 'span 2' }}>
                <div className="panel-header">
                  <h3 className="panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    Resolution Time Distribution
                  </h3>
                </div>
                <div className="lifecycle-distribution">
                  {lifecycleData.creation_close_distribution && Object.entries(lifecycleData.creation_close_distribution).map(([bucket, count]) => (
                    <div key={bucket} className="lifecycle-bar-item">
                      <span className="lifecycle-label">{bucket} days</span>
                      <div className="lifecycle-bar-track">
                        <div 
                          className="lifecycle-bar-fill" 
                          style={{ 
                            width: `${(count / lifecycleData.total_closed_bugs * 100) || 0}%`,
                            backgroundColor: bucket === '30+' ? '#ef4444' : bucket.includes('15') ? '#f59e0b' : '#22c55e'
                          }}
                        ></div>
                      </div>
                      <span className="lifecycle-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Completion Progress */}
              {completionData && (
                <div className="stat-card gradient-cyan">
                  <div className="stat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <path d="M22 4L12 14.01l-3-3"/>
                    </svg>
                  </div>
                  <div className="stat-content">
                    <span className="stat-value">{completionData.avg_completion_percent?.toFixed(0) || 0}%</span>
                    <span className="stat-label">Avg Completion</span>
                  </div>
                  <div className="stat-details">
                    <div>Not Started: {completionData.bugs_not_started || 0}</div>
                    <div>Near Complete: {completionData.near_completion || 0}</div>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Bug Table */}
        <div className="table-panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
              Open Bugs (New, Assigned to Dev, Fixed, Reopened)
            </h3>
            <span className="table-count">{sortedBugs.length} open bugs</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableHeader columnKey="bug_id" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Bug ID</SortableHeader>
                  <SortableHeader columnKey="ticket_id" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Ticket ID</SortableHeader>
                  <SortableHeader columnKey="status" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Status</SortableHeader>
                  <SortableHeader columnKey="severity" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Severity</SortableHeader>
                  <SortableHeader columnKey="priority" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Priority</SortableHeader>
                  <SortableHeader columnKey="assignee" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Assignee</SortableHeader>
                  <SortableHeader columnKey="subject" onSort={handleBugsSort} sortConfig={bugsSortConfig}>Subject</SortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedBugs.length === 0 && !loading && (
                  <tr>
                    <td colSpan="7" className="empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
                      </svg>
                      <span>No open bugs found. Select an environment to load data.</span>
                    </td>
                  </tr>
                )}

                {sortedBugs.map((bug) => (
                  <tr key={bug.bug_id}>
                    <td className="bug-id">#{bug.bug_id}</td>
                    <td className="bug-id">
                      {bug.ticket_id ? (
                        <span>
                          <span 
                            className="clickable-ticket"
                            onClick={() => handleTicketClick(bug.ticket_id)}
                            style={{ cursor: 'pointer', color: '#6366f1' }}
                          >
                            #{bug.ticket_id}
                          </span>
                          <TicketExternalLink ticketId={bug.ticket_id} />
                        </span>
                      ) : '—'}
                    </td>
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
                    <td className="assignee">
                      <span 
                        className={isValidEmployee(bug.assignee) ? 'clickable-name' : ''}
                        onClick={() => handleNameClick(bug.assignee)}
                        style={isValidEmployee(bug.assignee) ? { cursor: 'pointer', color: '#6366f1' } : {}}
                      >
                        {bug.assignee || "Unassigned"}
                      </span>
                    </td>
                    <td className="subject">{bug.subject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

export default AllBugsDashboard;
