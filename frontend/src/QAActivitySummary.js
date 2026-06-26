import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import { useComplexityMap, ComplexityBadge } from './complexity';
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
  const { entryOf } = useComplexityMap();
  if (tickets.length === 0) return <div className="qcq-empty" style={{ padding: '12px' }}>No tickets</div>;
  return (
    <div className="qcq-table-container">
      <table className="qcq-table">
        <thead>
          <tr>
            <SortTh field="ticket_id">Ticket</SortTh>
            <th>Title</th>
            <th>Complexity</th>
            <SortTh field="current_status">Status</SortTh>
            <SortTh field="priority_order">Priority</SortTh>
            <SortTh field="platform">Platform</SortTh>
            <th>Module</th>
            <th>Developer</th>
            <th>Ticket Type</th>
            <th>New/Refix</th>
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
              <td style={{textAlign:'center'}}><ComplexityBadge {...entryOf(t)} size="sm" /></td>
              <td><StatusBadge status={t.current_status} /></td>
              <td className="qcq-priority">{t.priority}</td>
              <td><span className={`qcq-platform-badge qcq-platform-${(t.platform || 'Web').toLowerCase()}`}>{t.platform}</span></td>
              <td>{t.module || '-'}</td>
              <td className="qcq-secondary">{t.developers_str || '-'}</td>
              <td style={{textAlign:'center'}}>{t.ticket_type || '-'}</td>
              <td style={{textAlign:'center'}}>{t.is_refix ? <span className="qcq-fail" style={{fontSize:'0.72rem'}}>Refix</span> : <span style={{color:'var(--accent-green)',fontSize:'0.72rem',fontWeight:600}}>New</span>}</td>
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

function PlatformGroupHeading({ platform, count }) {
  const isMobile = platform === 'Mobile';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '18px 0 10px',
      fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)',
      textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
        background: isMobile ? 'var(--accent-purple, #8b5cf6)' : 'var(--accent-teal)' }} />
      {isMobile ? 'Mobile Team' : 'Web Team'}{typeof count === 'number' ? ` (${count})` : ''}
      <span style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
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
        {(() => {
          const allActive = Object.values(grouped).flat();
          const firstTime = allActive.filter(t => !t.is_refix).length;
          const refix = allActive.filter(t => t.is_refix).length;
          return (<>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{allActive.length} tickets</span>
            {firstTime > 0 && <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '3px', background: 'rgba(34,197,94,0.12)', color: 'var(--accent-green)', fontWeight: 600 }}>New: {firstTime}</span>}
            {refix > 0 && <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '3px', background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red)', fontWeight: 600 }}>Refix: {refix}</span>}
          </>);
        })()}
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

const PM_TICKET_URL = 'https://pm.bissafety.app/tickets/';

// Normalize a person name for matching across data sources (strip "(initials)", trim, lowercase).
const normName = (s) => (s || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();

// Pop-out drawer: the full list of tickets currently in a person's Assign-To field, with filters + sort.
const TEAM_COLORS = { Dev: 'var(--accent-blue)', QA: 'var(--accent-green)', BIS: 'var(--accent-purple, #8b5cf6)' };
const priColor = (p) => {
  const s = (p || '').toLowerCase();
  if (s.includes('critical') || s.includes('level 1') || s.includes('urgent')) return 'var(--accent-red, #ef4444)';
  if (s.includes('high')) return 'var(--accent-amber, #f59e0b)';
  if (s.includes('medium')) return 'var(--accent-blue, #3b82f6)';
  if (s.includes('low')) return 'var(--text-muted, #94a3b8)';
  return 'var(--text-secondary, #cbd5e1)';
};
const fmtDate = (d) => { if (!d) return '-'; const dt = new Date(d); return isNaN(dt) ? '-' : dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }); };
const ageDays = (d) => { if (!d) return null; const dt = new Date(d); if (isNaN(dt)) return null; return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000)); };

// priority rank for sorting (uses priority_order when present, else maps the priority text).
const priRank = (t) => {
  if (t.priority_order != null) return t.priority_order;
  const s = (t.priority || '').toLowerCase();
  if (s.includes('critical') || s.includes('level 1') || s.includes('urgent')) return 0;
  if (s.includes('high')) return 1;
  if (s.includes('medium')) return 2;
  if (s.includes('low')) return 3;
  return 9;
};

