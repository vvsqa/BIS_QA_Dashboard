import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const SCORE_COLORS = {
  high: 'var(--accent-red, #ef4444)',
  medium: 'var(--accent-amber, #f59e0b)',
  low: 'var(--accent-green, #22c55e)',
};

function getScoreLevel(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function ScoreBar({ score, breakdown }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const level = getScoreLevel(score);
  return (
    <div className="qcq-score-wrapper" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <div className="qcq-score-bar-bg">
        <div className="qcq-score-bar-fill" style={{ width: `${score}%`, background: SCORE_COLORS[level] }} />
      </div>
      <span className="qcq-score-val" style={{ color: SCORE_COLORS[level] }}>{score}</span>
      {showTooltip && breakdown && (
        <div className="qcq-score-tooltip">
          {Object.entries(breakdown).map(([key, v]) => (
            <div key={key} className="qcq-tooltip-row">
              <span className="qcq-tooltip-label">{key}</span>
              <span className="qcq-tooltip-pts">{v.points}/{v.max}</span>
              <span className="qcq-tooltip-detail">{v.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgeingBadge({ days }) {
  let cls = 'qcq-age-fresh';
  if (days >= 15) cls = 'qcq-age-critical';
  else if (days >= 7) cls = 'qcq-age-stale';
  else if (days >= 3) cls = 'qcq-age-aging';
  return <span className={`qcq-age-badge ${cls}`}>{days}d</span>;
}

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

export default function QCQueueDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState(null);
  const [qcFailed, setQcFailed] = useState(null);
  const [bisTesting, setBisTesting] = useState(null);
  const [approvedForLive, setApprovedForLive] = useState(null);
  const [noQaEstimate, setNoQaEstimate] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState(null);
    const [cardFilter, setCardFilter] = useState(null); // null or 'unassigned'|'assigned_not_started'|'in_progress'|'on_hold'|'qc_failed'
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [listPriorityFilter, setListPriorityFilter] = useState('');
  const [listModuleFilter, setListModuleFilter] = useState('');
  const [listTesterFilter, setListTesterFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all'); // 'all', 'Web', 'Mobile'
  const [sortField, setSortField] = useState('priority_score');
  const [sortDir, setSortDir] = useState('desc');
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' or 'module_workload'
  const [moduleWorkload, setModuleWorkload] = useState([]);
  const [modulePipeline, setModulePipeline] = useState([]);
  const [selectedModuleBar, setSelectedModuleBar] = useState(null); // {module, status} for clicked bar segment
  const [selectedPipelineBar, setSelectedPipelineBar] = useState(null); // {module, type} for clicked pipeline bar
  const moduleListRef = useRef(null);
  const pipelineListRef = useRef(null);

  const exportToExcel = async (tickets, filename) => {
    if (!tickets || tickets.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/live/export-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets, filename }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || `${filename}.xlsx`).replace(/"/g, '');
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const safeFetch = async (url) => {
    try {
      return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`);
    } catch (err) {
      console.error(`[QCQueue] Failed to fetch ${url}:`, err.message);
      return null;
    }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queueRes = await safeFetch('/live/qc-queue');
      if (queueRes?.ok) {
        const data = await queueRes.json();
        setQueue(data);
        // QC failed is included in the live response
        if (data.qc_failed) setQcFailed(data.qc_failed);
        if (data.bis_testing) setBisTesting(data.bis_testing);
        if (data.approved_for_live) setApprovedForLive(data.approved_for_live);
        if (data.no_qa_estimate) setNoQaEstimate(data.no_qa_estimate);
        if (data.monthly_summary) setMonthlySummary(data.monthly_summary);
        if (data.module_workload) setModuleWorkload(data.module_workload);
        if (data.module_pipeline) setModulePipeline(data.module_pipeline);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const forceRefresh = async () => {
    await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
    setCardFilter(null); setSelectedModuleBar(null); setSelectedPipelineBar(null);
    setSearchFilter(''); setListPriorityFilter(''); setListModuleFilter(''); setListTesterFilter('');
    fetchAll();
  };

  const toggleExpand = (ticketId) => {
    if (expandedTicket === ticketId) {
      setExpandedTicket(null);
    } else {
      setExpandedTicket(ticketId);
    }
  };

  const filterTickets = (tickets) => {
    if (!searchFilter) return tickets;
    const s = searchFilter.toLowerCase();
    return tickets.filter(t =>
      String(t.ticket_id).includes(s) ||
      (t.title || '').toLowerCase().includes(s) ||
      (t.qc_tester || '').toLowerCase().includes(s) ||
      (t.module || '').toLowerCase().includes(s) ||
      (t.priority || '').toLowerCase().includes(s)
    );
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading QC Queue...</p></div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="error-container"><p>{error}</p><button onClick={fetchAll} className="btn btn-primary">Retry</button></div>
        </main>
      </div>
    );
  }

  const statusCards = queue?.status_cards || {};
  const rawQueue = queue?.queue || [];
  const rawDevTested = queue?.dev_tested || [];
  const rawQcFailed = qcFailed?.tickets || [];
  const rawBisTesting = bisTesting?.tickets || [];
  const rawApprovedForLive = approvedForLive?.tickets || [];
  const rawNoEstimate = noQaEstimate?.tickets || [];

  // Platform filter applied to all data
  const pf = (tickets) => platformFilter === 'all' ? tickets : tickets.filter(t => (t.platform || 'Web') === platformFilter);
  const allQueue = pf(rawQueue);
  const allDevTested = pf(rawDevTested);
  const qcFailedTickets = pf(rawQcFailed);
  const qcFailedCount = qcFailedTickets.length;
  const bisTestingTickets = pf(rawBisTesting);
  const approvedTickets = pf(rawApprovedForLive);
  const noEstimateTickets = pf(rawNoEstimate);

  // Web/Mobile counts for display
  const webCount = rawQueue.filter(t => (t.platform || 'Web') === 'Web').length;
  const mobileCount = rawQueue.filter(t => (t.platform || 'Web') === 'Mobile').length;

  // Computed breakdowns from queue
  const unassignedTickets = allQueue.filter(t => t.status === 'QC Testing' && !t.qc_tester);
  const assignedNotStarted = allQueue.filter(t => t.status === 'QC Testing' && t.qc_tester);
  const inProgressTickets = allQueue.filter(t => t.status === 'QC Testing in Progress');
  const onHoldTickets = allQueue.filter(t => t.status === 'QC Testing Hold');

  // Get the visible list based on card filter
  const getCardFilteredList = () => {
    if (!cardFilter) return null;
    switch (cardFilter) {
      case 'unassigned': return unassignedTickets;
      case 'assigned_not_started': return assignedNotStarted;
      case 'in_progress': return inProgressTickets;
      case 'on_hold': return onHoldTickets;
      case 'qc_failed': return qcFailedTickets;
      case 'bis_testing': return bisTestingTickets;
      case 'approved_for_live': return approvedTickets;
      case 'no_qa_estimate': return noEstimateTickets;
      default: return null;
    }
  };

  const cardFilteredList = getCardFilteredList();
  const cardFilterLabels = {
    unassigned: 'QA Unassigned',
    assigned_not_started: 'Assigned - Not Started',
    in_progress: 'QC Testing in Progress',
    on_hold: 'QC Testing Hold',
    qc_failed: 'QC Review Failed',
    bis_testing: 'BIS Testing',
    approved_for_live: 'Approved for Live',
    no_qa_estimate: 'No QA Estimate (Need Planning)',
  };

  // Apply search + dropdown filters to ticket lists
  const applyFilters = (tickets) => {
    let result = tickets;
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      result = result.filter(t =>
        String(t.ticket_id).includes(s) ||
        (t.title || '').toLowerCase().includes(s) ||
        (t.qc_tester || '').toLowerCase().includes(s) ||
        (t.module || '').toLowerCase().includes(s) ||
        (t.priority || '').toLowerCase().includes(s)
      );
    }
    if (listPriorityFilter) {
      result = result.filter(t => t.priority === listPriorityFilter);
    }
    if (listModuleFilter) {
      result = result.filter(t => t.module === listModuleFilter);
    }
    if (listTesterFilter) {
      result = result.filter(t => (t.qc_tester || '') === listTesterFilter);
    }
    return result;
  };

  const queueList = applyFilters(filterTickets(allQueue));
  const devTested = applyFilters(filterTickets(allDevTested));

  // Unique values for filter dropdowns
  const allTicketsForFilters = [...allQueue, ...allDevTested];
  const uniquePriorities = [...new Set(allTicketsForFilters.map(t => t.priority).filter(Boolean))].sort();
  const uniqueModules = [...new Set(allTicketsForFilters.map(t => t.module).filter(Boolean))].sort();
  const uniqueTesters = [...new Set(allTicketsForFilters.map(t => t.qc_tester).filter(Boolean))].sort();

  const handleCardClick = (filter) => {
    if (cardFilter === filter) {
      setCardFilter(null);
    } else {
      setCardFilter(filter);
    }
  };

  // Sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortTickets = (tickets) => {
    return [...tickets].sort((a, b) => {
      let aVal = a[sortField] ?? '';
      let bVal = b[sortField] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const SortHeader = ({ field, children }) => (
    <th className="qcq-sortable-th" onClick={() => handleSort(field)}>
      {children}
      {sortField === field && <span className="qcq-sort-arrow">{sortDir === 'desc' ? ' \u25BC' : ' \u25B2'}</span>}
    </th>
  );

  const COL_COUNT = 20;

  const renderQueueTable = (tickets, label) => {
    const sorted = sortTickets(tickets);
    return (
    <div className="qcq-table-container">
      <table className="qcq-table">
        <thead>
          <tr>
            <SortHeader field="ticket_id">Ticket</SortHeader>
            <th>Title</th>
            <SortHeader field="status">Status</SortHeader>
            <SortHeader field="priority">Priority</SortHeader>
            <SortHeader field="platform">Platform</SortHeader>
            <SortHeader field="qc_tester">QC Tester</SortHeader>
            <SortHeader field="qa_lead">QA Lead</SortHeader>
            <SortHeader field="developers_str">Developer</SortHeader>
            <SortHeader field="module">Module</SortHeader>
            <SortHeader field="days_in_qc">Age</SortHeader>
            <th>Activity</th>
            <SortHeader field="retest_cycle_count">Cycles</SortHeader>
            <SortHeader field="qa_estimate_hours">Est Hrs</SortHeader>
            <SortHeader field="qa_actual_hours">Actual Hrs</SortHeader>
            <SortHeader field="test_cases">TC</SortHeader>
            <th>Pass/Fail</th>
            <SortHeader field="bugs_total">Bugs</SortHeader>
            <th>Open/Closed</th>
            <SortHeader field="bugs_released_to_qa">Released to QA</SortHeader>
            <SortHeader field="eta">ETA</SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={COL_COUNT} className="qcq-empty">No tickets in {label}</td></tr>
          ) : sorted.map(t => (
            <React.Fragment key={t.ticket_id}>
              <tr
                className={`qcq-row ${t.is_next_in_queue ? 'qcq-row-next' : ''} ${expandedTicket === t.ticket_id ? 'qcq-row-expanded' : ''}`}
                onClick={() => toggleExpand(t.ticket_id)}
              >
                <td className="qcq-ticket-id"><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>#{t.ticket_id}</a></td>
                <td className="qcq-title">{t.title}</td>
                <td>
                  <span className={`qcq-status qcq-status-${(t.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                    {t.status}
                  </span>
                </td>
                <td className="qcq-priority">{t.priority}</td>
                <td><span className={`qcq-platform-badge qcq-platform-${(t.platform || 'Web').toLowerCase()}`}>{t.platform || 'Web'}</span></td>
                <td>{t.qc_tester || <span className="qcq-unassigned">Unassigned</span>}</td>
                <td className="qcq-secondary">{t.qa_lead || '-'}</td>
                <td className="qcq-secondary">{t.developers_str || '-'}</td>
                <td>{t.module}</td>
                <td><AgeingBadge days={t.days_in_qc} /></td>
                <td><span className={`qcq-activity qcq-activity-${t.activity_type}`}>{t.activity_label}</span></td>
                <td>{t.retest_cycle_count > 0 ? <span className="qcq-cycle-count">{t.retest_cycle_count}</span> : '-'}</td>
                <td className="qcq-hours">{t.qa_estimate_hours || '-'}</td>
                <td className="qcq-hours">{t.qa_actual_hours || '-'}</td>
                <td>{t.test_cases > 0 ? (t.testrail_plan_url ? <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer" className="qcq-tc-link" onClick={e => e.stopPropagation()}>{t.test_cases}</a> : t.test_cases) : '-'}</td>
                <td>{t.test_cases > 0 ? <span><span className="qcq-pass">{t.test_passed}</span>/<span className="qcq-fail">{t.test_failed}</span></span> : '-'}</td>
                <td>{t.bugs_total > 0 ? <span className={t.bugs_open > 0 ? 'qcq-bugs-count' : ''}>{t.bugs_total}</span> : '-'}</td>
                <td>{t.bugs_total > 0 ? <span><span className={t.bugs_open > 0 ? 'qcq-fail' : ''}>{t.bugs_open}</span>/<span className="qcq-pass">{t.bugs_closed}</span></span> : '-'}</td>
                <td>{t.bugs_released_to_qa > 0 ? <span className="qcq-pass">{t.bugs_released_to_qa}</span> : '-'}</td>
                <td className="qcq-eta">{t.eta ? new Date(t.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
              </tr>
              {expandedTicket === t.ticket_id && (
                <tr className="qcq-expand-row">
                  <td colSpan={COL_COUNT}>
                    <div className="qcq-expand-content">
                      <div className="qcq-expand-section">
                        <h4>Ticket Details</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">Full Title</span> {t.title}</div>
                          <div><span className="qcq-detail-label">Platform</span> {t.platform}</div>
                          <div><span className="qcq-detail-label">Developers</span> {t.developers_str || '-'}</div>
                          <div><span className="qcq-detail-label">QC Tester</span> {t.qc_tester || 'Unassigned'}</div>
                          <div><span className="qcq-detail-label">Type</span> {t.ticket_type || '-'}</div>
                          <div><span className="qcq-detail-label">Ticket Created</span> {t.created_on ? new Date(t.created_on).toLocaleDateString() : '-'}</div>
                          <div><span className="qcq-detail-label">First Seen in Status</span> {t.moved_to_qc_on ? new Date(t.moved_to_qc_on).toLocaleDateString() : '-'}</div>
                          <div><span className="qcq-detail-label">Current Assignee</span> {t.current_assignee || '-'}</div>
                        </div>
                      </div>
                      <div className="qcq-expand-section">
                        <h4>Hours</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">QA Estimate</span> {t.qa_estimate_hours ? `${t.qa_estimate_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">QA Actual</span> {t.qa_actual_hours ? `${t.qa_actual_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">Dev Estimate</span> {t.dev_estimate_hours ? `${t.dev_estimate_hours}h` : '-'}</div>
                          <div><span className="qcq-detail-label">Dev Actual</span> {t.actual_dev_hours ? `${t.actual_dev_hours}h` : '-'}</div>
                        </div>
                      </div>
                      <div className="qcq-expand-section">
                        <h4>Testing & Bugs</h4>
                        <div className="qcq-detail-grid">
                          <div><span className="qcq-detail-label">Test Cases</span> {t.test_cases > 0 ? (t.testrail_plan_url ? <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer">{t.test_cases} cases</a> : `${t.test_cases} cases`) : 'No test plan'}</div>
                          <div><span className="qcq-detail-label">TC Passed</span> <span className="qcq-pass">{t.test_passed || 0}</span></div>
                          <div><span className="qcq-detail-label">TC Failed</span> <span className="qcq-fail">{t.test_failed || 0}</span></div>
                          <div><span className="qcq-detail-label">TC Untested</span> {t.test_untested || 0}</div>
                          <div><span className="qcq-detail-label">Bugs Total</span> {t.bugs_total || 0}</div>
                          <div><span className="qcq-detail-label">Bugs Open</span> <span className={t.bugs_open > 0 ? 'qcq-fail' : ''}>{t.bugs_open || 0}</span></div>
                          <div><span className="qcq-detail-label">Bugs Closed</span> <span className="qcq-pass">{t.bugs_closed || 0}</span></div>
                          <div><span className="qcq-detail-label">Released to QA</span> <span className="qcq-pass">{t.bugs_released_to_qa || 0}</span></div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
    );
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>QC Queue & Ageing</h1>
            <p className="header-subtitle">Priority-scored testing queue with ageing analytics</p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div className="qcq-platform-toggle">
              <button className={`btn btn-sm ${platformFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('all')}>All ({rawQueue.length})</button>
              <button className={`btn btn-sm ${platformFilter === 'Web' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Web')}>Web ({webCount})</button>
              <button className={`btn btn-sm ${platformFilter === 'Mobile' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Mobile')}>Mobile ({mobileCount})</button>
            </div>
            <button onClick={forceRefresh} className="btn btn-secondary btn-sm" title="Force refresh from PM API">Sync & Refresh</button>
          </div>
        </header>

        {/* 30-Day Summary Banner */}
        {monthlySummary && (
          <div className="qcq-summary-banner">
            <div className="qcq-summary-title">QA Pipeline Overview ({monthlySummary.period})</div>
            <table className="qcq-summary-table">
              <tbody>
                <tr className="qcq-summary-section-row"><td colSpan="2">QA Throughput (30 days)</td></tr>
                <tr><td>Tickets closed by QA this month</td><td className="qcq-st-val">{monthlySummary.closed_by_qa}</td></tr>
                <tr><td>Tickets closed previous month ({monthlySummary.previous_month?.period})</td><td className="qcq-st-val">{monthlySummary.previous_month?.closed_by_qa || 0}</td></tr>
                <tr><td>Month-over-month trend</td><td className="qcq-st-val" style={{ color: monthlySummary.closed_by_qa >= (monthlySummary.previous_month?.closed_by_qa || 0) ? 'var(--accent-green)' : 'var(--accent-red)' }}>{monthlySummary.closed_by_qa >= (monthlySummary.previous_month?.closed_by_qa || 0) ? '\u25B2 +' : '\u25BC '}{Math.abs(monthlySummary.closed_by_qa - (monthlySummary.previous_month?.closed_by_qa || 0))}</td></tr>

                <tr className="qcq-summary-section-row"><td colSpan="2">Current QC Pipeline — {monthlySummary.currently_in_qc} tickets</td></tr>
                <tr><td>In Progress (being tested by QA)</td><td className="qcq-st-val">{monthlySummary.in_progress_count}</td></tr>
                <tr><td>Assigned to QA, waiting to start</td><td className="qcq-st-val">{monthlySummary.assigned_waiting_count}</td></tr>
                <tr><td>Unassigned — need QA resource allocation</td><td className="qcq-st-val" style={{ color: monthlySummary.unassigned_count > 0 ? 'var(--accent-red)' : undefined }}>{monthlySummary.unassigned_count}</td></tr>
                <tr><td>On Hold (blocked / dependency)</td><td className="qcq-st-val">{monthlySummary.hold_count}</td></tr>
                <tr><td>QC Review Failed — returned to dev</td><td className="qcq-st-val" style={{ color: monthlySummary.qc_failed > 0 ? 'var(--accent-red)' : undefined }}>{monthlySummary.qc_failed}</td></tr>
                {monthlySummary.retesting_count > 0 && <tr><td>Retesting after QC fail (back in QC)</td><td className="qcq-st-val" style={{ color: 'var(--accent-amber)' }}>{monthlySummary.retesting_count}</td></tr>}
                {monthlySummary.no_qa_estimate > 0 && <tr><td style={{color:'var(--accent-red)'}}>No QA Estimate — need planning</td><td className="qcq-st-val" style={{color:'var(--accent-red)'}}>{monthlySummary.no_qa_estimate}</td></tr>}

                <tr className="qcq-summary-section-row"><td colSpan="2">Post-QC Status</td></tr>
                <tr><td>In BIS Testing (passed QC, awaiting client sign-off)</td><td className="qcq-st-val">{monthlySummary.in_bis}</td></tr>
                <tr><td>Approved for Live (verified by BIS, pending prod deploy)</td><td className="qcq-st-val">{monthlySummary.approved}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Status Cards - Clickable */}
        <div className="qcq-status-cards">
          <div className={`qcq-card qcq-card-clickable qcq-card-unassigned ${cardFilter === 'unassigned' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('unassigned')}>
            <div className="qcq-card-value">{unassignedTickets.length}</div>
            <div className="qcq-card-label">QA Unassigned</div>
            <div className="qcq-card-sub">QC Testing, no tester</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-testing ${cardFilter === 'assigned_not_started' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('assigned_not_started')}>
            <div className="qcq-card-value">{assignedNotStarted.length}</div>
            <div className="qcq-card-label">Assigned, Not Started</div>
            <div className="qcq-card-sub">QC Testing, tester assigned</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-progress ${cardFilter === 'in_progress' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('in_progress')}>
            <div className="qcq-card-value">{inProgressTickets.length}</div>
            <div className="qcq-card-label">In Progress</div>
            <div className="qcq-card-sub">Being tested</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-hold ${cardFilter === 'on_hold' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('on_hold')}>
            <div className="qcq-card-value">{onHoldTickets.length}</div>
            <div className="qcq-card-label">On Hold</div>
            <div className="qcq-card-sub">Blocked</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-failed ${cardFilter === 'qc_failed' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('qc_failed')}>
            <div className="qcq-card-value">{qcFailedCount}</div>
            <div className="qcq-card-label">QC Review Fail</div>
            <div className="qcq-card-sub">Failed QC review</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-progress ${cardFilter === 'bis_testing' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('bis_testing')}>
            <div className="qcq-card-value">{bisTestingTickets.length}</div>
            <div className="qcq-card-label">BIS Testing</div>
            <div className="qcq-card-sub">Passed QC, in BIS</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-fpr ${cardFilter === 'approved_for_live' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('approved_for_live')}>
            <div className="qcq-card-value">{approvedTickets.length}</div>
            <div className="qcq-card-label">Approved for Live</div>
            <div className="qcq-card-sub">Ready for prod verification</div>
          </div>
          <div className={`qcq-card qcq-card-clickable qcq-card-unassigned ${cardFilter === 'no_qa_estimate' ? 'qcq-card-active' : ''}`} onClick={() => handleCardClick('no_qa_estimate')}>
            <div className="qcq-card-value">{noEstimateTickets.length}</div>
            <div className="qcq-card-label">No QA Estimate</div>
            <div className="qcq-card-sub">Need planning</div>
          </div>
          <div className="qcq-card qcq-card-total">
            <div className="qcq-card-value">{queue?.total || 0}</div>
            <div className="qcq-card-label">Total Queue</div>
            <div className="qcq-card-sub">{queue?.dev_tested_count || 0} dev-tested</div>
          </div>
        </div>

        {/* Card filter result list */}
        {cardFilter && cardFilteredList && (
          <div className="qcq-section qcq-card-filter-section">
            <div className="qcq-section-title">
              {cardFilterLabels[cardFilter]} ({applyFilters(cardFilteredList).length}{applyFilters(cardFilteredList).length !== cardFilteredList.length ? ` of ${cardFilteredList.length}` : ''})
              <button className="btn btn-sm btn-secondary" onClick={() => setCardFilter(null)} style={{ marginLeft: 'auto' }}>Clear Filter</button>
            </div>

            {/* Module distribution donut */}
            {(() => {
              const modCounts = {};
              cardFilteredList.forEach(t => { const m = t.module || 'Unassigned'; modCounts[m] = (modCounts[m] || 0) + 1; });
              const mods = Object.entries(modCounts).sort((a, b) => b[1] - a[1]);
              const total = cardFilteredList.length;
              const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#06b6d4','#84cc16','#a855f7','#6366f1'];
              // Build SVG donut
              const R = 60, r = 38, cx = 70, cy = 70;
              let angle = 0;
              const arcs = mods.map(([mod, count], i) => {
                const pct = count / total;
                const startAngle = angle;
                angle += pct * 360;
                const endAngle = angle;
                const start = startAngle * Math.PI / 180;
                const end = endAngle * Math.PI / 180;
                const largeArc = pct > 0.5 ? 1 : 0;
                const x1 = cx + R * Math.sin(start), y1 = cy - R * Math.cos(start);
                const x2 = cx + R * Math.sin(end), y2 = cy - R * Math.cos(end);
                const ix1 = cx + r * Math.sin(start), iy1 = cy - r * Math.cos(start);
                const ix2 = cx + r * Math.sin(end), iy2 = cy - r * Math.cos(end);
                const d = `M${x1},${y1} A${R},${R} 0 ${largeArc} 1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${largeArc} 0 ${ix1},${iy1} Z`;
                return { mod, count, color: colors[i % colors.length], d, pct };
              });
              return (
                <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <svg width="140" height="140" viewBox="0 0 140 140">
                    {arcs.map(a => (
                      <path key={a.mod} d={a.d} fill={a.color} stroke="var(--bg-primary)" strokeWidth="1.5"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setListModuleFilter(listModuleFilter === a.mod ? '' : a.mod)}>
                        <title>{a.mod}: {a.count} ({Math.round(a.pct * 100)}%)</title>
                      </path>
                    ))}
                    <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize="16" fontWeight="bold">{total}</text>
                    <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text-muted)" fontSize="8">tickets</text>
                  </svg>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {mods.map(([mod, count], i) => (
                      <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', cursor: 'pointer', opacity: listModuleFilter && listModuleFilter !== mod ? 0.4 : 1 }}
                        onClick={() => setListModuleFilter(listModuleFilter === mod ? '' : mod)}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{count}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{mod}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({Math.round(count / total * 100)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="qcq-section-title" style={{ fontSize: '0.85rem', marginBottom: '4px' }}>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <input type="text" placeholder="Search tickets..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                className="qcq-search-input" style={{ width: '180px' }} />
              <select className="qcq-search-input" value={listPriorityFilter} onChange={e => setListPriorityFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Priorities</option>
                {[...new Set(cardFilteredList.map(t => t.priority).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="qcq-search-input" value={listModuleFilter} onChange={e => setListModuleFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Modules</option>
                {[...new Set(cardFilteredList.map(t => t.module).filter(Boolean))].sort().map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="qcq-search-input" value={listTesterFilter} onChange={e => setListTesterFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Testers</option>
                {[...new Set(cardFilteredList.map(t => t.qc_tester).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {(searchFilter || listPriorityFilter || listModuleFilter || listTesterFilter) && (
                <button className="btn btn-sm btn-secondary" onClick={() => { setSearchFilter(''); setListPriorityFilter(''); setListModuleFilter(''); setListTesterFilter(''); }}>
                  Clear Filters
                </button>
              )}
            </div>
            {renderQueueTable(applyFilters(cardFilteredList), cardFilterLabels[cardFilter])}
          </div>
        )}

        {/* Tabs */}
        <div className="qcq-tabs">
          <button className={`qcq-tab ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => { setActiveTab('queue'); setCardFilter(null); }}>
            Priority Queue ({queue?.total || 0})
          </button>
          <button className={`qcq-tab ${activeTab === 'module_workload' ? 'active' : ''}`} onClick={() => { setActiveTab('module_workload'); setCardFilter(null); setSelectedModuleBar(null); }}>
            Module Workload ({moduleWorkload.length})
          </button>
          <button className={`qcq-tab ${activeTab === 'dev_pipeline' ? 'active' : ''}`} onClick={() => { setActiveTab('dev_pipeline'); setCardFilter(null); setSelectedPipelineBar(null); }}>
            Incoming Pipeline ({modulePipeline.reduce((s, m) => s + m.total, 0)})
          </button>
          {activeTab === 'queue' && (
            <div className="qcq-search" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="qcq-search-input"
              />
              <select className="qcq-search-input" value={listPriorityFilter} onChange={e => setListPriorityFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Priorities</option>
                {uniquePriorities.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="qcq-search-input" value={listModuleFilter} onChange={e => setListModuleFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Modules</option>
                {uniqueModules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="qcq-search-input" value={listTesterFilter} onChange={e => setListTesterFilter(e.target.value)} style={{ width: '140px' }}>
                <option value="">All Testers</option>
                {uniqueTesters.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Smart Priority Queue
              <span className="qcq-section-hint">Scored 0-100 based on priority, ageing, re-entry, ETA urgency, and ticket type. Click a row for details.</span>
            </h2>
            {renderQueueTable(queueList, 'queue')}

            {devTested.length > 0 && (
              <>
                <h3 className="qcq-subsection-title">Dev-Tested ({devTested.length})</h3>
                {renderQueueTable(devTested, 'dev-tested')}
              </>
            )}
          </div>
        )}

        {/* Module Workload Tab */}
        {activeTab === 'module_workload' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Module Workload
              <span className="qcq-section-hint">QC pending tickets by module and status. Click any bar segment to see tickets.</span>
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', fontSize: '0.72rem' }}
                onClick={() => {
                  const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                  exportToExcel(allQ, 'QC_Module_Workload_All');
                }}>Export All</button>
            </h2>
            {(() => {
              const maxTotal = Math.max(...moduleWorkload.map(m => m.total), 1);
              const statusDefs = [
                { key: 'qc_testing', label: 'QC Testing', color: '#3b82f6' },
                { key: 'in_progress', label: 'In Progress', color: '#22c55e' },
                { key: 'hold', label: 'Hold', color: '#f59e0b' },
                { key: 'qc_failed', label: 'QC Failed', color: '#ef4444' },
                { key: 'bis', label: 'BIS Testing', color: '#8b5cf6' },
                { key: 'approved', label: 'Approved', color: '#06b6d4' },
              ];
              const statusToQueueStatus = {
                qc_testing: 'QC Testing', in_progress: 'QC Testing in Progress',
                hold: 'QC Testing Hold', qc_failed: 'QC Review Fail',
                bis: 'BIS Testing', approved: 'Approved for Live'
              };

              const getModuleTickets = (mod, statusKey) => {
                const queueStatus = statusToQueueStatus[statusKey];
                const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                return allQ.filter(t => (t.module || 'Unassigned') === mod && t.status === queueStatus);
              };

              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {statusDefs.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                        {s.label}
                      </div>
                    ))}
                  </div>

                  {/* Stacked horizontal bars */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {moduleWorkload.map(m => (
                      <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '160px', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={m.module}>
                          {m.module}
                        </div>
                        <div style={{ flex: 1, display: 'flex', height: '28px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)', cursor: 'pointer' }}>
                          {statusDefs.map(s => {
                            const count = m[s.key] || 0;
                            if (count === 0) return null;
                            const widthPct = (count / maxTotal) * 100;
                            const isActive = selectedModuleBar?.module === m.module && selectedModuleBar?.status === s.key;
                            return (
                              <div
                                key={s.key}
                                style={{
                                  width: `${widthPct}%`, minWidth: count > 0 ? '18px' : 0,
                                  background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '0.7rem', color: '#fff', fontWeight: 600, transition: 'all 0.2s',
                                  opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                }}
                                title={`${m.module} — ${s.label}: ${count}`}
                                onClick={() => {
                                  const val = isActive ? null : { module: m.module, status: s.key, label: s.label };
                                  setSelectedModuleBar(val);
                                  if (val) setTimeout(() => moduleListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                }}
                              >
                                {count}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ width: '60px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: m.total >= 10 ? 'var(--accent-red, #ef4444)' : m.total >= 5 ? 'var(--accent-amber, #f59e0b)' : 'var(--text-secondary)' }}>{m.total}</span>
                          <span style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '0.68rem' }}
                            title={`Export all ${m.total} ${m.module} tickets`}
                            onClick={() => {
                              const allQ = [...(queue?.queue || []), ...(qcFailed?.tickets || []), ...(bisTesting?.tickets || []), ...(approvedForLive?.tickets || [])];
                              const modTickets = allQ.filter(t => (t.module || 'Unassigned') === m.module);
                              exportToExcel(modTickets, `QC_${m.module}`);
                            }}>CSV</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Clicked bar segment — show ticket list */}
                  {selectedModuleBar && (() => {
                    const tickets = getModuleTickets(selectedModuleBar.module, selectedModuleBar.status);
                    return (
                      <div ref={moduleListRef} style={{ marginTop: '16px' }}>
                        <div className="qcq-section-title" style={{ fontSize: '0.9rem' }}>
                          {selectedModuleBar.module} — {selectedModuleBar.label} ({tickets.length})
                          <button className="btn btn-sm btn-primary" onClick={() => exportToExcel(tickets, `${selectedModuleBar.module}_${selectedModuleBar.label}`)} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>Export</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setSelectedModuleBar(null)} style={{ marginLeft: 'auto' }}>Close</button>
                        </div>
                        {tickets.length > 0 ? renderQueueTable(tickets, 'module-workload') : <p style={{color:'var(--text-muted)',padding:'8px'}}>No tickets</p>}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        )}

        {/* Incoming Pipeline Tab */}
        {activeTab === 'dev_pipeline' && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Incoming Pipeline
              <span className="qcq-section-hint">Dev tickets expected to reach QA — first-time (new) vs refix (returned from QA failure). Click a bar to see tickets.</span>
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', fontSize: '0.72rem' }}
                onClick={() => {
                  const allPipelineTickets = modulePipeline.flatMap(m => m.tickets || []);
                  exportToExcel(allPipelineTickets, 'Incoming_Pipeline_All');
                }}>Export All</button>
            </h2>
            {(() => {
              const maxTotal = Math.max(...modulePipeline.map(m => m.total), 1);
              const segmentDefs = [
                { key: 'cr_passed', label: 'CR Passed (Imminent)', color: '#22c55e', filter: t => t.status === 'Code Review Passed' },
                { key: 'code_review', label: 'Code Review', color: '#3b82f6', filter: t => ['Start Code Review','Code Review Failed','Express Lane Review'].includes(t.status) },
                { key: 'in_progress', label: 'In Progress', color: '#f59e0b', filter: t => ['In Progress','Hold/Pending'].includes(t.status) },
              ];
              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: 'linear-gradient(90deg, #22c55e, #3b82f6, #f59e0b)', display: 'inline-block' }} />
                      First Time
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
                      Refix (returned from QA)
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '8px' }}>|</span>
                    {segmentDefs.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 1, background: s.color, display: 'inline-block' }} />
                        {s.label}
                      </div>
                    ))}
                  </div>

                  {/* Bars per module */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {modulePipeline.map(m => {
                      const firstTime = m.first_time || 0;
                      const refix = m.refix || 0;
                      return (
                        <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '160px', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={m.module}>{m.module}</div>
                          <div style={{ flex: 1, display: 'flex', height: '28px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)' }}>
                            {/* First-time segments */}
                            {segmentDefs.map(s => {
                              const tickets = (m.tickets || []).filter(t => !t.is_refix && s.filter(t));
                              if (tickets.length === 0) return null;
                              const isActive = selectedPipelineBar?.module === m.module && selectedPipelineBar?.type === s.key;
                              return (
                                <div key={s.key}
                                  style={{
                                    width: `${(tickets.length / maxTotal) * 100}%`, minWidth: '16px',
                                    background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.7rem', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                  }}
                                  title={`${m.module} — ${s.label} (First Time): ${tickets.length}`}
                                  onClick={() => { const val = isActive ? null : { module: m.module, type: s.key, label: `${s.label} (First Time)`, tickets }; setSelectedPipelineBar(val); if (val) setTimeout(() => pipelineListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                                >{tickets.length}</div>
                              );
                            })}
                            {/* Refix segment */}
                            {refix > 0 && (() => {
                              const refixTickets = (m.tickets || []).filter(t => t.is_refix);
                              const isActive = selectedPipelineBar?.module === m.module && selectedPipelineBar?.type === 'refix';
                              return (
                                <div
                                  style={{
                                    width: `${(refix / maxTotal) * 100}%`, minWidth: '16px',
                                    background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.7rem', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: isActive ? 1 : 0.85, outline: isActive ? '2px solid #fff' : 'none',
                                  }}
                                  title={`${m.module} — Refix: ${refix}`}
                                  onClick={() => { const val = isActive ? null : { module: m.module, type: 'refix', label: 'Refix', tickets: refixTickets }; setSelectedPipelineBar(val); if (val) setTimeout(() => pipelineListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                                >{refix}</div>
                              );
                            })()}
                          </div>
                          <div style={{ width: '100px', display: 'flex', gap: '6px', fontSize: '0.75rem', fontWeight: 600, alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{firstTime}</span>
                            {refix > 0 && <span style={{ color: '#ef4444' }}>+{refix}R</span>}
                            <span style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '0.68rem', marginLeft: '2px' }}
                              title={`Export all ${m.total} ${m.module} tickets`}
                              onClick={() => exportToExcel(m.tickets || [], `Pipeline_${m.module}`)}>
                              CSV
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Clicked bar — ticket list */}
                  {selectedPipelineBar && (
                    <div ref={pipelineListRef} style={{ marginTop: '16px' }}>
                      <div className="qcq-section-title" style={{ fontSize: '0.9rem' }}>
                        {selectedPipelineBar.module} — {selectedPipelineBar.label} ({selectedPipelineBar.tickets?.length || 0})
                        <button className="btn btn-sm btn-primary" onClick={() => exportToExcel(selectedPipelineBar.tickets, `${selectedPipelineBar.module}_${selectedPipelineBar.label}`)} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>Export</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setSelectedPipelineBar(null)} style={{ marginLeft: 'auto' }}>Close</button>
                      </div>
                      {selectedPipelineBar.tickets?.length > 0 ? (
                        <div className="qcq-table-container">
                          <table className="qcq-table">
                            <thead>
                              <tr>
                                <th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Platform</th>
                                <th>Developer</th><th>QC Tester</th><th>Refix</th><th>Dev Est</th><th>Dev Actual</th><th>ETA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedPipelineBar.tickets.map(t => (
                                <tr key={t.ticket_id}>
                                  <td><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                  <td style={{maxWidth:'250px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.title}>{t.title}</td>
                                  <td><span className="qcq-status-badge">{t.status}</span></td>
                                  <td>{t.priority}</td>
                                  <td>{t.platform || '-'}</td>
                                  <td>{t.developers_str || '-'}</td>
                                  <td>{t.qc_tester || '-'}</td>
                                  <td>{t.is_refix ? <span className="qcq-fail">Yes</span> : '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.dev_estimate_hours || '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.actual_dev_hours || '-'}</td>
                                  <td>{t.eta || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <p style={{color:'var(--text-muted)',padding:'8px'}}>No tickets</p>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      </main>
    </div>
  );
}
