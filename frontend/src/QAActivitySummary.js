import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PERIOD_OPTIONS = [
  { value: 'past_5_days', label: 'Past 5 Working Days' },
  { value: 'current_month', label: 'Current Month' },
  { value: 'custom', label: 'Custom Range' },
];

function StatusBadge({ status }) {
  if (!status) return <span className="qas-badge qas-badge-default">-</span>;
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  return <span className={`qas-badge qas-badge-${s}`}>{status}</span>;
}

function TimelineEvent({ event, isLast }) {
  const inPeriod = event.in_period;
  const ts = event.timestamp ? new Date(event.timestamp) : null;
  return (
    <div className={`qas-timeline-event ${inPeriod ? 'qas-in-period' : 'qas-out-period'}`}>
      <div className="qas-timeline-dot-col">
        <div className={`qas-timeline-dot ${inPeriod ? 'qas-dot-active' : ''}`} />
        {!isLast && <div className="qas-timeline-line" />}
      </div>
      <div className="qas-timeline-content">
        <div className="qas-timeline-statuses">
          {event.from_status && <span className="qas-timeline-from">{event.from_status}</span>}
          {event.from_status && <span className="qas-timeline-arrow">&rarr;</span>}
          <span className="qas-timeline-to">{event.to_status}</span>
        </div>
        {ts && (
          <span className="qas-timeline-date">
            {ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' '}
            {ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}

function TicketStoryCard({ ticket }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`qas-ticket-card ${ticket.had_fail ? 'qas-ticket-failed' : ''} ${ticket.had_pass ? 'qas-ticket-passed' : ''} ${ticket.had_hold ? 'qas-ticket-hold' : ''}`}>
      <div className="qas-ticket-header" onClick={() => setExpanded(!expanded)}>
        <a href={`${PM_TICKET_URL}${ticket.ticket_id}`} target="_blank" rel="noopener noreferrer" className="qas-ticket-id" onClick={e => e.stopPropagation()}>#{ticket.ticket_id}</a>
        <span className="qas-ticket-priority">{ticket.priority}</span>
        <StatusBadge status={ticket.current_status} />
        {ticket.had_hold && <span className="qas-tag qas-tag-hold">Hold</span>}
        {ticket.had_fail && <span className="qas-tag qas-tag-fail">Failed</span>}
        {ticket.had_pass && <span className="qas-tag qas-tag-pass">Passed</span>}
        <span className="qas-expand-icon">{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>
      <div className="qas-ticket-title">{ticket.title}</div>
      <div className="qas-ticket-meta-row">
        {ticket.module && <span className="qas-ticket-module">{ticket.module}</span>}
        {(ticket.qa_estimate_hours || ticket.qa_actual_hours) && (
          <span className="qas-ticket-hours">
            {ticket.qa_estimate_hours ? `Est: ${ticket.qa_estimate_hours}h` : ''}
            {ticket.qa_estimate_hours && ticket.qa_actual_hours ? ' / ' : ''}
            {ticket.qa_actual_hours ? `Actual: ${ticket.qa_actual_hours}h` : ''}
          </span>
        )}
      </div>

      {expanded && (
        <div className="qas-ticket-timeline">
          <h5>Full Status Timeline</h5>
          <div className="qas-timeline">
            {(ticket.full_timeline || []).map((evt, i) => (
              <TimelineEvent key={i} event={evt} isLast={i === ticket.full_timeline.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BISTableRow({ ticket, type }) {
  const [expanded, setExpanded] = useState(false);
  const totalDays = type === 'closed' ? ticket.days_bis_to_closed : ticket.days_since_bis;
  const legs = ticket.status_legs || [];
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
  const colCount = type === 'closed' ? 9 : 8;

  return (
    <React.Fragment>
      <tr className="qcq-row" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <td className="qcq-ticket-id">
          <a href={`${PM_TICKET_URL}${ticket.ticket_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>#{ticket.ticket_id}</a>
        </td>
        <td className="qcq-title">{ticket.title}</td>
        <td className="qcq-priority">{ticket.priority}</td>
        <td>{ticket.qc_tester || '-'}</td>
        <td>{fmtDate(ticket.entered_bis_on)}</td>
        {type === 'closed' && <td>{fmtDate(ticket.closed_on)}</td>}
        {type === 'closed' && <td><StatusBadge status={ticket.closed_status} /></td>}
        {type === 'pending' && <td><StatusBadge status={ticket.current_status} /></td>}
        <td>
          <span className={`qcq-age-badge ${totalDays >= 15 ? 'qcq-age-critical' : totalDays >= 7 ? 'qcq-age-stale' : totalDays >= 3 ? 'qcq-age-aging' : 'qcq-age-fresh'}`}>
            {totalDays}d
          </span>
        </td>
        <td>{legs.length > 0 ? `${legs.length} steps` : '-'}</td>
      </tr>
      {expanded && legs.length > 0 && (
        <tr className="qcq-expand-row">
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div className="bis-legs-breakdown" style={{ paddingLeft: '16px' }}>
              {legs.map((leg, i) => (
                <div key={i} className="bis-leg-item">
                  <div className="bis-leg-status">
                    <StatusBadge status={leg.status} />
                    {leg.next_status && <><span className="qas-timeline-arrow">&rarr;</span><StatusBadge status={leg.next_status} /></>}
                    {!leg.next_status && <span className="bis-leg-current">(current)</span>}
                  </div>
                  <div className="bis-leg-duration">
                    <span className={`qcq-age-badge ${leg.days >= 7 ? 'qcq-age-stale' : leg.days >= 3 ? 'qcq-age-aging' : 'qcq-age-fresh'}`}>{leg.days}d</span>
                  </div>
                  <div className="bis-leg-dates">
                    {leg.entered_on && <span>{fmtDate(leg.entered_on)}</span>}
                    {leg.exited_on && <span> — {fmtDate(leg.exited_on)}</span>}
                    {!leg.exited_on && <span> — ongoing</span>}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

const CLOSED_STATUSES_SET = new Set(['Closed', 'Moved to Live']);

function TicketTable({ tickets, SortTh }) {
  if (tickets.length === 0) return <div className="qcq-empty" style={{ padding: '12px' }}>No tickets</div>;
  return (
    <div className="qcq-table-container">
      <table className="qcq-table">
        <thead>
          <tr>
            <SortTh field="ticket_id">Ticket</SortTh>
            <th>Title</th>
            <SortTh field="current_status">Status</SortTh>
            <SortTh field="priority_order">Priority</SortTh>
            <SortTh field="platform">Platform</SortTh>
            <th>Module</th>
            <th>Developer</th>
            <th>Type</th>
            <SortTh field="qa_estimate_hours">Est Hrs</SortTh>
            <SortTh field="qa_actual_hours">Actual Hrs</SortTh>
            <th>ETA</th>
            <th>Created</th>
            <SortTh field="test_cases">TC</SortTh>
            <th>Pass/Fail</th>
            <SortTh field="bugs_total">Bugs</SortTh>
            <th>Open/Closed</th>
            <SortTh field="bugs_released_to_qa">Released to QA</SortTh>
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.ticket_id} className="qcq-row">
              <td className="qcq-ticket-id">
                <a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a>
              </td>
              <td className="qcq-title">{t.title}</td>
              <td><StatusBadge status={t.current_status} /></td>
              <td className="qcq-priority">{t.priority}</td>
              <td><span className={`qcq-platform-badge qcq-platform-${(t.platform || 'Web').toLowerCase()}`}>{t.platform}</span></td>
              <td>{t.module || '-'}</td>
              <td className="qcq-secondary">{t.developers_str || '-'}</td>
              <td>{t.ticket_type || '-'}</td>
              <td className="qcq-hours">{t.qa_estimate_hours || '-'}</td>
              <td className="qcq-hours">{t.qa_actual_hours || '-'}</td>
              <td className="qcq-eta">{t.eta ? new Date(t.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
              <td className="qcq-eta">{t.created_on ? new Date(t.created_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</td>
              <td>{t.test_cases > 0 ? (t.testrail_plan_url ? <a href={t.testrail_plan_url} target="_blank" rel="noopener noreferrer" className="qcq-tc-link">{t.test_cases}</a> : t.test_cases) : '-'}</td>
              <td>{t.test_cases > 0 ? <span><span className="qcq-pass">{t.test_passed}</span>/<span className="qcq-fail">{t.test_failed}</span></span> : '-'}</td>
              <td>{t.bugs_total > 0 ? <span className={t.bugs_open > 0 ? 'qcq-bugs-count' : ''}>{t.bugs_total}</span> : '-'}</td>
              <td>{t.bugs_total > 0 ? <span><span className={t.bugs_open > 0 ? 'qcq-fail' : ''}>{t.bugs_open}</span>/<span className="qcq-pass">{t.bugs_closed}</span></span> : '-'}</td>
              <td>{t.bugs_released_to_qa > 0 ? <span className="qcq-pass">{t.bugs_released_to_qa}</span> : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberStoryCard({ member, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sortField, setSortField] = useState('priority_order');
  const [sortDir, setSortDir] = useState('asc');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const stats = member.stats || {};
  const hasActivity = member.ticket_count > 0;

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const doSort = (list) => [...list].sort((a, b) => {
    let av = a[sortField] ?? '';
    let bv = b[sortField] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const allFiltered = (member.tickets || []).filter(t => !statusFilter || t.current_status === statusFilter);
  const activeTickets = doSort(allFiltered.filter(t => !CLOSED_STATUSES_SET.has(t.current_status)));
  const completedTickets = doSort(allFiltered.filter(t => CLOSED_STATUSES_SET.has(t.current_status)));

  const uniqueStatuses = [...new Set((member.tickets || []).map(t => t.current_status))].sort();

  const SortTh = ({ field, children }) => (
    <th className="qcq-sortable-th" onClick={() => handleSort(field)}>
      {children}{sortField === field && <span className="qcq-sort-arrow">{sortDir === 'desc' ? ' \u25BC' : ' \u25B2'}</span>}
    </th>
  );

  const statusDefs = [
    { key: 'in_progress', status: 'QC Testing in Progress', label: 'QC In Progress', color: 'var(--accent-green)' },
    { key: 'qc_testing', status: 'QC Testing', label: 'QC Testing', color: 'var(--accent-blue)' },
    { key: 'on_hold', status: 'QC Testing Hold', label: 'QC Hold', color: 'var(--accent-amber)' },
    { key: 'qc_failed', status: 'QC Review Fail', label: 'QC Fail', color: 'var(--accent-red)' },
    { key: 'bis_testing', status: 'BIS Testing', label: 'BIS Testing', color: 'var(--accent-purple, #8b5cf6)' },
    { key: 'approved', status: 'Approved for Live', label: 'Approved', color: 'var(--accent-teal)' },
  ];

  // Group tickets by status
  const grouped = {};
  (member.tickets || []).filter(t => !CLOSED_STATUSES_SET.has(t.current_status)).forEach(t => {
    const s = t.current_status || 'Other';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  });

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '10px', overflow: 'hidden' }}>
      {/* Header with name + clickable status badges */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '160px', cursor: 'pointer' }}
          onClick={() => { setExpanded(!expanded); if (expanded) { setStatusFilter(''); setShowCompleted(false); } }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: hasActivity ? 'var(--accent-green)' : 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{member.name}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{member.platform}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{stats.total || 0} tickets</span>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {statusDefs.map(s => {
            const count = (grouped[s.status] || []).length;
            if (count === 0) return null;
            const isActive = statusFilter === s.status;
            return (
              <span key={s.key}
                onClick={() => { setStatusFilter(isActive ? '' : s.status); if (!expanded) setExpanded(true); }}
                style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  background: isActive ? s.color : `${s.color}15`, color: isActive ? '#fff' : s.color,
                  border: `1px solid ${s.color}` }}>
                {s.label}: {count}
              </span>
            );
          })}
          {completedTickets.length > 0 && (
            <span onClick={() => { setShowCompleted(!showCompleted); if (!expanded) setExpanded(true); setStatusFilter(''); }}
              style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                background: showCompleted ? 'var(--text-muted)' : 'rgba(100,116,139,0.1)', color: showCompleted ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--text-muted)' }}>
              Closed: {completedTickets.length}
            </span>
          )}
        </div>
      </div>

      {/* Expanded ticket list */}
      {expanded && hasActivity && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-color)' }}>
          {statusFilter ? (
            /* Show only filtered status */
            <div style={{ marginTop: '8px' }}>
              <TicketTable tickets={doSort(grouped[statusFilter] || [])} SortTh={SortTh} />
            </div>
          ) : showCompleted ? (
            /* Show completed */
            <div style={{ marginTop: '8px' }}>
              <TicketTable tickets={completedTickets} SortTh={SortTh} />
            </div>
          ) : (
            /* Show all active grouped by status */
            <div style={{ marginTop: '8px' }}>
              {statusDefs.map(s => {
                const tix = grouped[s.status];
                if (!tix || tix.length === 0) return null;
                return (
                  <div key={s.key} style={{ marginBottom: '10px' }}>
                    <h4 style={{ fontSize: '0.8rem', color: s.color, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                      {s.label} ({tix.length})
                    </h4>
                    <TicketTable tickets={doSort(tix)} SortTh={SortTh} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

export default function QAActivitySummary() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('past_5_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState(null);
  const [bisData, setBisData] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [showBIS, setShowBIS] = useState(false);
  const [activeView, setActiveView] = useState('members'); // 'members' | 'modules' | 'bis'
  const [moduleWorkload, setModuleWorkload] = useState([]);
  const [expandedModStatus, setExpandedModStatus] = useState(null); // {module, status}
  const [modTickets, setModTickets] = useState([]);
  const [loadingModTickets, setLoadingModTickets] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');

  const safeFetch = async (url) => {
    try { return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`); } catch { return null; }
  };

  const fetchData = useCallback(async () => {
    if (period === 'custom' && (!customStart || !customEnd)) return;
    setLoading(true);
    setError(null);
    try {
      let url = `/live/qa-activity-summary?period=${period}`;
      if (period === 'custom') {
        url += `&start_date=${customStart}&end_date=${customEnd}`;
      }
      const [summaryRes, bisRes, qcRes] = await Promise.all([
        safeFetch(url),
        safeFetch('/live/bis-to-closed'),
        safeFetch('/live/qc-queue'),
      ]);
      if (summaryRes?.ok) setData(await summaryRes.json());
      if (bisRes?.ok) setBisData(await bisRes.json());
      if (qcRes?.ok) {
        const qcData = await qcRes.json();
        setModuleWorkload(qcData.module_workload || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const forceRefresh = async () => {
    await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
    setExpandedModStatus(null);
    setModTickets([]);
    fetchData();
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading Activity Summary...</p></div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn btn-primary">Retry</button></div>
        </main>
      </div>
    );
  }

  const teamStats = data?.team_stats || {};
  const members = (data?.members || []).filter(m => {
    // Platform filter
    if (platformFilter !== 'all' && (m.platform || 'Web') !== platformFilter) return false;
    // Search filter
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      return (m.name || '').toLowerCase().includes(s) ||
        (m.tickets || []).some(t =>
          String(t.ticket_id).includes(s) || (t.title || '').toLowerCase().includes(s)
        );
    }
    return true;
  });

  const bisSummary = bisData?.summary || {};

  const formatDateRange = () => {
    if (!data?.start_date || !data?.end_date) return '';
    const s = new Date(data.start_date);
    const e = new Date(data.end_date);
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>QA Activity Summary</h1>
            <p className="header-subtitle">Team activity report — {formatDateRange()}</p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="qcq-platform-toggle">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`btn btn-sm ${period === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setPeriod(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="date" className="qcq-search-input" style={{ width: '140px' }} value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <span style={{ color: 'var(--text-muted)' }}>to</span>
                <input type="date" className="qcq-search-input" style={{ width: '140px' }} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}
            <div className="qcq-platform-toggle">
              <button className={`btn btn-sm ${platformFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('all')}>All</button>
              <button className={`btn btn-sm ${platformFilter === 'Web' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Web')}>Web</button>
              <button className={`btn btn-sm ${platformFilter === 'Mobile' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Mobile')}>Mobile</button>
            </div>
            <button onClick={forceRefresh} className="btn btn-secondary btn-sm" title="Force refresh from PM API">Sync & Refresh</button>
          </div>
        </header>

        {/* Team Summary Cards */}
        <div className="qcq-status-cards">
          <div className="qcq-card qcq-card-total">
            <div className="qcq-card-value">{teamStats.total_tickets_touched || 0}</div>
            <div className="qcq-card-label">Tickets Touched</div>
          </div>
          <div className="qcq-card qcq-card-progress">
            <div className="qcq-card-value">{teamStats.total_passed || 0}</div>
            <div className="qcq-card-label">Passed to BIS</div>
          </div>
          <div className="qcq-card qcq-card-hold">
            <div className="qcq-card-value">{teamStats.total_failed || 0}</div>
            <div className="qcq-card-label">QC Review Fails</div>
          </div>
          <div className="qcq-card qcq-card-testing">
            <div className="qcq-card-value">{teamStats.active_members || 0}/{teamStats.total_members || 0}</div>
            <div className="qcq-card-label">Active Members</div>
          </div>
          <div className="qcq-card qcq-card-ageing">
            <div className="qcq-card-value">{bisSummary.avg_days_bis_to_closed || 0}d</div>
            <div className="qcq-card-label">Avg BIS to Closed</div>
          </div>
          <div className="qcq-card qcq-card-fpr">
            <div className="qcq-card-value">{bisSummary.still_in_bis || 0}</div>
            <div className="qcq-card-label">Still in BIS</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="qcq-tabs">
          <button className={`qcq-tab ${activeView === 'members' ? 'active' : ''}`} onClick={() => { setActiveView('members'); setShowBIS(false); }}>
            Member Stories ({members.length})
          </button>
          <button className={`qcq-tab ${activeView === 'modules' ? 'active' : ''}`} onClick={() => setActiveView('modules')}>
            Module Activity ({moduleWorkload.length})
          </button>
          <button className={`qcq-tab ${activeView === 'bis' ? 'active' : ''}`} onClick={() => { setActiveView('bis'); setShowBIS(true); }}>
            BIS to Closed ({bisSummary.total_closed || 0})
          </button>
          <div className="qcq-search">
            <input
              type="text"
              placeholder="Search members or tickets..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="qcq-search-input"
            />
          </div>
        </div>

        {/* Member Stories */}
        {/* Module Activity Tab */}
        {activeView === 'modules' && (
          <div className="qcq-section">
            {moduleWorkload.map(m => {
              const statuses = [
                { key: 'qc_testing', label: 'QC Testing', color: 'var(--accent-blue)' },
                { key: 'in_progress', label: 'QC In Progress', color: 'var(--accent-green)' },
                { key: 'hold', label: 'QC Hold', color: 'var(--accent-amber)' },
                { key: 'qc_failed', label: 'QC Review Fail', color: 'var(--accent-red)' },
                { key: 'bis', label: 'BIS Testing', color: 'var(--accent-purple, #8b5cf6)' },
                { key: 'approved', label: 'Approved for Live', color: 'var(--accent-teal)' },
              ];
              const statusToGroup = { qc_testing: 'qc_testing', in_progress: 'in_progress', hold: 'qc_hold', qc_failed: 'qc_failed', bis: 'bis', approved: 'approved' };
              const isExpMod = expandedModStatus?.module === m.module;
              return (
                <div key={m.module} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '10px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', minWidth: '160px' }}>{m.module}</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{m.total} tickets</span>
                    {m.unassigned > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        {m.unassigned} unassigned
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {statuses.map(s => {
                        const count = m[s.key] || 0;
                        if (count === 0) return null;
                        const isActive = expandedModStatus?.module === m.module && expandedModStatus?.status === s.key;
                        return (
                          <span key={s.key}
                            onClick={async () => {
                              if (isActive) { setExpandedModStatus(null); setModTickets([]); return; }
                              setExpandedModStatus({ module: m.module, status: s.key, label: s.label });
                              setLoadingModTickets(true);
                              try {
                                const res = await fetch(`${API_BASE}/live/module-tickets/${encodeURIComponent(m.module)}?status_group=${statusToGroup[s.key] || s.key}`);
                                if (res.ok) { const d = await res.json(); setModTickets(d.tickets || []); }
                              } finally { setLoadingModTickets(false); }
                            }}
                            style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                              background: isActive ? s.color : `${s.color}15`, color: isActive ? '#fff' : s.color,
                              border: `1px solid ${s.color}` }}>
                            {s.label}: {count}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {/* Expanded ticket list for this module+status */}
                  {isExpMod && expandedModStatus && (
                    <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {expandedModStatus.module} — {expandedModStatus.label} ({modTickets.length})
                        <button className="btn btn-sm btn-secondary" onClick={() => { setExpandedModStatus(null); setModTickets([]); }} style={{ fontSize: '0.7rem' }}>Close</button>
                      </div>
                      {loadingModTickets ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : (
                        <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                          <thead>
                            <tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>QC Tester</th><th>Developer</th><th>Age</th><th>Est</th><th>Actual</th></tr>
                          </thead>
                          <tbody>
                            {modTickets.map(t => (
                              <tr key={t.ticket_id} className="qcq-row">
                                <td><a href={`https://www.bissafety.app/pm/tickets#!/${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</td>
                                <td><span className="qcq-status-badge">{t.status}</span></td>
                                <td>{t.priority}</td>
                                <td>
                                  {t.qc_tester && t.qc_tester !== '-' ? t.qc_tester : (
                                    t.suggested_assignee ? (
                                      <span title="Suggested based on module ownership & workload" style={{ color: 'var(--accent-green)', fontStyle: 'italic', fontSize: '0.72rem' }}>
                                        {t.suggested_assignee} ?
                                      </span>
                                    ) : <span style={{ color: 'var(--accent-red)' }}>Unassigned</span>
                                  )}
                                </td>
                                <td style={{ fontSize: '0.72rem' }}>{t.developers_str || '-'}</td>
                                <td style={{ textAlign: 'center', fontWeight: t.days_in_qc >= 7 ? 700 : 400, color: t.days_in_qc >= 15 ? 'var(--accent-red)' : t.days_in_qc >= 7 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                                  {t.days_in_qc > 0 ? `${t.days_in_qc}d` : '-'}
                                </td>
                                <td style={{ textAlign: 'center' }}>{t.qa_estimate_hours || '-'}</td>
                                <td style={{ textAlign: 'center' }}>{t.qa_actual_hours || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeView === 'members' && !showBIS && (
          <div className="qas-members-list">
            {teamStats.total_tickets_touched === 0 && (
              <div className="qcq-chart-panel" style={{ textAlign: 'center', padding: '30px' }}>
                <h3 style={{ marginBottom: '8px' }}>No activity data for this period</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  PM sync may be disabled or no status changes occurred in the selected period.
                  Try selecting <strong>Custom Range</strong> with a date range that has synced data.
                </p>
                <button className="btn btn-primary btn-sm" onClick={() => setPeriod('custom')}>
                  Switch to Custom Range
                </button>
              </div>
            )}
            {members.map((m, i) => (
              <MemberStoryCard key={m.employee_id} member={m} defaultExpanded={false} />
            ))}
          </div>
        )}

        {/* BIS to Closed Tab */}
        {activeView === 'bis' && bisData && (
          <div className="qcq-section">
            {/* Closed from BIS */}
            <h3 style={{ marginBottom: '10px' }}>Closed from BIS ({bisSummary.total_closed || 0}) — Avg {bisSummary.avg_days_bis_to_closed || 0} days</h3>
            <div className="qcq-table-container" style={{ marginBottom: '20px' }}>
              <table className="qcq-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Title</th>
                    <th>Priority</th>
                    <th>QC Tester</th>
                    <th>Entered BIS</th>
                    <th>Closed On</th>
                    <th>Closed Status</th>
                    <th>Days</th>
                    <th>Legs</th>
                  </tr>
                </thead>
                <tbody>
                  {(bisData.closed_tickets || []).length === 0 ? (
                    <tr><td colSpan="9" className="qcq-empty">No tickets closed from BIS yet</td></tr>
                  ) : (bisData.closed_tickets || []).map(t => (
                    <BISTableRow key={t.ticket_id} ticket={t} type="closed" />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Still Pending */}
            <h3 style={{ marginBottom: '10px' }}>Still Pending ({bisSummary.total_pending || 0}) — {bisSummary.still_in_bis || 0} still in BIS</h3>
            <div className="qcq-table-container">
              <table className="qcq-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Title</th>
                    <th>Priority</th>
                    <th>QC Tester</th>
                    <th>Entered BIS</th>
                    <th>Current Status</th>
                    <th>Days Since BIS</th>
                    <th>Legs</th>
                  </tr>
                </thead>
                <tbody>
                  {(bisData.pending_tickets || []).length === 0 ? (
                    <tr><td colSpan="8" className="qcq-empty">No pending BIS tickets</td></tr>
                  ) : (bisData.pending_tickets || []).map(t => (
                    <BISTableRow key={t.ticket_id} ticket={t} type="pending" />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