// Reusable rich, filterable, sortable ticket table with a ticket-ID/title search box. Used by BOTH the
// Assign-To drawer and the Dev Team per-developer list. Field names are normalized so it works for both
// payloads (dev hours: dev_actual_hours vs actual_dev_hours). Give it a `key` per person so its internal
// filters + search reset automatically when a different person is selected.
function RichTicketTable({ tickets, scrollMax = '70vh' }) {
  const { entryOf } = useComplexityMap();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('priority_order');
  const [sortDir, setSortDir] = useState('asc');
  const [fStatus, setFStatus] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fType, setFType] = useState('');
  const [fModule, setFModule] = useState('');
  const [fPlatform, setFPlatform] = useState('');
  const [fRefix, setFRefix] = useState('');
  const list = (tickets || []).map(t => { const e = entryOf(t); return { ...t, complexity: e.level, complexity_score: e.score, complexity_overridden: e.overridden }; });
  const devAct = (t) => (t.dev_actual_hours != null ? t.dev_actual_hours : t.actual_dev_hours) || 0;
  // Hide columns that carry no data in this context (e.g. the Dev Team list has no QA hours / type / age).
  const hasType = list.some(t => t.ticket_type);
  const hasAge = list.some(t => t.created_on);
  const hasQa = list.some(t => t.qa_estimate_hours != null || t.qa_actual_hours != null);
  const colCount = 13 + (hasType ? 1 : 0) + (hasAge ? 1 : 0) + (hasQa ? 1 : 0);
  const distinct = (key, dflt) => [...new Set(list.map(t => t[key] || dflt).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const rows = list.filter(t =>
    (!q || String(t.ticket_id).includes(q) || (t.title || '').toLowerCase().includes(q)) &&
    (!fStatus || t.status === fStatus) &&
    (!fPriority || t.priority === fPriority) &&
    (!fType || (t.ticket_type || '') === fType) &&
    (!fModule || (t.module || '') === fModule) &&
    (!fPlatform || (t.platform || 'Web') === fPlatform) &&
    (!fRefix || (fRefix === 'refix' ? t.is_refix : !t.is_refix)));
  const sorted = [...rows].sort((a, b) => {
    let av, bv;
    if (sortField === 'priority_order') { av = priRank(a); bv = priRank(b); }
    else if (sortField === 'dev_hrs') { av = a.dev_estimate_hours || 0; bv = b.dev_estimate_hours || 0; }
    else if (sortField === 'qa_hrs') { av = a.qa_estimate_hours || 0; bv = b.qa_estimate_hours || 0; }
    else if (sortField === 'age') { av = ageDays(a.created_on) ?? -1; bv = ageDays(b.created_on) ?? -1; }
    else if (sortField === 'cycle_count') { av = a.is_refix ? (a.cycle_count || 1) : 0; bv = b.is_refix ? (b.cycle_count || 1) : 0; }
    else if (sortField === 'eta') { av = a.eta ? new Date(a.eta).getTime() : Infinity; bv = b.eta ? new Date(b.eta).getTime() : Infinity; }
    else if (sortField === 'bugs') { av = (a.bugs_open || 0) + (a.bugs_reopen || 0) + (a.bugs_fixed || 0) + (a.bugs_closed || 0); bv = (b.bugs_open || 0) + (b.bugs_reopen || 0) + (b.bugs_fixed || 0) + (b.bugs_closed || 0); }
    else if (sortField === 'ticket_id') { av = a.ticket_id; bv = b.ticket_id; }
    else if (sortField === 'complexity_score') { av = a.complexity_score || 0; bv = b.complexity_score || 0; }
    else { av = (a[sortField] ?? '').toString().toLowerCase(); bv = (b[sortField] ?? '').toString().toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const Th = ({ field, children, w, align, title }) => (
    <th title={title} onClick={() => { if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(field); setSortDir('asc'); } }}
      style={{ position: 'sticky', top: 0, zIndex: 1, cursor: 'pointer', whiteSpace: 'nowrap', textAlign: align || 'left',
        width: w, minWidth: w, padding: '8px 10px', background: 'var(--bg-tertiary, #1e293b)', borderBottom: '2px solid var(--border-color)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.02em', color: 'var(--text-secondary)' }}>
      {children}{sortField === field && <span style={{ color: 'var(--accent-teal,#14b8a6)' }}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
    </th>
  );
  const Sel = ({ value, set, opts, label }) => (
    <select value={value} onChange={e => set(e.target.value)} className="qcq-search-input" style={{ width: 'auto', minWidth: 112, fontSize: '0.76rem' }}>
      <option value="">{label}</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const anyFilter = search || fStatus || fPriority || fType || fModule || fPlatform || fRefix;
  const td = { padding: '7px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', borderBottom: '1px solid var(--border-color)' };
  return (
    <>
      <div style={{ padding: '10px 4px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticket # or title…" className="qcq-search-input"
          style={{ width: 200, fontSize: '0.78rem' }} />
        <Sel value={fStatus} set={setFStatus} opts={distinct('status')} label="All status" />
        <Sel value={fPriority} set={setFPriority} opts={distinct('priority')} label="All priority" />
        <Sel value={fType} set={setFType} opts={distinct('ticket_type')} label="All types" />
        <Sel value={fModule} set={setFModule} opts={distinct('module')} label="All modules" />
        <Sel value={fPlatform} set={setFPlatform} opts={distinct('platform', 'Web')} label="All platforms" />
        <select value={fRefix} onChange={e => setFRefix(e.target.value)} className="qcq-search-input" style={{ width: 'auto', minWidth: 112, fontSize: '0.76rem' }}>
          <option value="">All (refix + first)</option>
          <option value="refix">Refix only</option>
          <option value="first">First-time only</option>
        </select>
        {anyFilter ? <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setFStatus(''); setFPriority(''); setFType(''); setFModule(''); setFPlatform(''); setFRefix(''); }}>Clear</button> : null}
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing <strong style={{ color: 'var(--text-secondary)' }}>{sorted.length}</strong> of {list.length}</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: scrollMax }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.79rem' }}>
          <thead><tr>
            <Th field="ticket_id" w={64} align="center">Ticket</Th>
            <Th field="title" w={360}>Title</Th>
            <Th field="complexity_score" w={96} align="center">Complexity</Th>
            <Th field="cycle_count" w={84} align="center" title="Refix / retest — returned to QC after a fail">Refix</Th>
            <Th field="status" w={150}>Status</Th>
            <Th field="priority_order" w={120}>Priority</Th>
            {hasType && <Th field="ticket_type" w={96}>Type</Th>}
            <Th field="module" w={130}>Module</Th>
            <Th field="platform" w={82} align="center">Platform</Th>
            <Th field="qc_tester" w={120}>QC Tester</Th>
            <Th field="developers_str" w={140}>Developer</Th>
            <Th field="eta" w={84} align="center">ETA</Th>
            {hasAge && <Th field="age" w={66} align="center">Age</Th>}
            <Th field="dev_hrs" w={96} align="center" title="Dev hours — Estimated / Actual">Dev E/A</Th>
            {hasQa && <Th field="qa_hrs" w={96} align="center" title="QA hours — Estimated / Actual">QA E/A</Th>}
            <Th field="bugs" w={128} align="center" title="Bugs — Open / Reopened / Fixed / Closed">Bugs O/R/F/C</Th>
          </tr></thead>
          <tbody>
            {sorted.length === 0 ? <tr><td colSpan={colCount} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No tickets match.</td></tr> :
              sorted.map((t, i) => {
                const age = ageDays(t.created_on);
                return (
                <tr key={t.ticket_id} style={{ background: i % 2 ? 'rgba(148,163,184,0.04)' : 'transparent' }}>
                  <td style={{ ...td, textAlign: 'center' }}><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link" style={{ fontWeight: 600 }}>#{t.ticket_id}</a></td>
                  <td style={{ ...td, width: 360, minWidth: 360, maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top', lineHeight: 1.35 }}>{t.title}</td>
                  <td style={{ ...td, textAlign: 'center' }}><ComplexityBadge level={t.complexity} overridden={t.complexity_overridden} size="sm" /></td>
                  <td style={{ ...td, textAlign: 'center' }}>{t.is_refix
                    ? <span title={`Returned to QC after a fail${t.cycle_count > 0 ? ` — ${t.cycle_count}x` : ''}`} style={{ color: 'var(--accent-amber, #f59e0b)', fontWeight: 700, fontSize: '0.74rem', whiteSpace: 'nowrap' }}>⟳ {t.cycle_count > 0 ? `r${t.cycle_count}` : 'Refix'}</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={td}><span className="qcq-status-badge" style={{ whiteSpace: 'nowrap' }}>{t.status}</span></td>
                  <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: priColor(t.priority) }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: priColor(t.priority) }} />{t.priority || '-'}</span></td>
                  {hasType && <td style={{ ...td, color: 'var(--text-secondary)' }}>{t.ticket_type || '-'}</td>}
                  <td style={{ ...td, color: 'var(--text-secondary)' }}>{t.module || '-'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{t.platform || '-'}</td>
                  <td style={td}>{t.qc_tester || '-'}</td>
                  <td style={{ ...td, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{t.developers_str && t.developers_str !== 'Not Assigned' ? t.developers_str : (t.current_assignee || '-')}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{fmtDate(t.eta)}</td>
                  {hasAge && <td style={{ ...td, textAlign: 'center', color: age != null && age > 14 ? 'var(--accent-amber)' : 'var(--text-muted)', fontWeight: age != null && age > 14 ? 700 : 400 }}>{age != null ? `${age}d` : '-'}</td>}
                  <td style={{ ...td, textAlign: 'center', fontSize: '0.74rem' }} title="Dev Estimated / Actual">{(t.dev_estimate_hours || 0) || '-'} / {devAct(t) || '-'}</td>
                  {hasQa && <td style={{ ...td, textAlign: 'center', fontSize: '0.74rem' }} title="QA Estimated / Actual">{(t.qa_estimate_hours || 0) || '-'} / {(t.qa_actual_hours || 0) || '-'}</td>}
                  <td style={{ ...td, textAlign: 'center' }} title="Open / Reopened / Fixed / Closed">{(() => {
                    const o = t.bugs_open || 0, r = t.bugs_reopen || 0, f = t.bugs_fixed || 0, c = t.bugs_closed || 0;
                    if (!(o || r || f || c)) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                    const C = (n, col) => <span style={{ color: n > 0 ? col : 'var(--text-muted)', fontWeight: n > 0 ? 700 : 400, fontSize: '0.74rem' }}>{n}</span>;
                    return <span style={{ display: 'inline-flex', gap: 6 }}>{C(o, 'var(--accent-red,#ef4444)')}<span style={{ color: 'var(--border-color)' }}>/</span>{C(r, 'var(--accent-amber,#f59e0b)')}<span style={{ color: 'var(--border-color)' }}>/</span>{C(f, 'var(--accent-blue,#3b82f6)')}<span style={{ color: 'var(--border-color)' }}>/</span>{C(c, 'var(--accent-green,#22c55e)')}</span>;
                  })()}</td>
                </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AssignDrawer({ person, onClose }) {
  if (!person) return null;
  const tickets = person.tickets || [];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1280px, 96vw)', height: '100%', background: 'var(--bg-primary, #0f172a)', borderLeft: '1px solid var(--border-color)', boxShadow: '-12px 0 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--bg-secondary, #1e293b)' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: TEAM_COLORS[person.team] || 'var(--text-muted)' }} />
          <strong style={{ fontSize: '1.05rem' }}>{person.name}</strong>
          {person.team && <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: `${TEAM_COLORS[person.team] || 'var(--text-muted)'}22`, color: TEAM_COLORS[person.team] || 'var(--text-muted)', fontWeight: 700 }}>{person.team}</span>}
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Assigned to (active):</span>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent-teal, #14b8a6)' }}>{tickets.length}</span>
          <button onClick={onClose} className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}>✕ Close</button>
        </div>
        <div style={{ padding: '4px 20px 16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <RichTicketTable tickets={tickets} scrollMax="calc(100vh - 150px)" key={person.name} />
        </div>
      </div>
    </div>
  );
}

export default function QAActivitySummary() {
  const { entryOf: cxOf } = useComplexityMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('past_5_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState(null);
  const [bisData, setBisData] = useState(null);
  const [devData, setDevData] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [showBIS, setShowBIS] = useState(false);
  const [activeView, setActiveView] = useState('members');
  const [moduleWorkload, setModuleWorkload] = useState([]);
  const [expandedModStatus, setExpandedModStatus] = useState(null);
  const [modTickets, setModTickets] = useState([]);
  const [loadingModTickets, setLoadingModTickets] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [devExpandedName, setDevExpandedName] = useState(null);
  const [devStatusFilter, setDevStatusFilter] = useState('');
  const [devFlagFilter, setDevFlagFilter] = useState('');
  const [assignData, setAssignData] = useState(null);
  const [assignTeamFilter, setAssignTeamFilter] = useState('all');
  const [assignExpanded, setAssignExpanded] = useState(null);
  const [assignStatusFilter, setAssignStatusFilter] = useState('');
  const [assignDrawer, setAssignDrawer] = useState(null); // Dev Team tab: Assign-To drill-down person

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
      const [summaryRes, bisRes, qcRes, devRes] = await Promise.all([
        safeFetch(url),
        safeFetch('/live/bis-to-closed'),
        safeFetch('/live/qc-queue'),
        safeFetch('/live/dev-dashboard'),
      ]);
      if (summaryRes?.ok) setData(await summaryRes.json());
      if (bisRes?.ok) setBisData(await bisRes.json());
      if (qcRes?.ok) {
        const qcData = await qcRes.json();
        setModuleWorkload(qcData.module_workload || []);
      }
      if (devRes?.ok) setDevData(await devRes.json());
      const assignRes = await safeFetch('/live/assign-to-summary');
      if (assignRes?.ok) setAssignData(await assignRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [syncing, setSyncing] = useState(false);
  const forceRefresh = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
      setExpandedModStatus(null); setModTickets([]);
      setDevExpandedName(null); setDevStatusFilter(''); setDevFlagFilter('');
      setAssignExpanded(null); setAssignStatusFilter(''); setAssignDrawer(null);
      await fetchData();
    } finally { setSyncing(false); }
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
  // QA testers who belong to the Mobile team regardless of the subdepartment on their
  // tickets (their ticket subdepartment can read Web). Matched case-insensitively by name.
  const MOBILE_QA_NAMES = ['gautam', 'gautham', 'arya'];
  const qaPlatform = (m) => {
    const tokens = (m.name || '').toLowerCase().split(/\s+/);
    if (MOBILE_QA_NAMES.some(x => tokens.includes(x))) return 'Mobile';
    return (m.platform || 'Web') === 'Mobile' ? 'Mobile' : 'Web';
  };
  const members = (data?.members || []).filter(m => {
    // Platform filter
    if (platformFilter !== 'all' && qaPlatform(m) !== platformFilter) return false;
    // Search filter
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      return (m.name || '').toLowerCase().includes(s) ||
        (m.tickets || []).some(t =>
          String(t.ticket_id).includes(s) || (t.title || '').toLowerCase().includes(s)
        );
    }
    return true;
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Members with at least one ticket currently "Approved for Live".
  const approvedCount = (m) => (m.tickets || []).filter(t => t.current_status === 'Approved for Live').length;
  const membersWithApproved = members.filter(m => approvedCount(m) > 0);

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
            <h1>Activity Summary</h1>
            <p className="header-subtitle">QA & Dev team activity — {formatDateRange()}</p>
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
            QA Team ({members.length})
          </button>
          <button className={`qcq-tab ${activeView === 'dev_team' ? 'active' : ''}`} onClick={() => setActiveView('dev_team')}>
            Dev Team ({devData?.developers?.length || 0})
          </button>
          <button className={`qcq-tab ${activeView === 'modules' ? 'active' : ''}`} onClick={() => setActiveView('modules')}>
            QA Module ({moduleWorkload.length})
          </button>
          <button className={`qcq-tab ${activeView === 'dev_modules' ? 'active' : ''}`} onClick={() => setActiveView('dev_modules')}>
            Dev Module ({devData?.modules?.length || 0})
          </button>
          <button className={`qcq-tab ${activeView === 'assigned_to' ? 'active' : ''}`} onClick={() => setActiveView('assigned_to')}>
            Assign To ({assignData?.total || 0})
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
                            <tr><th>Ticket</th><th>Title</th><th>Complexity</th><th>Status</th><th>Priority</th><th>QC Tester</th><th>Developer</th><th>Age</th><th>Est</th><th>Actual</th></tr>
                          </thead>
                          <tbody>
                            {modTickets.map(t => (
                              <tr key={t.ticket_id} className="qcq-row">
                                <td><a href={`https://pm.bissafety.app/tickets/${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</td>
                                <td style={{ textAlign: 'center' }}><ComplexityBadge {...cxOf(t)} size="sm" /></td>
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

        {activeView === 'members' && !showBIS && (() => {
          const shown = approvedOnly ? membersWithApproved : members;
          const webMembers = shown.filter(m => qaPlatform(m) !== 'Mobile');
          const mobileMembers = shown.filter(m => qaPlatform(m) === 'Mobile');
          return (
          <div className="qas-members-list">
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <button className={`btn btn-sm ${approvedOnly ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.72rem', borderColor: 'var(--accent-teal)',
                  color: approvedOnly ? '#fff' : 'var(--accent-teal)',
                  background: approvedOnly ? 'var(--accent-teal)' : 'transparent' }}
                onClick={() => setApprovedOnly(v => !v)}>
                Approved for Live ({membersWithApproved.length})
              </button>
              {approvedOnly && (
                <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.72rem' }}
                  onClick={() => setApprovedOnly(false)}>Clear</button>
              )}
            </div>
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
            {webMembers.length > 0 && <PlatformGroupHeading platform="Web" count={webMembers.length} />}
            {webMembers.map((m) => (
              <MemberStoryCard key={m.employee_id} member={m} defaultExpanded={false} />
            ))}
            {mobileMembers.length > 0 && <PlatformGroupHeading platform="Mobile" count={mobileMembers.length} />}
            {mobileMembers.map((m) => (
              <MemberStoryCard key={m.employee_id} member={m} defaultExpanded={false} />
            ))}
          </div>
          );
        })()}

        {/* BIS to Closed Tab */}
        {/* Dev Module Activity Tab */}
        {activeView === 'dev_modules' && devData && (() => {
          const devModules = (devData.modules || []).filter(m => m.total > 0);
          const devModStatuses = [
            { key: 'in_progress', label: 'In Progress', color: 'var(--accent-green)' },
            { key: 'code_review', label: 'Code Review', color: 'var(--accent-blue)' },
            { key: 'ready_for_qc', label: 'CR Passed', color: 'var(--accent-teal)' },
            { key: 'ready_for_dev', label: 'Ready For Dev', color: 'var(--text-muted)' },
            { key: 'refix', label: 'Refix', color: 'var(--accent-red)' },
            { key: 'qc_testing', label: 'QC Testing', color: 'var(--accent-purple, #8b5cf6)' },
            { key: 'qc_failed', label: 'QC Failed', color: 'var(--accent-red)' },
            { key: 'bis', label: 'BIS', color: 'var(--accent-amber)' },
            { key: 'approved', label: 'Approved', color: '#06b6d4' },
            { key: 'moved_to_live', label: 'Moved to Live', color: 'var(--accent-green)' },
          ];
          const devModStatusToGroup = {
            in_progress: 'dev_in_progress', code_review: 'dev_pipeline', ready_for_qc: 'cr_passed',
            ready_for_dev: 'dev_pipeline', refix: 'dev_refix',
            qc_testing: 'qc_active', qc_failed: 'qc_failed', bis: 'bis', approved: 'approved',
          };
          return (
          <div className="qcq-section">
            {devModules.map(m => {
              const isExp = expandedModStatus?.module === `dev_${m.module}`;
              return (
                <div key={m.module} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '10px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', minWidth: '160px' }}>{m.module}</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{m.total} tickets</span>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {devModStatuses.map(s => {
                        const count = m[s.key] || 0;
                        if (count === 0) return null;
                        const isActive = expandedModStatus?.module === `dev_${m.module}` && expandedModStatus?.status === s.key;
                        return (
                          <span key={s.key}
                            onClick={async () => {
                              if (isActive) { setExpandedModStatus(null); setModTickets([]); return; }
                              setExpandedModStatus({ module: `dev_${m.module}`, status: s.key, label: s.label });
                              setLoadingModTickets(true);
                              try {
                                const group = devModStatusToGroup[s.key] || s.key;
                                const res = await fetch(`${API_BASE}/live/module-tickets/${encodeURIComponent(m.module)}?status_group=${group}`);
                                if (res.ok) { const d = await res.json(); setModTickets(d.tickets || []); }
                              } finally { setLoadingModTickets(false); }
                            }}
                            style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                              background: isActive ? s.color : `${s.color}15`, color: isActive ? '#fff' : s.color,
                              border: `1px solid ${s.color}` }}>
                            {s.label}: {count}
                          </span>
                        );
                      })}
                    </div>
                    {/* Developers list */}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(m.developers || []).slice(0, 3).map(d => <span key={d} className="rp-tag rp-tag-support" style={{ fontSize: '0.63rem' }}>{d}</span>)}
                      {(m.developers || []).length > 3 && <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>+{m.developers.length - 3}</span>}
                    </div>
                  </div>
                  {/* Expanded ticket list */}
                  {isExp && (
                    <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {m.module} — {expandedModStatus.label} ({modTickets.length})
                        <button className="btn btn-sm btn-secondary" onClick={() => { setExpandedModStatus(null); setModTickets([]); }} style={{ fontSize: '0.7rem' }}>Close</button>
                      </div>
                      {loadingModTickets ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : (
                        <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                          <thead>
                            <tr><th>Ticket</th><th>Title</th><th>Complexity</th><th>Status</th><th>Priority</th><th>Developer</th><th>QC Tester</th><th>Est Hrs</th><th>Actual Hrs</th><th>ETA</th></tr>
                          </thead>
                          <tbody>
                            {modTickets.map(t => (
                              <tr key={t.ticket_id} className="qcq-row">
                                <td style={{textAlign:'center'}}><a href={`https://pm.bissafety.app/tickets/${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                <td style={{ maxWidth: '220px', wordBreak: 'break-word', whiteSpace: 'normal', textAlign: 'left' }}>{t.title}</td>
                                <td style={{ textAlign: 'center' }}><ComplexityBadge {...cxOf(t)} size="sm" /></td>
                                <td style={{textAlign:'center'}}><span className="qcq-status-badge">{t.status}</span></td>
                                <td style={{textAlign:'center'}}>{t.priority}</td>
                                <td style={{textAlign:'center', fontSize:'0.72rem'}}>{t.developers_str || '-'}</td>
                                <td style={{textAlign:'center'}}>{t.qc_tester || '-'}</td>
                                <td style={{textAlign:'center'}}>{t.qa_estimate_hours || '-'}</td>
                                <td style={{textAlign:'center'}}>{t.qa_actual_hours || '-'}</td>
                                <td style={{textAlign:'center'}}>{t.eta ? new Date(t.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
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
          </div>);
        })()}

        {/* Assigned To Tab */}
        {activeView === 'assigned_to' && assignData && (() => {
          const teamColors = { Dev: 'var(--accent-blue)', QA: 'var(--accent-green)', BIS: 'var(--accent-purple, #8b5cf6)' };
          const persons = (assignData.persons || []).filter(p => {
            if (assignTeamFilter !== 'all' && p.team !== assignTeamFilter) return false;
            if (searchFilter && !p.name.toLowerCase().includes(searchFilter.toLowerCase())) return false;
            return true;
          });
          const teamCounts = { Dev: 0, QA: 0, BIS: 0 };
          (assignData.persons || []).forEach(p => { teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });

          return (
          <div className="qcq-section">
            {/* Team filter */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
              <div className="qcq-platform-toggle">
                {['all', 'Dev', 'QA', 'BIS'].map(t => (
                  <button key={t} className={`btn btn-sm ${assignTeamFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAssignTeamFilter(t)}>
                    {t === 'all' ? `All (${assignData.total})` : `${t} (${teamCounts[t] || 0})`}
                  </button>
                ))}
              </div>
            </div>

            {persons.map(p => {
              const isExp = assignExpanded === p.name;
              const DEV_STS = new Set(['Ready For Development','In Progress','Hold/Pending','Start Code Review','Code Review Failed','Code Review Passed','Express Lane Review']);
              const QA_STS = new Set(['QC Testing','QC Testing in Progress','QC Testing Hold','QC Review Fail']);
              const BIS_STS = new Set(['BIS Testing','Approved for Live','Moved to Live']);
              return (
                <div key={p.name} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '8px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', cursor: 'pointer' }}
                      onClick={() => { setAssignExpanded(isExp ? null : p.name); setAssignStatusFilter(''); }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: teamColors[p.team] || 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{p.name}</span>
                      <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '3px', background: `${teamColors[p.team] || 'var(--text-muted)'}20`, color: teamColors[p.team] || 'var(--text-muted)', fontWeight: 600 }}>{p.team}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isExp ? '\u25B2' : '\u25BC'}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{p.total} tickets</span>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {p.dev > 0 && (
                        <span onClick={() => { setAssignExpanded(p.name); setAssignStatusFilter(assignExpanded === p.name && assignStatusFilter === 'dev' ? '' : 'dev'); }}
                          style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                            background: assignExpanded === p.name && assignStatusFilter === 'dev' ? 'var(--accent-blue)' : 'rgba(59,130,246,0.12)',
                            color: assignExpanded === p.name && assignStatusFilter === 'dev' ? '#fff' : 'var(--accent-blue)',
                            border: '1px solid var(--accent-blue)' }}>
                          Dev: {p.dev}
                        </span>
                      )}
                      {p.qa > 0 && (
                        <span onClick={() => { setAssignExpanded(p.name); setAssignStatusFilter(assignExpanded === p.name && assignStatusFilter === 'qa' ? '' : 'qa'); }}
                          style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                            background: assignExpanded === p.name && assignStatusFilter === 'qa' ? 'var(--accent-green)' : 'rgba(34,197,94,0.12)',
                            color: assignExpanded === p.name && assignStatusFilter === 'qa' ? '#fff' : 'var(--accent-green)',
                            border: '1px solid var(--accent-green)' }}>
                          QA: {p.qa}
                        </span>
                      )}
                      {p.bis > 0 && (
                        <span onClick={() => { setAssignExpanded(p.name); setAssignStatusFilter(assignExpanded === p.name && assignStatusFilter === 'bis' ? '' : 'bis'); }}
                          style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                            background: assignExpanded === p.name && assignStatusFilter === 'bis' ? 'var(--accent-purple, #8b5cf6)' : 'rgba(139,92,246,0.12)',
                            color: assignExpanded === p.name && assignStatusFilter === 'bis' ? '#fff' : 'var(--accent-purple, #8b5cf6)',
                            border: '1px solid var(--accent-purple, #8b5cf6)' }}>
                          BIS: {p.bis}
                        </span>
                      )}
                      {p.other > 0 && (
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Other: {p.other}
                        </span>
                      )}
                    </div>
                  </div>

                  {isExp && (
                    <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-color)' }}>
                      {(() => {
                        let filtered = p.tickets || [];
                        if (assignStatusFilter === 'dev') filtered = filtered.filter(t => DEV_STS.has(t.status));
                        else if (assignStatusFilter === 'qa') filtered = filtered.filter(t => QA_STS.has(t.status));
                        else if (assignStatusFilter === 'bis') filtered = filtered.filter(t => BIS_STS.has(t.status));
                        // Group by status
                        const grouped = {};
                        filtered.forEach(t => { if (!grouped[t.status]) grouped[t.status] = []; grouped[t.status].push(t); });
                        return Object.entries(grouped).sort((a,b) => b[1].length - a[1].length).map(([status, tix]) => (
                          <div key={status} style={{ marginTop: '8px' }}>
                            <h4 style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{status} ({tix.length})</h4>
                            <table className="qcq-table" style={{ fontSize: '0.76rem' }}>
                              <thead><tr><th>Ticket</th><th>Title</th><th>Complexity</th><th>Status</th><th>Priority</th><th>Platform</th><th>Module</th><th>QC Tester</th><th>Developer</th><th>Est Hrs</th></tr></thead>
                              <tbody>
                                {tix.map(t => (
                                  <tr key={t.ticket_id} className="qcq-row">
                                    <td style={{textAlign:'center'}}><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                                    <td style={{ maxWidth: '220px', wordBreak: 'break-word', whiteSpace: 'normal', textAlign: 'left' }}>{t.title}</td>
                                <td style={{ textAlign: 'center' }}><ComplexityBadge {...cxOf(t)} size="sm" /></td>
                                    <td style={{textAlign:'center'}}><span className="qcq-status-badge">{t.status}</span></td>
                                    <td style={{textAlign:'center'}}>{t.priority}</td>
                                    <td style={{textAlign:'center'}}>{t.platform || '-'}</td>
                                    <td style={{textAlign:'center'}}>{t.module || '-'}</td>
                                    <td style={{textAlign:'center'}}>{t.qc_tester || '-'}</td>
                                    <td style={{textAlign:'center', fontSize: '0.72rem' }}>{t.developers_str || '-'}</td>
                                    <td style={{textAlign:'center'}}>{t.qa_estimate_hours || t.dev_estimate_hours || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>);
        })()}

        {/* Dev Team Tab */}
        {activeView === 'dev_team' && devData && (() => {
          // Developer allocation buckets by ticket status (per ops mapping):
          //   Fully Allocated     → developer is actively working the ticket
          //   Partially Allocated → light / transitional engagement
          //   Not Utilised        → ticket parked or out of the dev's hands (free for new work)
          const FULLY_STS = new Set(['In Progress', 'Code Review Failed', 'Code Review Passed', 'QC Review Fail', 'Tested - Awaiting Fixes']);
          const PARTIAL_STS = new Set(['Ready For Development', 'Approved for Live', 'QC Testing in Progress', 'Start Code Review']);
          // Everything else active (Hold/Pending, QC Testing, QC Testing Hold, BIS Testing,
          // Testing In Progress, Moved to Live, Express Lane Review) falls through to Not Utilised.
          const devBucket = (status) => FULLY_STS.has(status) ? 'fully' : PARTIAL_STS.has(status) ? 'partial' : 'notutil';
          const getFlag = (d) => {
            // Active tickets only — 'Moved to Live'/'Closed' are shipped and not shown here.
            const tickets = (d.tickets || []).filter(t => !CLOSED_STATUSES_SET.has(t.status));
            if (tickets.length === 0) return 'No Tickets';
            if (tickets.some(t => FULLY_STS.has(t.status))) return 'Fully Allocated';
            if (tickets.some(t => PARTIAL_STS.has(t.status))) return 'Partially Allocated';
            return 'Not Utilised';
          };
          const allDevs = (devData.developers || []).map(d => ({ ...d, _flag: getFlag(d) }));
          const flagCounts = {};
          allDevs.forEach(d => { flagCounts[d._flag] = (flagCounts[d._flag] || 0) + 1; });
          // Assign-To lens: tickets currently in each person's "Assign To" field (active), from
          // /live/assign-to-summary, matched to the dev by normalized name.
          const assignByName = {};
          (assignData?.persons || []).forEach(p => { assignByName[normName(p.name)] = p; });

          // Developers have no single platform field — derive it from the plurality of
          // their active tickets so Web devs can be grouped above Mobile devs.
          const devPlatform = (d) => {
            let web = 0, mob = 0;
            (d.tickets || []).filter(t => !CLOSED_STATUSES_SET.has(t.status)).forEach(t => {
              if ((t.platform || 'Web') === 'Mobile') mob++; else web++;
            });
            return mob > web ? 'Mobile' : 'Web';
          };
          const devs = allDevs.filter(d => {
            if (devFlagFilter && d._flag !== devFlagFilter) return false;
            if (searchFilter) {
              const s = searchFilter.toLowerCase();
              return d.name.toLowerCase().includes(s) || (d.modules || []).some(m => m.toLowerCase().includes(s));
            }
            return true;
          }).map(d => ({ ...d, _platform: devPlatform(d) }))
            .sort((a, b) => {
              const pa = a._platform === 'Mobile' ? 1 : 0;
              const pb = b._platform === 'Mobile' ? 1 : 0;
              if (pa !== pb) return pa - pb;
              return a.name.localeCompare(b.name);
            });
          const webDevCount = devs.filter(d => d._platform !== 'Mobile').length;
          const mobileDevCount = devs.length - webDevCount;
          const devStatusDefs = [
            { key: 'in_progress', label: 'In Progress', color: 'var(--accent-green)' },
            { key: 'code_review', label: 'Code Review', color: 'var(--accent-blue)' },
            { key: 'ready_for_qc', label: 'CR Passed', color: 'var(--accent-teal)' },
            { key: 'ready_for_dev', label: 'Ready for Dev', color: 'var(--text-muted)' },
            { key: 'qc_testing', label: 'QC Testing', color: 'var(--accent-purple, #8b5cf6)' },
            { key: 'qc_failed', label: 'QC Review Fail', color: 'var(--accent-red)' },
            { key: 'bis', label: 'BIS', color: 'var(--accent-amber)' },
            { key: 'approved', label: 'Approved', color: '#06b6d4' },
            { key: 'moved_to_live', label: 'Moved to Live', color: 'var(--accent-green)' },
          ];
          const statusToActual = {
            in_progress: ['In Progress', 'Hold/Pending'],
            code_review: ['Start Code Review', 'Code Review Failed', 'Express Lane Review'],
            ready_for_qc: ['Code Review Passed'],
            ready_for_dev: ['Ready For Development'],
            qc_testing: ['QC Testing', 'QC Testing in Progress', 'QC Testing Hold'],
            qc_failed: ['QC Review Fail'],
            bis: ['BIS Testing'],
            approved: ['Approved for Live'],
            moved_to_live: ['Moved to Live'],
          };
          return (
          <div className="qcq-section">
            {/* Flag filters */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
              {[
                { key: '', label: `All (${allDevs.length})`, color: 'var(--accent-blue)' },
                { key: 'Fully Allocated', label: `Fully Allocated (${flagCounts['Fully Allocated'] || 0})`, color: 'var(--accent-green)' },
                { key: 'Partially Allocated', label: `Partially Allocated (${flagCounts['Partially Allocated'] || 0})`, color: 'var(--accent-amber)' },
                { key: 'Not Utilised', label: `Not Utilised (${flagCounts['Not Utilised'] || 0})`, color: 'var(--accent-red)' },
                { key: 'No Tickets', label: `No Tickets (${flagCounts['No Tickets'] || 0})`, color: 'var(--text-muted)' },
              ].map(f => (
                <button key={f.key} className={`btn btn-sm ${devFlagFilter === f.key ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.72rem', borderColor: f.color, color: devFlagFilter === f.key ? '#fff' : f.color,
                    background: devFlagFilter === f.key ? f.color : 'transparent' }}
                  onClick={() => setDevFlagFilter(devFlagFilter === f.key ? '' : f.key)}>
                  {f.label}
                </button>
              ))}
            </div>

            {devs.map((dev, idx) => {
              const isExpanded = devExpandedName === dev.name;
              // Heading shown before the first dev of each platform group (Web first, Mobile last).
              const showGroupHeading = idx === 0 || devs[idx - 1]._platform !== dev._platform;
              // Show only active tickets; shipped 'Moved to Live'/'Closed' are excluded so the
              // count, status badges, and expanded list reflect the developer's current workload.
              const tickets = (dev.tickets || []).filter(t => !CLOSED_STATUSES_SET.has(t.status));
              const fullyN = tickets.filter(t => FULLY_STS.has(t.status)).length;
              const partialN = tickets.filter(t => PARTIAL_STS.has(t.status)).length;
              const notUtilN = tickets.length - fullyN - partialN;
              // Group tickets by status
              const grouped = {};
              tickets.forEach(t => {
                const s = t.status || 'Other';
                if (!grouped[s]) grouped[s] = [];
                grouped[s].push(t);
              });
              return (() => {
                const flag = dev._flag;
                const flagColor = flag === 'Fully Allocated' ? 'var(--accent-green)' :
                                  flag === 'Partially Allocated' ? 'var(--accent-amber)' :
                                  flag === 'No Tickets' ? 'var(--text-muted)' : 'var(--accent-red)';
                // Per-status counts within each allocation bucket (for the expandable breakdown)
                const bucketStatuses = { fully: {}, partial: {}, notutil: {} };
                tickets.forEach(t => {
                  const b = devBucket(t.status);
                  bucketStatuses[b][t.status] = (bucketStatuses[b][t.status] || 0) + 1;
                });

                return (
                <React.Fragment key={dev.name}>
                {showGroupHeading && <PlatformGroupHeading platform={dev._platform} count={dev._platform === 'Mobile' ? mobileDevCount : webDevCount} />}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: `1px solid ${tickets.length === 0 ? 'var(--border-color)' : 'var(--border-color)'}`, marginBottom: '8px', overflow: 'hidden', opacity: tickets.length === 0 ? 0.6 : 1 }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '170px', cursor: 'pointer' }}
                      onClick={() => { if (tickets.length > 0) { setDevExpandedName(isExpanded ? null : dev.name); setDevStatusFilter(''); } }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: fullyN > 0 ? 'var(--accent-green)' : partialN > 0 ? 'var(--accent-amber)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{dev.name}</span>
                      {tickets.length > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>}
                    </div>

                    {/* Ticket count (as Developer — active workload) */}
                    <span style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{tickets.length} tickets</span>

                    {/* Assign-To count (tickets currently in this person's Assign To field, active) → drawer */}
                    {(() => {
                      const ap = assignByName[normName(dev.name)];
                      const an = ap ? (ap.tickets || []).length : 0;
                      return (
                        <span onClick={(e) => { e.stopPropagation(); if (an > 0) setAssignDrawer(ap); }}
                          title="Tickets currently in this person's Assign To field (active). Click for the full filterable/sortable list."
                          style={{ padding: '2px 9px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, cursor: an > 0 ? 'pointer' : 'default',
                            background: an > 0 ? 'rgba(20,184,166,0.14)' : 'rgba(100,116,139,0.10)',
                            color: an > 0 ? 'var(--accent-teal, #14b8a6)' : 'var(--text-muted)',
                            border: `1px solid ${an > 0 ? 'var(--accent-teal, #14b8a6)' : 'var(--border-color)'}` }}>
                          Assigned: {an}{an > 0 ? ' ↗' : ''}
                        </span>
                      );
                    })()}

                    {/* Allocation bucket badges (Fully / Partially / Not Utilised) */}
                    {[
                      { key: 'fully', n: fullyN, label: 'Fully', color: 'var(--accent-green)', bg: 'rgba(34,197,94,0.12)' },
                      { key: 'partial', n: partialN, label: 'Partially', color: 'var(--accent-amber)', bg: 'rgba(245,158,11,0.12)' },
                      { key: 'notutil', n: notUtilN, label: 'Not Utilised', color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.12)' },
                    ].filter(b => b.n > 0).map(b => {
                      const active = devExpandedName === dev.name && devStatusFilter === b.key;
                      return (
                        <span key={b.key} onClick={() => { setDevExpandedName(dev.name); setDevStatusFilter(active ? '' : b.key); }}
                          style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                            background: active ? b.color : b.bg, color: active ? '#fff' : b.color, border: `1px solid ${b.color}` }}
                          title={Object.entries(bucketStatuses[b.key]).map(([s,c])=>`${s}: ${c}`).join(', ')}>
                          {b.label}: {b.n}
                        </span>
                      );
                    })}
                    {dev.refix_count > 0 && (
                      <span onClick={() => { setDevExpandedName(dev.name); setDevStatusFilter(devStatusFilter === 'refix' && devExpandedName === dev.name ? '' : 'refix'); }}
                        style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                          background: devExpandedName === dev.name && devStatusFilter === 'refix' ? 'var(--accent-red)' : 'rgba(239,68,68,0.15)',
                          color: devExpandedName === dev.name && devStatusFilter === 'refix' ? '#fff' : 'var(--accent-red)',
                          border: '1px solid var(--accent-red)' }}>
                        {dev.refix_count} refix
                      </span>
                    )}

                    {/* Modules */}
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(dev.modules || []).slice(0, 3).map(m => <span key={m} className="rp-tag rp-tag-support" style={{ fontSize: '0.63rem' }}>{m}</span>)}
                    </div>

                    {/* Utilization flag — right end */}
                    <span style={{ marginLeft: 'auto', fontSize: '0.68rem', padding: '2px 8px', borderRadius: '3px', background: `${flagColor}12`, color: flagColor, fontWeight: 600, border: `1px solid ${flagColor}`, whiteSpace: 'nowrap' }}>
                      {flag}
                    </span>
                  </div>

                  {/* Per-status breakdown when an allocation bucket is clicked */}
                  {isExpanded && bucketStatuses[devStatusFilter] && (
                    <div style={{ padding: '4px 14px 8px', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {Object.entries(bucketStatuses[devStatusFilter]).map(([status, count]) => (
                        <span key={status} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', background: 'rgba(100,116,139,0.1)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {status}: {count}
                        </span>
                      ))}
                    </div>
                  )}

                  {isExpanded && (
                    <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-color)' }}>
                      {(() => {
                        // The allocation badges (Fully / Partially / Not Utilised / refix) pre-filter the set;
                        // the rich table below adds search + per-column filters + sort + bug counts.
                        let baseTickets = tickets;
                        if (devStatusFilter === 'fully' || devStatusFilter === 'partial' || devStatusFilter === 'notutil') baseTickets = tickets.filter(t => devBucket(t.status) === devStatusFilter);
                        else if (devStatusFilter === 'refix') baseTickets = tickets.filter(t => t.is_refix);
                        else if (devStatusFilter && statusToActual[devStatusFilter]) baseTickets = tickets.filter(t => (statusToActual[devStatusFilter] || []).includes(t.status));
                        return <RichTicketTable tickets={baseTickets} scrollMax="60vh" key={dev.name} />;
                      })()}
                    </div>
                  )}
                </div>
                </React.Fragment>
              );})();
            })}
          </div>);
        })()}

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
      {assignDrawer && <AssignDrawer person={assignDrawer} onClose={() => setAssignDrawer(null)} />}
    </div>
  );
}
