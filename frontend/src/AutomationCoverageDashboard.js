import React, { useState, useEffect, useCallback } from 'react';
import { Pie, Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { apiFetch, API_BASE } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './dashboard.css';
import './AutomationCoverageDashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const BACKEND_URL = (API_BASE || '').replace(/\/$/, '');

const TABS = [
  { id: 'search', label: 'Ticket Search', icon: '🔍' },
  { id: 'overall-functionality', label: 'Overall Functionality', icon: '🌐' },
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'progress', label: 'Automation Progress', icon: '📈' },
  { id: 'planned-cases', label: 'Planned Cases', icon: '📝' },
  { id: 'automated-cases', label: 'Automated Cases', icon: '✅' },
  { id: 'test-cases', label: 'Test Cases', icon: '📋' },
  { id: 'effort', label: 'Effort Tracking', icon: '⏱️' },
];

const PERIOD_OPTIONS = [
  { value: '', label: 'All Time' },
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

const CANDIDATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'None', label: 'None' },
];

function AutomationCoverageDashboard() {
  useAuth();
  const [activeTab, setActiveTab] = useState('search');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [effort, setEffort] = useState(null);
  const [testRuns, setTestRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [reusability, setReusability] = useState(null);
  const [showRunSelector, setShowRunSelector] = useState(false);
  const [pendingTicketId, setPendingTicketId] = useState(null);
  
  // Planned Cases tab state
  const [plannedCasesData, setPlannedCasesData] = useState(null);
  const [plannedPeriod, setPlannedPeriod] = useState('');
  const [plannedCandidate, setPlannedCandidate] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [plannedLoading, setPlannedLoading] = useState(false);
  
  // Automated Cases tab state
  const [automatedCasesData, setAutomatedCasesData] = useState(null);
  const [automatedPeriod, setAutomatedPeriod] = useState('');
  const [automatedCandidate, setAutomatedCandidate] = useState('');
  const [automatedStartDate, setAutomatedStartDate] = useState('');
  const [automatedEndDate, setAutomatedEndDate] = useState('');
  const [automatedLoading, setAutomatedLoading] = useState(false);
  
  // Workflow summary
  const [workflowSummary, setWorkflowSummary] = useState(null);
  
  const [overallMetrics, setOverallMetrics] = useState(null);
  const [overallFunctionality, setOverallFunctionality] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  const [automationProgress, setAutomationProgress] = useState(null);

  const searchTickets = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const response = await apiFetch(`${BACKEND_URL}/automation/search-tickets?query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      searchTickets(searchQuery);
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, searchTickets]);

  const loadTicketData = useCallback(async (ticketId, runId = null) => {
    setLoading(true);
    setError(null);
    
    try {
      // First, fetch runs to check if there are multiple
      const runsRes = await apiFetch(`${BACKEND_URL}/automation/test-runs?ticket_id=${ticketId}`);
      const runsData = runsRes.ok ? await runsRes.json() : [];
      
      // If multiple runs and no run selected, show run selector
      if (runsData.length > 1 && !runId) {
        setTestRuns(runsData);
        setPendingTicketId(ticketId);
        setShowRunSelector(true);
        setLoading(false);
        return;
      }
      
      // Use provided runId or first run
      const selectedRun = runId || (runsData.length > 0 ? runsData[0].run_id : null);
      
      // Build query params
      const params = new URLSearchParams();
      params.append('ticket_id', ticketId);
      if (selectedRun) params.append('run_id', selectedRun);
      const queryString = params.toString();
      
      const [summaryRes, casesRes, effortRes, reusabilityRes, progressRes] = await Promise.all([
        apiFetch(`${BACKEND_URL}/automation/summary?${queryString}`),
        apiFetch(`${BACKEND_URL}/automation/test-cases?${queryString}`),
        apiFetch(`${BACKEND_URL}/automation/effort?${queryString}`),
        apiFetch(`${BACKEND_URL}/automation/reusability-metrics?${queryString}`),
        apiFetch(`${BACKEND_URL}/automation/progress?${queryString}`),
      ]);

      if (!summaryRes.ok) {
        throw new Error(`Ticket ${ticketId} not found in automation data`);
      }

      const summaryData = await summaryRes.json();
      const casesData = casesRes.ok ? await casesRes.json() : [];
      const effortData = effortRes.ok ? await effortRes.json() : null;
      const reusabilityData = reusabilityRes.ok ? await reusabilityRes.json() : null;
      const progressData = progressRes.ok ? await progressRes.json() : null;

      setSummary(summaryData);
      setTestCases(casesData);
      setEffort(effortData);
      setTestRuns(runsData);
      setSelectedRunId(selectedRun);
      setReusability(reusabilityData);
      setAutomationProgress(progressData);
      setSelectedTicketId(ticketId);
      setShowRunSelector(false);
      setPendingTicketId(null);
      
      setActiveTab('overview');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGlobalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, casesRes, effortRes, runsRes, reusabilityRes, progressRes] = await Promise.all([
        apiFetch(`${BACKEND_URL}/automation/summary`),
        apiFetch(`${BACKEND_URL}/automation/test-cases`),
        apiFetch(`${BACKEND_URL}/automation/effort`),
        apiFetch(`${BACKEND_URL}/automation/test-runs`),
        apiFetch(`${BACKEND_URL}/automation/reusability-metrics`),
        apiFetch(`${BACKEND_URL}/automation/progress`),
      ]);

      const summaryData = summaryRes.ok ? await summaryRes.json() : null;
      const casesData = casesRes.ok ? await casesRes.json() : [];
      const effortData = effortRes.ok ? await effortRes.json() : null;
      const runsData = runsRes.ok ? await runsRes.json() : [];
      const reusabilityData = reusabilityRes.ok ? await reusabilityRes.json() : null;
      const progressData = progressRes.ok ? await progressRes.json() : null;

      setSummary(summaryData);
      setTestCases(casesData);
      setEffort(effortData);
      setTestRuns(runsData);
      setSelectedRunId(runsData.length > 0 ? runsData[0].run_id : null);
      setReusability(reusabilityData);
      setAutomationProgress(progressData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const submitTicketSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    const numericId = Number(trimmed);
    if (Number.isInteger(numericId) && numericId > 0) {
      await loadTicketData(numericId);
      return;
    }

    const exactMatch = searchResults.find(
      (ticket) => String(ticket.ticket_id) === trimmed
    );
    if (exactMatch) {
      await loadTicketData(exactMatch.ticket_id);
    } else if (searchResults.length === 1) {
      await loadTicketData(searchResults[0].ticket_id);
    } else {
      setError('Enter a valid numeric ticket ID');
    }
  }, [searchQuery, searchResults, loadTicketData]);

  const loadOverallMetrics = useCallback(async (ticketId = null) => {
    try {
      const params = new URLSearchParams();
      if (ticketId) params.append('ticket_id', ticketId);
      const qs = params.toString();
      const response = await apiFetch(
        `${BACKEND_URL}/automation/dashboard-metrics${qs ? `?${qs}` : ''}`
      );
      if (response.ok) {
        setOverallMetrics(await response.json());
      }
    } catch (err) {
      console.error('Failed to load overall metrics:', err);
    }
  }, []);

  const loadOverallFunctionality = useCallback(async () => {
    try {
      const response = await apiFetch(`${BACKEND_URL}/automation/overall-functionality`);
      if (response.ok) {
        setOverallFunctionality(await response.json());
      }
    } catch (err) {
      console.error('Failed to load overall functionality metrics:', err);
    }
  }, []);

  const loadPlannedCases = useCallback(async () => {
    setPlannedLoading(true);
    try {
      const params = new URLSearchParams();
      if (plannedPeriod && plannedPeriod !== 'custom') params.append('period', plannedPeriod);
      if (plannedCandidate) params.append('automation_candidate', plannedCandidate);
      if (plannedPeriod === 'custom' && plannedStartDate) params.append('start_date', plannedStartDate);
      if (plannedPeriod === 'custom' && plannedEndDate) params.append('end_date', plannedEndDate);
      // Note: Planned Cases tab always shows global data, not filtered by searched ticket
      
      const response = await apiFetch(`${BACKEND_URL}/automation/planned-cases?${params.toString()}`);
      if (response.ok) {
        setPlannedCasesData(await response.json());
      }
    } catch (err) {
      console.error('Failed to load planned cases:', err);
    } finally {
      setPlannedLoading(false);
    }
  }, [plannedPeriod, plannedCandidate, plannedStartDate, plannedEndDate]);

  const loadAutomatedCases = useCallback(async () => {
    setAutomatedLoading(true);
    try {
      const params = new URLSearchParams();
      if (automatedPeriod && automatedPeriod !== 'custom') params.append('period', automatedPeriod);
      if (automatedCandidate) params.append('automation_candidate', automatedCandidate);
      if (automatedPeriod === 'custom' && automatedStartDate) params.append('start_date', automatedStartDate);
      if (automatedPeriod === 'custom' && automatedEndDate) params.append('end_date', automatedEndDate);
      // Note: Automated Cases tab always shows global data, not filtered by searched ticket
      
      const response = await apiFetch(`${BACKEND_URL}/automation/automated-cases?${params.toString()}`);
      if (response.ok) {
        setAutomatedCasesData(await response.json());
      }
    } catch (err) {
      console.error('Failed to load automated cases:', err);
    } finally {
      setAutomatedLoading(false);
    }
  }, [automatedPeriod, automatedCandidate, automatedStartDate, automatedEndDate]);

  const loadWorkflowSummary = useCallback(async (ticketId = null) => {
    try {
      const params = new URLSearchParams();
      if (ticketId) params.append('ticket_id', ticketId);
      
      const response = await apiFetch(`${BACKEND_URL}/automation/workflow-summary?${params.toString()}`);
      if (response.ok) {
        setWorkflowSummary(await response.json());
      }
    } catch (err) {
      console.error('Failed to load workflow summary:', err);
    }
  }, []);

  useEffect(() => {
    loadOverallMetrics();
    loadOverallFunctionality();
    loadGlobalData();
    loadWorkflowSummary();
  }, [loadOverallMetrics, loadOverallFunctionality, loadGlobalData, loadWorkflowSummary]);

  useEffect(() => {
    loadOverallMetrics(selectedTicketId);
    loadWorkflowSummary(selectedTicketId);
  }, [selectedTicketId, loadOverallMetrics, loadWorkflowSummary]);

  useEffect(() => {
    if (activeTab === 'planned-cases') {
      loadPlannedCases();
    }
  }, [activeTab, loadPlannedCases]);

  useEffect(() => {
    if (activeTab === 'automated-cases') {
      loadAutomatedCases();
    }
  }, [activeTab, loadAutomatedCases]);

  const handleRunSelection = useCallback((runId) => {
    if (pendingTicketId) {
      loadTicketData(pendingTicketId, runId);
    }
  }, [pendingTicketId, loadTicketData]);

  const handleViewAllRuns = useCallback(() => {
    if (pendingTicketId) {
      loadTicketData(pendingTicketId, 'all');
    }
  }, [pendingTicketId, loadTicketData]);

  const cancelRunSelection = useCallback(() => {
    setShowRunSelector(false);
    setPendingTicketId(null);
    setTestRuns([]);
  }, []);

  const syncFromTestRail = useCallback(async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await apiFetch(`${BACKEND_URL}/automation/sync`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        setSyncMessage({ type: 'success', text: 'Data synced successfully from TestRail!' });
        loadOverallMetrics(selectedTicketId);
        loadOverallFunctionality();
        loadWorkflowSummary(selectedTicketId);
        if (selectedTicketId) {
          loadTicketData(selectedTicketId);
        } else {
          loadGlobalData();
        }
      } else {
        setSyncMessage({ type: 'error', text: data.message || 'Sync failed' });
      }
    } catch (err) {
      setSyncMessage({ type: 'error', text: 'Failed to sync: ' + err.message });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  }, [loadOverallMetrics, loadOverallFunctionality, loadWorkflowSummary, selectedTicketId, loadTicketData, loadGlobalData]);

  const refreshData = useCallback(async () => {
    loadOverallMetrics(selectedTicketId);
    loadOverallFunctionality();
    loadWorkflowSummary(selectedTicketId);
    if (selectedTicketId) {
      loadTicketData(selectedTicketId);
    } else {
      loadGlobalData();
    }
  }, [loadOverallMetrics, loadOverallFunctionality, loadWorkflowSummary, selectedTicketId, loadTicketData, loadGlobalData]);

  const automatedVsManualChartData = summary ? {
    labels: ['Automated', 'Manual'],
    datasets: [{
      data: [summary.automated.count, summary.manual.count],
      backgroundColor: ['#27ae60', '#3498db'],
      borderColor: ['#1e8449', '#2980b9'],
      borderWidth: 2,
    }]
  } : null;

  const statusBreakdownChartData = summary ? {
    labels: ['Passed', 'Failed', 'Blocked', 'Retest', 'Untested'],
    datasets: [
      {
        label: 'Automated',
        data: [
          summary.automated.passed,
          summary.automated.failed,
          summary.automated.blocked,
          summary.automated.retest,
          summary.automated.untested
        ],
        backgroundColor: 'rgba(39, 174, 96, 0.8)',
        borderColor: '#27ae60',
        borderWidth: 1,
      },
      {
        label: 'Manual',
        data: [
          summary.manual.passed,
          summary.manual.failed,
          summary.manual.blocked,
          summary.manual.retest,
          summary.manual.untested
        ],
        backgroundColor: 'rgba(52, 152, 219, 0.8)',
        borderColor: '#3498db',
        borderWidth: 1,
      }
    ]
  } : null;

  const reusabilityChartData = reusability && reusability.reusability_breakdown ? {
    labels: Object.keys(reusability.reusability_breakdown),
    datasets: [{
      data: Object.values(reusability.reusability_breakdown).map(r => r.total),
      backgroundColor: ['#9b59b6', '#e67e22', '#1abc9c', '#95a5a6'],
      borderWidth: 2,
    }]
  } : null;

  const renderRunSelectorModal = () => {
    if (!showRunSelector || testRuns.length === 0) return null;
    
    return (
      <div className="auto-modal-overlay">
        <div className="auto-modal auto-run-selector-modal">
          <div className="auto-modal-header">
            <h3>Select Test Run</h3>
            <button className="auto-modal-close" onClick={cancelRunSelection}>&times;</button>
          </div>
          <div className="auto-modal-body">
            <p className="auto-run-selector-desc">
              Ticket <strong>#{pendingTicketId}</strong> has <strong>{testRuns.length} test runs</strong>. 
              Select a specific run to view its data, or view all runs combined.
            </p>
            <div className="auto-run-selector-list">
              {testRuns.map(run => (
                <div 
                  key={run.run_id} 
                  className="auto-run-selector-item"
                  onClick={() => handleRunSelection(run.run_id)}
                >
                  <div className="auto-run-selector-item-header">
                    <span className="auto-run-selector-id">Run #{run.run_id}</span>
                    <span className="auto-run-selector-date">
                      {run.created_on ? new Date(run.created_on).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div className="auto-run-selector-item-name">{run.name}</div>
                  <div className="auto-run-selector-item-stats">
                    <span className="auto-run-stat">
                      <span className="auto-run-stat-value">{run.total_cases}</span> Total
                    </span>
                    <span className="auto-run-stat auto-run-stat-green">
                      <span className="auto-run-stat-value">{run.automated_count}</span> Automated
                    </span>
                    <span className="auto-run-stat auto-run-stat-blue">
                      <span className="auto-run-stat-value">{run.manual_count}</span> Manual
                    </span>
                    <span className="auto-run-stat auto-run-stat-purple">
                      <span className="auto-run-stat-value">{run.automation_percentage}%</span>
                    </span>
                  </div>
                  <div className="auto-run-selector-item-progress">
                    <div 
                      className="auto-run-selector-item-progress-fill"
                      style={{ width: `${run.automation_percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="auto-modal-footer">
            <button className="btn btn-secondary" onClick={cancelRunSelection}>Cancel</button>
            <button className="btn btn-primary" onClick={handleViewAllRuns}>View All Runs Combined</button>
          </div>
        </div>
      </div>
    );
  };

  const renderSearchTab = () => (
    <div className="auto-search-container">
      {renderRunSelectorModal()}
      
      <div className="auto-search-box">
        <h2>Search Ticket for Automation Coverage</h2>
        <p className="auto-search-desc">
          Enter a ticket ID to view automation vs manual test execution breakdown
        </p>
        <div className="auto-search-input-wrapper">
          <input
            type="text"
            className="auto-search-input"
            placeholder="Enter Ticket ID (e.g., 18400)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTicketSearch();
              }
            }}
          />
          <button className="btn btn-primary auto-search-btn" onClick={submitTicketSearch}>
            Search
          </button>
          {searchLoading && <span className="auto-search-spinner"></span>}
        </div>
        
        {searchResults.length > 0 && (
          <div className="auto-search-results">
            {searchResults.map(ticket => (
              <div
                key={ticket.ticket_id}
                className="auto-search-result-item"
                onClick={() => loadTicketData(ticket.ticket_id)}
              >
                <div className="auto-search-result-id">#{ticket.ticket_id}</div>
                <div className="auto-search-result-info">
                  <span className="auto-search-result-title">{ticket.title}</span>
                  <span className="auto-search-result-stats">
                    {ticket.total_cases} cases | {ticket.automation_percentage}% automated
                    {ticket.run_count > 1 && <span className="auto-search-result-runs"> | {ticket.run_count} runs</span>}
                  </span>
                </div>
                <div className="auto-search-result-bar">
                  <div 
                    className="auto-search-result-bar-fill"
                    style={{ width: `${ticket.automation_percentage}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading && (
          <div className="auto-search-no-results">
            No tickets found with automation data for "{searchQuery}"
          </div>
        )}
      </div>

      {selectedTicketId && overallMetrics && (
        <div className="auto-overall-metrics">
          <h3>Overall Automation Coverage</h3>
          <div className="auto-overall-widgets">
            <div className="auto-widget auto-widget-blue">
              <div className="auto-widget-value">{overallMetrics.total_cases}</div>
              <div className="auto-widget-label">Total Test Cases</div>
            </div>
            <div className="auto-widget auto-widget-green">
              <div className="auto-widget-value">{overallMetrics.total_automated}</div>
              <div className="auto-widget-label">Automated Cases</div>
            </div>
            <div className="auto-widget auto-widget-orange">
              <div className="auto-widget-value">{overallMetrics.total_manual}</div>
              <div className="auto-widget-label">Manual Cases</div>
            </div>
            <div className="auto-widget auto-widget-purple">
              <div className="auto-widget-value">{overallMetrics.overall_automation_percentage}%</div>
              <div className="auto-widget-label">Automation Coverage</div>
            </div>
          </div>
          <div className="auto-overall-widgets" style={{marginTop: '0.75rem'}}>
            <div className="auto-widget auto-widget-success-light">
              <div className="auto-widget-value">{overallMetrics.candidates_yes || 0}</div>
              <div className="auto-widget-label">Candidates: Yes</div>
            </div>
            <div className="auto-widget auto-widget-danger-light">
              <div className="auto-widget-value">{overallMetrics.candidates_no || 0}</div>
              <div className="auto-widget-label">Candidates: No</div>
            </div>
            <div className="auto-widget auto-widget-gray">
              <div className="auto-widget-value">{overallMetrics.candidates_none || 0}</div>
              <div className="auto-widget-label">Not Set</div>
            </div>
            <div className="auto-widget auto-widget-teal">
              <div className="auto-widget-value">{overallMetrics.tickets_with_automation}</div>
              <div className="auto-widget-label">Tickets Tracked</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderOverallFunctionalityTab = () => {
    if (!overallFunctionality || !overallFunctionality.overall) {
      return <div className="auto-no-data">No overall functionality data available</div>;
    }

    const overall = overallFunctionality.overall;
    const rows = overallFunctionality.by_functionality || [];
    const sectionRows = overallFunctionality.by_section || [];
    const topRows = rows.slice(0, 10);
    const topSectionRows = sectionRows.slice(0, 10);
    const totalCoreCases = overall.total_core_cases || 0;
    const automatedCases = overall.automated_cases || 0;
    const plannedCases = overall.planned_cases || 0;
    const candidatesYes = overall.candidates_yes || 0;
    const candidatesNo = overall.candidates_no || 0;
    const candidatesNone = overall.candidates_none || 0;
    // Remaining to automate = Candidates (Yes) - Automated
    const remainingToAutomate = overall.remaining_to_automate || Math.max(0, candidatesYes - automatedCases);
    // Automation % is based on candidates_yes (target to automate)
    const automationPct = overall.automation_percentage || 0;
    const topStatusBreakdown = Object.entries(overall.status_breakdown || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    const functionalityChartData = {
      labels: topRows.map((r) => r.functionality || 'Unknown'),
      datasets: [
        {
          label: 'Automated',
          data: topRows.map((r) => r.automated_cases),
          backgroundColor: '#27ae60',
        },
        {
          label: 'Manual',
          data: topRows.map((r) => r.manual_cases),
          backgroundColor: '#3498db',
        }
      ]
    };

    const sectionChartData = {
      labels: topSectionRows.map((r) => r.section || 'Unknown'),
      datasets: [
        {
          label: 'Automated',
          data: topSectionRows.map((r) => r.automated_cases),
          backgroundColor: '#27ae60',
        },
        {
          label: 'Manual',
          data: topSectionRows.map((r) => r.manual_cases),
          backgroundColor: '#3498db',
        }
      ]
    };

    // Chart shows Automated vs Remaining to Automate (from candidates)
    const overallAutomationChartData = {
      labels: ['Automated', 'Remaining to Automate'],
      datasets: [
        {
          data: [automatedCases, remainingToAutomate],
          backgroundColor: ['#27ae60', '#f59e0b'],
          borderWidth: 0,
        },
      ],
    };

    return (
      <div className="auto-overall-functionality">
        <div className="auto-overall-header">
          <h2>Core Cases - Overall Automation Status</h2>
          <p>Unique test case level metrics across Project 18</p>
        </div>

        <div className="auto-overall-hero-grid">
          <div className="auto-widgets-row auto-overall-kpi-grid">
            <div className="auto-widget auto-widget-blue">
              <div className="auto-widget-value">{totalCoreCases}</div>
              <div className="auto-widget-label">Total Core Cases</div>
            </div>
            <div className="auto-widget auto-widget-teal">
              <div className="auto-widget-value">{candidatesYes}</div>
              <div className="auto-widget-label">To Be Automated</div>
            </div>
            <div className="auto-widget auto-widget-green">
              <div className="auto-widget-value">{automatedCases}</div>
              <div className="auto-widget-label">Automated Cases</div>
            </div>
            <div className="auto-widget auto-widget-cyan">
              <div className="auto-widget-value">{plannedCases}</div>
              <div className="auto-widget-label">Planned Cases</div>
            </div>
            <div className="auto-widget auto-widget-orange">
              <div className="auto-widget-value">{remainingToAutomate}</div>
              <div className="auto-widget-label">Remaining to Automate</div>
            </div>
            <div className="auto-widget auto-widget-purple">
              <div className="auto-widget-value">{automationPct}%</div>
              <div className="auto-widget-label">Automation % (of Candidates)</div>
            </div>
          </div>

          <div className="auto-overall-donut-card">
            <h3>Overall Automation %</h3>
            <div className="auto-chart-container auto-chart-doughnut">
              <Doughnut
                data={overallAutomationChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom' },
                  },
                }}
              />
            </div>
            <div className="auto-overall-donut-value">{automationPct}%</div>
          </div>
        </div>

        {/* Automation Candidates Summary */}
        <div className="auto-candidate-summary">
          <h3>Automation Candidates</h3>
          <div className="auto-candidate-cards">
            <div className="auto-candidate-card auto-candidate-card-yes">
              <div className="auto-candidate-card-value">{candidatesYes}</div>
              <div className="auto-candidate-card-label">Candidate: Yes</div>
              <div className="auto-candidate-card-desc">Should be automated</div>
            </div>
            <div className="auto-candidate-card auto-candidate-card-no">
              <div className="auto-candidate-card-value">{candidatesNo}</div>
              <div className="auto-candidate-card-label">Candidate: No</div>
              <div className="auto-candidate-card-desc">Out of scope</div>
            </div>
            <div className="auto-candidate-card auto-candidate-card-none">
              <div className="auto-candidate-card-value">{candidatesNone}</div>
              <div className="auto-candidate-card-label">Not Set</div>
              <div className="auto-candidate-card-desc">Needs review</div>
            </div>
          </div>
        </div>

        {topStatusBreakdown.length > 0 && (
          <div className="auto-overall-status-row">
            {topStatusBreakdown.map(([status, count]) => (
              <span key={status} className="auto-overall-status-pill">
                {status}: {count}
              </span>
            ))}
          </div>
        )}

        <div className="auto-overall-charts-grid">
          <div className="auto-chart-card">
            <h3>Automation by Functionality (Top 10)</h3>
            <div className="auto-chart-container auto-chart-bar">
              <Bar
                data={functionalityChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y',
                  scales: {
                    x: { stacked: true },
                    y: { stacked: true },
                  },
                  plugins: {
                    legend: { position: 'top' },
                  },
                }}
              />
            </div>
          </div>

          <div className="auto-chart-card">
            <h3>Automation by Section (Top 10)</h3>
            <div className="auto-chart-container auto-chart-bar">
              <Bar
                data={sectionChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y',
                  scales: {
                    x: { stacked: true },
                    y: { stacked: true },
                  },
                  plugins: {
                    legend: { position: 'top' },
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div className="auto-overall-table-tabs">
          <button className="auto-overall-tab-btn auto-overall-tab-active">By Functionality</button>
          <button className="auto-overall-tab-btn">By Section</button>
        </div>

        <div className="auto-overall-split-tables">
          <div className="auto-table-card">
            <h3>Functionality</h3>
            <div className="auto-table-container">
              <table className="auto-data-table">
                <thead>
                  <tr>
                    <th>Functionality</th>
                    <th>Total</th>
                    <th>Automated</th>
                    <th>Manual</th>
                    <th>Automation %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.functionality}-${index}`}>
                      <td className="auto-cell-title">{row.functionality || 'Unknown'}</td>
                      <td>{row.total_cases}</td>
                      <td className="auto-cell-green">{row.automated_cases}</td>
                      <td>{row.manual_cases}</td>
                      <td>
                        <div className="auto-progress-bar-cell">
                          <div className="auto-mini-progress">
                            <div className="auto-mini-progress-fill" style={{ width: `${row.automation_percentage}%` }}></div>
                          </div>
                          <span>{row.automation_percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="auto-table-card">
            <h3>Section</h3>
            <div className="auto-table-container">
              <table className="auto-data-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Total</th>
                    <th>Automated</th>
                    <th>Manual</th>
                    <th>Automation %</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map((row, index) => (
                    <tr key={`${row.section}-${index}`}>
                      <td className="auto-cell-title">{row.section || 'Unknown'}</td>
                      <td>{row.total_cases}</td>
                      <td className="auto-cell-green">{row.automated_cases}</td>
                      <td>{row.manual_cases}</td>
                      <td>
                        <div className="auto-progress-bar-cell">
                          <div className="auto-mini-progress">
                            <div className="auto-mini-progress-fill" style={{ width: `${row.automation_percentage}%` }}></div>
                          </div>
                          <span>{row.automation_percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOverviewTab = () => {
    if (!summary) {
      return <div className="auto-no-data">Select a ticket to view automation coverage</div>;
    }
    const selectedRun = testRuns.find((run) => run.run_id === selectedRunId) || null;

    return (
      <div className="auto-overview">
        <div className="auto-ticket-header">
          <h2>{selectedTicketId ? `Ticket #${selectedTicketId} - Automation Coverage` : 'Overall Automation Coverage'}</h2>
          <div className="auto-ticket-header-actions">
            {selectedTicketId && testRuns.length > 1 && (
              <div className="auto-run-dropdown">
                <label>View Run:</label>
                <select 
                  value={selectedRunId || 'all'} 
                  onChange={(e) => {
                    const value = e.target.value;
                    loadTicketData(selectedTicketId, value === 'all' ? 'all' : parseInt(value));
                  }}
                  className="auto-run-select"
                >
                  <option value="all">All Runs Combined</option>
                  {testRuns.map(run => (
                    <option key={run.run_id} value={run.run_id}>
                      Run #{run.run_id} - {run.name} ({run.total_cases} cases)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button className="btn btn-secondary" onClick={() => { setSelectedTicketId(null); setActiveTab('search'); loadGlobalData(); }}>
              Search Another Ticket
            </button>
          </div>
        </div>
        
        {selectedRun && selectedRunId !== 'all' && (
          <div className="auto-selected-run-info">
            <span className="auto-selected-run-badge">
              Viewing: Run #{selectedRun.run_id} - {selectedRun.name}
            </span>
            <span className="auto-selected-run-date">
              Created: {selectedRun.created_on ? new Date(selectedRun.created_on).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        )}
        
        {selectedRunId === 'all' && testRuns.length > 1 && (
          <div className="auto-selected-run-info auto-all-runs-info">
            <span className="auto-selected-run-badge">
              Viewing: All {testRuns.length} Runs Combined
            </span>
          </div>
        )}

        <div className="auto-widgets-row">
          <div className="auto-widget auto-widget-blue">
            <div className="auto-widget-value">{summary.total_cases}</div>
            <div className="auto-widget-label">Total Test Cases</div>
          </div>
          <div className="auto-widget auto-widget-teal">
            <div className="auto-widget-value">{summary.candidates_yes || 0}</div>
            <div className="auto-widget-label">To Be Automated</div>
          </div>
          <div className="auto-widget auto-widget-green">
            <div className="auto-widget-value">{summary.automated.count}</div>
            <div className="auto-widget-label">Automated ({summary.automated.percentage}%)</div>
          </div>
          <div className="auto-widget auto-widget-orange">
            <div className="auto-widget-value">{summary.manual.count}</div>
            <div className="auto-widget-label">Manual ({summary.manual.percentage}%)</div>
          </div>
          <div className="auto-widget auto-widget-purple">
            <div className="auto-widget-value">{summary.automation_coverage}%</div>
            <div className="auto-widget-label">Automation Coverage</div>
          </div>
        </div>

        {/* Automation Candidates */}
        {(summary.candidates_yes !== undefined || summary.candidates_no !== undefined) && (
          <div className="auto-candidate-summary">
            <h3>Automation Candidates</h3>
            <div className="auto-candidate-cards">
              <div className="auto-candidate-card auto-candidate-card-yes">
                <div className="auto-candidate-card-value">{summary.candidates_yes || 0}</div>
                <div className="auto-candidate-card-label">Candidate: Yes</div>
              </div>
              <div className="auto-candidate-card auto-candidate-card-no">
                <div className="auto-candidate-card-value">{summary.candidates_no || 0}</div>
                <div className="auto-candidate-card-label">Candidate: No</div>
              </div>
              <div className="auto-candidate-card auto-candidate-card-none">
                <div className="auto-candidate-card-value">{summary.candidates_none || 0}</div>
                <div className="auto-candidate-card-label">Not Set</div>
              </div>
            </div>
          </div>
        )}

        <div className="auto-charts-row">
          <div className="auto-chart-card">
            <h3>Automated vs Manual Distribution</h3>
            <div className="auto-chart-container">
              {automatedVsManualChartData && (
                <Doughnut 
                  data={automatedVsManualChartData} 
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' }
                    }
                  }}
                />
              )}
            </div>
          </div>

          <div className="auto-chart-card">
            <h3>Pass/Fail Breakdown by Execution Type</h3>
            <div className="auto-chart-container">
              {statusBreakdownChartData && (
                <Bar 
                  data={statusBreakdownChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' }
                    },
                    scales: {
                      x: { stacked: false },
                      y: { beginAtZero: true }
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="auto-tables-row">
          <div className="auto-table-card">
            <h3>Automated Execution Summary</h3>
            <table className="auto-data-table">
              <tbody>
                <tr>
                  <td>Total Cases</td>
                  <td className="auto-cell-value">{summary.automated.count}</td>
                </tr>
                <tr>
                  <td>Passed</td>
                  <td className="auto-cell-green">{summary.automated.passed}</td>
                </tr>
                <tr>
                  <td>Failed</td>
                  <td className="auto-cell-red">{summary.automated.failed}</td>
                </tr>
                <tr>
                  <td>Blocked</td>
                  <td className="auto-cell-orange">{summary.automated.blocked}</td>
                </tr>
                <tr>
                  <td>Retest</td>
                  <td className="auto-cell-value">{summary.automated.retest}</td>
                </tr>
                <tr>
                  <td>Untested</td>
                  <td className="auto-cell-muted">{summary.automated.untested}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="auto-table-card">
            <h3>Manual Execution Summary</h3>
            <table className="auto-data-table">
              <tbody>
                <tr>
                  <td>Total Cases</td>
                  <td className="auto-cell-value">{summary.manual.count}</td>
                </tr>
                <tr>
                  <td>Passed</td>
                  <td className="auto-cell-green">{summary.manual.passed}</td>
                </tr>
                <tr>
                  <td>Failed</td>
                  <td className="auto-cell-red">{summary.manual.failed}</td>
                </tr>
                <tr>
                  <td>Blocked</td>
                  <td className="auto-cell-orange">{summary.manual.blocked}</td>
                </tr>
                <tr>
                  <td>Retest</td>
                  <td className="auto-cell-value">{summary.manual.retest}</td>
                </tr>
                <tr>
                  <td>Untested</td>
                  <td className="auto-cell-muted">{summary.manual.untested}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {reusabilityChartData && (
            <div className="auto-table-card">
              <h3>Reusability Frequency</h3>
              <div className="auto-chart-container-small">
                <Pie 
                  data={reusabilityChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' }
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {testRuns.length > 0 && (
          <div className="auto-runs-section">
            <h3>Test Runs</h3>
            <div className="auto-widgets-row">
              <div className="auto-widget auto-widget-blue">
                <div className="auto-widget-value">{overallMetrics?.total_runs ?? 0}</div>
                <div className="auto-widget-label">Total Runs (System)</div>
              </div>
              <div className="auto-widget auto-widget-green">
                <div className="auto-widget-value">{overallMetrics?.runs_with_automated_cases ?? 0}</div>
                <div className="auto-widget-label">Runs with Automated Cases</div>
              </div>
              <div className="auto-widget auto-widget-orange">
                <div className="auto-widget-value">{overallMetrics?.runs_with_manual_cases ?? 0}</div>
                <div className="auto-widget-label">Runs with Manual Cases</div>
              </div>
              <div className="auto-widget auto-widget-purple">
                <div className="auto-widget-value">{selectedRun ? selectedRun.run_id : '-'}</div>
                <div className="auto-widget-label">Selected Run</div>
              </div>
              <div className="auto-widget auto-widget-teal">
                <div className="auto-widget-value">{selectedRun ? `${selectedRun.automated_count}/${selectedRun.manual_count}` : '-'}</div>
                <div className="auto-widget-label">Selected Run A/M</div>
              </div>
            </div>
            <div className="auto-runs-table-container">
              <table className="auto-data-table auto-runs-table">
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Name</th>
                    <th>Total</th>
                    <th>Automated</th>
                    <th>Manual</th>
                    <th>Auto %</th>
                    <th>Pass Rate</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {testRuns.map(run => (
                    <tr
                      key={run.run_id}
                      className={selectedRunId === run.run_id ? 'auto-row-selected' : ''}
                      onClick={() => setSelectedRunId(run.run_id)}
                      style={{ cursor: 'pointer' }}
                      title="Click to select this run"
                    >
                      <td className="auto-cell-mono">{run.run_id}</td>
                      <td>{run.name}</td>
                      <td>{run.total_cases}</td>
                      <td className="auto-cell-green">{run.automated_count}</td>
                      <td className="auto-cell-value">{run.manual_count}</td>
                      <td className="auto-cell-purple">{run.automation_percentage}%</td>
                      <td className={run.pass_rate >= 80 ? 'auto-cell-green' : run.pass_rate >= 50 ? 'auto-cell-orange' : 'auto-cell-red'}>
                        {run.pass_rate}%
                      </td>
                      <td>{run.created_on ? new Date(run.created_on).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTestCasesTab = () => {
    if (!testCases.length) {
      return <div className="auto-no-data">No test cases found for the selected ticket</div>;
    }

    const automatedCases = testCases.filter(c => c.is_automated);
    const manualCases = testCases.filter(c => !c.is_automated);
    const showRunColumn = selectedRunId === 'all' || !selectedRunId;

    return (
      <div className="auto-test-cases">
        <div className="auto-ticket-header">
          <h2>{selectedTicketId ? `Test Cases - Ticket #${selectedTicketId}` : 'Test Cases - All Tickets'}</h2>
          <div className="auto-cases-summary">
            <span className="auto-badge auto-badge-green">{automatedCases.length} Automated</span>
            <span className="auto-badge auto-badge-blue">{manualCases.length} Manual</span>
            {selectedRunId && selectedRunId !== 'all' && (
              <span className="auto-badge auto-badge-purple">Run #{selectedRunId}</span>
            )}
          </div>
        </div>

        <div className="auto-cases-table-container">
          <table className="auto-data-table auto-cases-table">
            <thead>
              <tr>
                <th>Case ID</th>
                {showRunColumn && <th>Run ID</th>}
                <th>Title</th>
                <th>Execution</th>
                <th>Status</th>
                <th>Reusability</th>
                <th>Criticality</th>
                <th>Functionality</th>
              </tr>
            </thead>
            <tbody>
              {testCases.map((tc, idx) => (
                <tr key={`${tc.test_id}-${idx}`} className={tc.is_automated ? 'auto-row-automated' : ''}>
                  <td className="auto-cell-mono">C{tc.case_id}</td>
                  {showRunColumn && <td className="auto-cell-mono">{tc.run_id || '-'}</td>}
                  <td className="auto-cell-title">{tc.title}</td>
                  <td>
                    <span className={`auto-exec-badge ${tc.is_automated ? 'auto-exec-automated' : 'auto-exec-manual'}`}>
                      {tc.is_automated ? 'Automated' : 'Manual'}
                    </span>
                  </td>
                  <td>
                    <span className={`auto-status-badge auto-status-${(tc.status_name || 'untested').toLowerCase()}`}>
                      {tc.status_name || 'Untested'}
                    </span>
                  </td>
                  <td>{tc.reusability_frequency || '-'}</td>
                  <td>{tc.business_criticality || '-'}</td>
                  <td>{tc.functionality || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderEffortTab = () => {
    if (!effort) {
      return <div className="auto-no-data">No effort data available for the selected ticket</div>;
    }

    return (
      <div className="auto-effort">
        <div className="auto-ticket-header">
          <h2>{selectedTicketId ? `Automation Effort - Ticket #${selectedTicketId}` : 'Automation Effort - All Tickets'}</h2>
        </div>

        <div className="auto-widgets-row">
          <div className="auto-widget auto-widget-blue">
            <div className="auto-widget-value">{effort.total_estimated_hours}h</div>
            <div className="auto-widget-label">Estimated Hours</div>
          </div>
          <div className="auto-widget auto-widget-green">
            <div className="auto-widget-value">{effort.total_actual_hours}h</div>
            <div className="auto-widget-label">Actual Hours</div>
          </div>
          <div className={`auto-widget ${effort.total_variance && effort.total_variance > 0 ? 'auto-widget-red' : 'auto-widget-teal'}`}>
            <div className="auto-widget-value">
              {effort.total_variance !== null ? `${effort.total_variance > 0 ? '+' : ''}${effort.total_variance}h` : '-'}
            </div>
            <div className="auto-widget-label">Variance</div>
          </div>
          <div className="auto-widget auto-widget-purple">
            <div className="auto-widget-value">
              {effort.efficiency !== null ? `${effort.efficiency}%` : '-'}
            </div>
            <div className="auto-widget-label">Efficiency</div>
          </div>
          <div className="auto-widget auto-widget-orange">
            <div className="auto-widget-value">{effort.cases_count}</div>
            <div className="auto-widget-label">Cases with Effort</div>
          </div>
        </div>

        {effort.cases && effort.cases.length > 0 && (
          <div className="auto-effort-table-container">
            <h3>Effort Details by Test Case</h3>
            <table className="auto-data-table auto-effort-table">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Est. Hours</th>
                  <th>Actual Hours</th>
                  <th>Variance</th>
                  <th>Planned Start</th>
                  <th>Actual Start</th>
                  <th>Actual End</th>
                </tr>
              </thead>
              <tbody>
                {effort.cases.map(c => (
                  <tr key={c.case_id}>
                    <td className="auto-cell-mono">C{c.case_id}</td>
                    <td className="auto-cell-title">{c.title}</td>
                    <td>{c.automation_status || '-'}</td>
                    <td>{c.estimated_hours}h</td>
                    <td>{c.actual_hours}h</td>
                    <td className={c.variance && c.variance > 0 ? 'auto-cell-red' : c.variance && c.variance < 0 ? 'auto-cell-green' : ''}>
                      {c.variance !== null ? `${c.variance > 0 ? '+' : ''}${c.variance}h` : '-'}
                    </td>
                    <td>{c.planned_start ? new Date(c.planned_start).toLocaleDateString() : '-'}</td>
                    <td>{c.actual_start ? new Date(c.actual_start).toLocaleDateString() : '-'}</td>
                    <td>{c.actual_end ? new Date(c.actual_end).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(!effort.cases || effort.cases.length === 0) && (
          <div className="auto-no-effort-data">
            <p>No automation effort hours recorded for test cases in this ticket.</p>
            <p className="auto-help-text">
              Effort data is captured from TestRail custom fields: Automation Estimated Hours, Automation Actual Hours Spent, 
              and automation timeline dates.
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderProgressTab = () => {
    if (!automationProgress) {
      return <div className="auto-no-data">No automation progress data available for the selected ticket</div>;
    }

    const { overall, maintenance_breakdown, by_section, by_functionality } = automationProgress;

    const maintenanceChartData = {
      labels: maintenance_breakdown?.map(m => m.status) || [],
      datasets: [{
        data: maintenance_breakdown?.map(m => m.count) || [],
        backgroundColor: [
          '#10b981', // Ready to use (green)
          '#f59e0b', // Maintenance Required (amber)
          '#3b82f6', // Under Maintenance (blue)
          '#ef4444', // Deprecated (red)
        ],
        borderWidth: 0,
      }],
    };

    const sectionChartData = {
      labels: by_section?.slice(0, 10).map(s => s.section?.length > 20 ? s.section.substring(0, 20) + '...' : (s.section || 'Unknown')) || [],
      datasets: [
        {
          label: 'Automated',
          data: by_section?.slice(0, 10).map(s => s.automated) || [],
          backgroundColor: '#10b981',
        },
        {
          label: 'Remaining',
          data: by_section?.slice(0, 10).map(s => s.remaining) || [],
          backgroundColor: '#e5e7eb',
        },
      ],
    };

    const functionalityChartData = {
      labels: by_functionality?.slice(0, 10).map(f => f.functionality?.length > 20 ? f.functionality.substring(0, 20) + '...' : (f.functionality || 'Unknown')) || [],
      datasets: [
        {
          label: 'Automated',
          data: by_functionality?.slice(0, 10).map(f => f.automated) || [],
          backgroundColor: '#3b82f6',
        },
        {
          label: 'Remaining',
          data: by_functionality?.slice(0, 10).map(f => f.remaining) || [],
          backgroundColor: '#e5e7eb',
        },
      ],
    };

    return (
      <div className="auto-progress">
        <div className="auto-ticket-header">
          <h2>{selectedTicketId ? `Automation Progress - Ticket #${selectedTicketId}` : 'Automation Progress - All Tickets'}</h2>
        </div>

        {/* Overall Progress */}
        <div className="auto-progress-overview">
          <div className="auto-progress-circle-container">
            <div className="auto-progress-circle">
              <svg viewBox="0 0 100 100">
                <circle
                  className="auto-progress-bg"
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  strokeWidth="10"
                />
                <circle
                  className="auto-progress-fill"
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  strokeWidth="10"
                  strokeDasharray={`${(overall?.automation_percentage || 0) * 2.83} 283`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className="auto-progress-text">
                <span className="auto-progress-value">{overall?.automation_percentage || 0}%</span>
                <span className="auto-progress-label">Automated</span>
              </div>
            </div>
          </div>
          <div className="auto-progress-stats">
            <div className="auto-stat-row">
              <span className="auto-stat-label">Total Test Cases</span>
              <span className="auto-stat-value">{overall?.total_cases || 0}</span>
            </div>
            <div className="auto-stat-row">
              <span className="auto-stat-label">Total Cases To Be Automated</span>
              <span className="auto-stat-value auto-stat-purple">{overall?.candidates_yes || 0}</span>
            </div>
            <div className="auto-stat-row">
              <span className="auto-stat-label">Automated Cases</span>
              <span className="auto-stat-value auto-stat-green">{overall?.automated_cases || 0}</span>
            </div>
            <div className="auto-stat-row">
              <span className="auto-stat-label">Planned Cases</span>
              <span className="auto-stat-value auto-stat-blue">{overall?.planned_cases || 0}</span>
            </div>
            <div className="auto-stat-row">
              <span className="auto-stat-label">Remaining to Automate</span>
              <span className="auto-stat-value auto-stat-amber">{overall?.remaining_cases || 0}</span>
            </div>
            <div className="auto-stat-row">
              <span className="auto-stat-label">Not Automatable</span>
              <span className="auto-stat-value auto-stat-gray">{overall?.not_automatable || 0}</span>
            </div>
          </div>
        </div>

        {/* Automation Candidate Summary */}
        <div className="auto-candidate-summary">
          <h3>Automation Candidates</h3>
          <div className="auto-candidate-cards">
            <div className="auto-candidate-card auto-candidate-card-yes">
              <div className="auto-candidate-card-value">{overall?.candidates_yes || 0}</div>
              <div className="auto-candidate-card-label">Candidate: Yes</div>
              <div className="auto-candidate-card-desc">Should be automated</div>
            </div>
            <div className="auto-candidate-card auto-candidate-card-no">
              <div className="auto-candidate-card-value">{overall?.candidates_no || 0}</div>
              <div className="auto-candidate-card-label">Candidate: No</div>
              <div className="auto-candidate-card-desc">Out of scope</div>
            </div>
            <div className="auto-candidate-card auto-candidate-card-none">
              <div className="auto-candidate-card-value">{overall?.candidates_none || 0}</div>
              <div className="auto-candidate-card-label">Not Set</div>
              <div className="auto-candidate-card-desc">Needs review</div>
            </div>
          </div>
        </div>

        {/* Maintenance Breakdown */}
        <div className="auto-widgets-row">
          <div className="auto-chart-widget auto-chart-half">
            <h3>Maintenance Status of Automated Cases</h3>
            {maintenance_breakdown && maintenance_breakdown.length > 0 ? (
              <div className="auto-chart-container auto-chart-doughnut">
                <Doughnut 
                  data={maintenanceChartData} 
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="auto-no-chart-data">No maintenance data available</div>
            )}
          </div>
          <div className="auto-maintenance-summary auto-chart-half">
            <h3>Maintenance Summary</h3>
            {maintenance_breakdown && maintenance_breakdown.length > 0 ? (
              <div className="auto-maintenance-list">
                {maintenance_breakdown.map((item, idx) => (
                  <div key={idx} className="auto-maintenance-item">
                    <span className={`auto-maintenance-dot auto-maintenance-${item.status?.toLowerCase().replace(/\s+/g, '-') || 'unknown'}`}></span>
                    <span className="auto-maintenance-label">{item.status || 'Unknown'}</span>
                    <span className="auto-maintenance-count">{item.count}</span>
                    <span className="auto-maintenance-pct">({item.percentage}%)</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="auto-no-chart-data">No maintenance data available</div>
            )}
          </div>
        </div>

        {/* By Section */}
        <div className="auto-progress-section">
          <h3>Automation Progress by Section</h3>
          {by_section && by_section.length > 0 ? (
            <>
              <div className="auto-chart-container auto-chart-bar">
                <Bar 
                  data={sectionChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    scales: {
                      x: { stacked: true },
                      y: { stacked: true },
                    },
                    plugins: {
                      legend: { position: 'top' },
                    },
                  }}
                />
              </div>
              <table className="auto-data-table auto-progress-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Total Cases</th>
                    <th>Automated</th>
                    <th>Remaining</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {by_section.map((row, idx) => (
                    <tr key={idx}>
                      <td className="auto-cell-title">{row.section || 'Unknown'}</td>
                      <td>{row.total}</td>
                      <td className="auto-cell-green">{row.automated}</td>
                      <td className="auto-cell-amber">{row.remaining}</td>
                      <td>
                        <div className="auto-progress-bar-cell">
                          <div className="auto-mini-progress">
                            <div className="auto-mini-progress-fill" style={{ width: `${row.percentage}%` }}></div>
                          </div>
                          <span>{row.percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="auto-no-chart-data">No section data available</div>
          )}
        </div>

        {/* By Functionality */}
        <div className="auto-progress-section">
          <h3>Automation Progress by Functionality</h3>
          {by_functionality && by_functionality.length > 0 ? (
            <>
              <div className="auto-chart-container auto-chart-bar">
                <Bar 
                  data={functionalityChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    scales: {
                      x: { stacked: true },
                      y: { stacked: true },
                    },
                    plugins: {
                      legend: { position: 'top' },
                    },
                  }}
                />
              </div>
              <table className="auto-data-table auto-progress-table">
                <thead>
                  <tr>
                    <th>Functionality</th>
                    <th>Total Cases</th>
                    <th>Automated</th>
                    <th>Remaining</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {by_functionality.map((row, idx) => (
                    <tr key={idx}>
                      <td className="auto-cell-title">{row.functionality || 'Unknown'}</td>
                      <td>{row.total}</td>
                      <td className="auto-cell-green">{row.automated}</td>
                      <td className="auto-cell-amber">{row.remaining}</td>
                      <td>
                        <div className="auto-progress-bar-cell">
                          <div className="auto-mini-progress">
                            <div className="auto-mini-progress-fill" style={{ width: `${row.percentage}%` }}></div>
                          </div>
                          <span>{row.percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="auto-no-chart-data">No functionality data available</div>
          )}
        </div>
      </div>
    );
  };

  const renderPlannedCasesTab = () => {
    const data = plannedCasesData;
    
    const trendChartData = data && data.by_date && data.by_date.length > 0 ? {
      labels: data.by_date.map(d => d.date),
      datasets: [{
        label: 'Cases Planned',
        data: data.by_date.map(d => d.count),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
      }]
    } : null;

    return (
      <div className="auto-planned-cases">
        <div className="auto-ticket-header">
          <h2>Planned Cases - All Tickets</h2>
        </div>

        {/* Workflow Summary */}
        {workflowSummary && (
          <div className="auto-workflow-summary">
            <div className="auto-workflow-stages">
              <div className="auto-workflow-stage">
                <div className="auto-workflow-value">{workflowSummary.workflow?.candidates_yes || 0}</div>
                <div className="auto-workflow-label">Candidates (Yes)</div>
              </div>
              <div className="auto-workflow-arrow">→</div>
              <div className="auto-workflow-stage auto-workflow-planned">
                <div className="auto-workflow-value">{workflowSummary.workflow?.planned || 0}</div>
                <div className="auto-workflow-label">Planned</div>
              </div>
              <div className="auto-workflow-arrow">→</div>
              <div className="auto-workflow-stage auto-workflow-automated">
                <div className="auto-workflow-value">{workflowSummary.workflow?.automated || 0}</div>
                <div className="auto-workflow-label">Automated</div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="auto-filters-row">
          <div className="auto-filter-group">
            <label>Period</label>
            <select 
              value={plannedPeriod} 
              onChange={(e) => setPlannedPeriod(e.target.value)}
              className="auto-filter-select"
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          {plannedPeriod === 'custom' && (
            <>
              <div className="auto-filter-group">
                <label>Start Date</label>
                <input 
                  type="date" 
                  value={plannedStartDate}
                  onChange={(e) => setPlannedStartDate(e.target.value)}
                  className="auto-filter-input"
                />
              </div>
              <div className="auto-filter-group">
                <label>End Date</label>
                <input 
                  type="date" 
                  value={plannedEndDate}
                  onChange={(e) => setPlannedEndDate(e.target.value)}
                  className="auto-filter-input"
                />
              </div>
            </>
          )}
          
          <div className="auto-filter-group">
            <label>Automation Candidate</label>
            <select 
              value={plannedCandidate} 
              onChange={(e) => setPlannedCandidate(e.target.value)}
              className="auto-filter-select"
            >
              {CANDIDATE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          <button 
            className="btn btn-primary auto-filter-btn"
            onClick={loadPlannedCases}
            disabled={plannedLoading}
          >
            {plannedLoading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>

        {plannedLoading ? (
          <div className="auto-loading-container">
            <div className="auto-loading-spinner"></div>
            <p>Loading planned cases...</p>
          </div>
        ) : data ? (
          <>
            {/* Summary Cards */}
            <div className="auto-widgets-row">
              <div className="auto-widget auto-widget-blue">
                <div className="auto-widget-value">{data.summary?.total_planned || 0}</div>
                <div className="auto-widget-label">Total Planned</div>
              </div>
              <div className="auto-widget auto-widget-green">
                <div className="auto-widget-value">{data.summary?.planned_in_period || 0}</div>
                <div className="auto-widget-label">Planned in Period</div>
              </div>
              <div className="auto-widget auto-widget-orange">
                <div className="auto-widget-value">{data.summary?.candidates_pending_planning || 0}</div>
                <div className="auto-widget-label">Candidates Pending</div>
              </div>
            </div>

            {/* Trend Chart */}
            {trendChartData && (
              <div className="auto-chart-card">
                <h3>Planning Trend</h3>
                <div className="auto-chart-container auto-chart-line">
                  <Line 
                    data={trendChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        y: { beginAtZero: true },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Cases Table */}
            {data.cases && data.cases.length > 0 ? (
              <div className="auto-cases-table-container">
                <h3>Planned Cases ({data.cases.length})</h3>
                <table className="auto-data-table auto-cases-table">
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Title</th>
                      <th>Ticket</th>
                      <th>Candidate</th>
                      <th>Planned On</th>
                      <th>Functionality</th>
                      <th>Criticality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cases.map(tc => (
                      <tr key={tc.test_id || tc.case_id}>
                        <td className="auto-cell-mono">C{tc.case_id}</td>
                        <td className="auto-cell-title">{tc.title}</td>
                        <td className="auto-cell-mono">#{tc.ticket_id}</td>
                        <td>
                          <span className={`auto-candidate-badge auto-candidate-${(tc.automation_candidate || 'none').toLowerCase()}`}>
                            {tc.automation_candidate || 'None'}
                          </span>
                        </td>
                        <td>{tc.planned_on ? new Date(tc.planned_on).toLocaleDateString() : '-'}</td>
                        <td>{tc.functionality || '-'}</td>
                        <td>{tc.business_criticality || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="auto-no-data">No planned cases found for the selected filters</div>
            )}
          </>
        ) : (
          <div className="auto-no-data">Select filters and click Apply to load planned cases</div>
        )}
      </div>
    );
  };

  const renderAutomatedCasesTab = () => {
    const data = automatedCasesData;
    
    const trendChartData = data && data.by_date && data.by_date.length > 0 ? {
      labels: data.by_date.map(d => d.date),
      datasets: [{
        label: 'Cases Automated',
        data: data.by_date.map(d => d.count),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.3,
      }]
    } : null;

    return (
      <div className="auto-automated-cases">
        <div className="auto-ticket-header">
          <h2>Automated Cases - All Tickets</h2>
        </div>

        {/* Workflow Summary */}
        {workflowSummary && (
          <div className="auto-workflow-summary">
            <div className="auto-workflow-stages">
              <div className="auto-workflow-stage">
                <div className="auto-workflow-value">{workflowSummary.workflow?.candidates_yes || 0}</div>
                <div className="auto-workflow-label">Candidates (Yes)</div>
              </div>
              <div className="auto-workflow-arrow">→</div>
              <div className="auto-workflow-stage auto-workflow-planned">
                <div className="auto-workflow-value">{workflowSummary.workflow?.planned || 0}</div>
                <div className="auto-workflow-label">Planned</div>
              </div>
              <div className="auto-workflow-arrow">→</div>
              <div className="auto-workflow-stage auto-workflow-automated">
                <div className="auto-workflow-value">{workflowSummary.workflow?.automated || 0}</div>
                <div className="auto-workflow-label">Automated</div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="auto-filters-row">
          <div className="auto-filter-group">
            <label>Period</label>
            <select 
              value={automatedPeriod} 
              onChange={(e) => setAutomatedPeriod(e.target.value)}
              className="auto-filter-select"
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          {automatedPeriod === 'custom' && (
            <>
              <div className="auto-filter-group">
                <label>Start Date</label>
                <input 
                  type="date" 
                  value={automatedStartDate}
                  onChange={(e) => setAutomatedStartDate(e.target.value)}
                  className="auto-filter-input"
                />
              </div>
              <div className="auto-filter-group">
                <label>End Date</label>
                <input 
                  type="date" 
                  value={automatedEndDate}
                  onChange={(e) => setAutomatedEndDate(e.target.value)}
                  className="auto-filter-input"
                />
              </div>
            </>
          )}
          
          <div className="auto-filter-group">
            <label>Automation Candidate</label>
            <select 
              value={automatedCandidate} 
              onChange={(e) => setAutomatedCandidate(e.target.value)}
              className="auto-filter-select"
            >
              {CANDIDATE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          <button 
            className="btn btn-primary auto-filter-btn"
            onClick={loadAutomatedCases}
            disabled={automatedLoading}
          >
            {automatedLoading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>

        {automatedLoading ? (
          <div className="auto-loading-container">
            <div className="auto-loading-spinner"></div>
            <p>Loading automated cases...</p>
          </div>
        ) : data ? (
          <>
            {/* Summary Cards */}
            <div className="auto-widgets-row">
              <div className="auto-widget auto-widget-green">
                <div className="auto-widget-value">{data.summary?.total_automated || 0}</div>
                <div className="auto-widget-label">Total Automated</div>
              </div>
              <div className="auto-widget auto-widget-blue">
                <div className="auto-widget-value">{data.summary?.automated_in_period || 0}</div>
                <div className="auto-widget-label">Automated in Period</div>
              </div>
              <div className="auto-widget auto-widget-purple">
                <div className="auto-widget-value">{data.summary?.automation_candidates_yes || 0}</div>
                <div className="auto-widget-label">Candidates (Yes)</div>
              </div>
              <div className="auto-widget auto-widget-orange">
                <div className="auto-widget-value">{data.summary?.pending_automation || 0}</div>
                <div className="auto-widget-label">Pending Automation</div>
              </div>
            </div>

            {/* Trend Chart */}
            {trendChartData && (
              <div className="auto-chart-card">
                <h3>Automation Trend</h3>
                <div className="auto-chart-container auto-chart-line">
                  <Line 
                    data={trendChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        y: { beginAtZero: true },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Cases Table */}
            {data.cases && data.cases.length > 0 ? (
              <div className="auto-cases-table-container">
                <h3>Automated Cases ({data.cases.length})</h3>
                <table className="auto-data-table auto-cases-table">
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Title</th>
                      <th>Ticket</th>
                      <th>Candidate</th>
                      <th>Automated On</th>
                      <th>Functionality</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cases.map(tc => (
                      <tr key={tc.test_id || tc.case_id}>
                        <td className="auto-cell-mono">C{tc.case_id}</td>
                        <td className="auto-cell-title">{tc.title}</td>
                        <td className="auto-cell-mono">#{tc.ticket_id}</td>
                        <td>
                          <span className={`auto-candidate-badge auto-candidate-${(tc.automation_candidate || 'none').toLowerCase()}`}>
                            {tc.automation_candidate || 'None'}
                          </span>
                        </td>
                        <td>{tc.automated_on ? new Date(tc.automated_on).toLocaleDateString() : '-'}</td>
                        <td>{tc.functionality || '-'}</td>
                        <td>
                          <span className={`auto-status-badge auto-status-${(tc.status_name || 'untested').toLowerCase()}`}>
                            {tc.status_name || 'Untested'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="auto-no-data">No automated cases found for the selected filters</div>
            )}
          </>
        ) : (
          <div className="auto-no-data">Select filters and click Apply to load automated cases</div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="auto-loading-container">
          <div className="auto-loading-spinner"></div>
          <p>Loading automation coverage data...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="auto-error-container">
          <p>Error: {error}</p>
          <button className="btn btn-primary" onClick={() => setError(null)}>Try Again</button>
        </div>
      );
    }

    switch (activeTab) {
      case 'search':
        return renderSearchTab();
      case 'overall-functionality':
        return renderOverallFunctionalityTab();
      case 'overview':
        return renderOverviewTab();
      case 'progress':
        return renderProgressTab();
      case 'planned-cases':
        return renderPlannedCasesTab();
      case 'automated-cases':
        return renderAutomatedCasesTab();
      case 'test-cases':
        return renderTestCasesTab();
      case 'effort':
        return renderEffortTab();
      default:
        return renderSearchTab();
    }
  };

  return (
    <div className="dashboard-wrapper">
      <AppSidebar />
      <div className="main-content">
        <div className="dashboard-header">
          <div className="header-left">
            <h1>Automation Coverage Dashboard</h1>
            <p className="header-subtitle">
              Track automated vs manual test execution from TestRail
            </p>
          </div>
          <div className="header-actions">
            <button 
              className="btn btn-secondary" 
              onClick={refreshData}
              disabled={syncing}
              title="Refresh data from database"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{marginRight: '0.5rem'}}>
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              Refresh
            </button>
            <button 
              className="btn btn-primary" 
              onClick={syncFromTestRail}
              disabled={syncing}
              title="Sync latest data from TestRail Project 18"
            >
              {syncing ? (
                <>
                  <span className="btn-spinner"></span>
                  Syncing...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{marginRight: '0.5rem'}}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Sync from TestRail
                </>
              )}
            </button>
          </div>
        </div>

        {syncMessage && (
          <div className={`auto-sync-message auto-sync-${syncMessage.type}`}>
            {syncMessage.text}
          </div>
        )}

        <div className="auto-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`auto-tab ${activeTab === tab.id ? 'auto-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              disabled={false}
            >
              <span className="auto-tab-icon">{tab.icon}</span>
              <span className="auto-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="auto-tab-content">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default AutomationCoverageDashboard;
