import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const ACTIVITY_CONFIG = {
  active: { label: 'Active', color: '#22c55e', icon: '●' },
  assigned: { label: 'Assigned', color: '#3b82f6', icon: '●' },
  on_hold: { label: 'On Hold', color: '#f59e0b', icon: '●' },
  idle: { label: 'Idle', color: '#94a3b8', icon: '○' },
};

function ActivityDot({ activity }) {
  const cfg = ACTIVITY_CONFIG[activity] || ACTIVITY_CONFIG.idle;
  return (
    <span className="tb-activity-dot" style={{ color: cfg.color }} title={cfg.label}>
      {cfg.icon}
    </span>
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

export default function TeamBoard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [board, setBoard] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [expandedMember, setExpandedMember] = useState(null);
  const [memberDetail, setMemberDetail] = useState({});
  const [viewMode, setViewMode] = useState('cards'); // 'cards' or 'table'
  const [filterActivity, setFilterActivity] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  const safeFetch = async (url) => {
    try { return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`); } catch { return null; }
  };

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardRes, distRes] = await Promise.all([
        safeFetch('/live/team-board'),
        safeFetch('/live/team-board/activity-distribution'),
      ]);
      if (boardRes?.ok) setBoard(await boardRes.json());
      else throw new Error('Failed to load team board');
      if (distRes?.ok) setDistribution(await distRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const forceRefresh = async () => {
    await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
    fetchBoard();
  };

  const loadMemberDetail = (employeeId) => {
    // Live data already includes all_tickets in board members - use directly
    if (memberDetail[employeeId]) return;
    const member = (board?.members || []).find(m => m.employee_id === employeeId);
    if (member) {
      setMemberDetail(prev => ({
        ...prev,
        [employeeId]: {
          ...member,
          tickets: (member.all_tickets || []).map(t => ({
            ...t,
            priority_score: 0,
            status_durations: {},
            total_hold_days: 0,
          })),
        },
      }));
    }
  };

  const toggleMember = (employeeId) => {
    if (expandedMember === employeeId) {
      setExpandedMember(null);
    } else {
      setExpandedMember(employeeId);
      loadMemberDetail(employeeId);
    }
  };

  const getFilteredMembers = () => {
    let members = board?.members || [];
    if (platformFilter !== 'all') {
      members = members.filter(m => (m.platform || 'Web') === platformFilter);
    }
    if (filterActivity !== 'all') {
      members = members.filter(m => m.activity === filterActivity);
    }
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      members = members.filter(m =>
        (m.name || '').toLowerCase().includes(s) ||
        (m.designation || '').toLowerCase().includes(s) ||
        (m.platform || '').toLowerCase().includes(s) ||
        (m.primary_ticket?.title || '').toLowerCase().includes(s)
      );
    }
    return members;
  };

  const allMembers = board?.members || [];
  const webMemberCount = allMembers.filter(m => (m.platform || 'Web') === 'Web').length;
  const mobileMemberCount = allMembers.filter(m => (m.platform || 'Web') === 'Mobile').length;

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading Team Board...</p></div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="error-container"><p>{error}</p><button onClick={fetchBoard} className="btn btn-primary">Retry</button></div>
        </main>
      </div>
    );
  }

  const summary = board?.summary || {};
  const members = getFilteredMembers();
  const actDist = distribution?.activity_distribution || {};
  const platDist = distribution?.platform_distribution || {};

  // Activity distribution chart
  const actChartData = {
    labels: Object.keys(actDist).map(k => (ACTIVITY_CONFIG[k]?.label || k)),
    datasets: [{
      data: Object.values(actDist),
      backgroundColor: Object.keys(actDist).map(k => ACTIVITY_CONFIG[k]?.color || '#94a3b8'),
      borderWidth: 0,
    }],
  };

  // Platform distribution chart
  const platChartData = {
    labels: Object.keys(platDist),
    datasets: [{
      data: Object.values(platDist),
      backgroundColor: ['#3b82f6', '#a78bfa', '#f59e0b', '#22c55e'],
      borderWidth: 0,
    }],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', font: { size: 11 }, padding: 10 } },
    },
    cutout: '65%',
  };

  const renderMemberCard = (member) => {
    const cfg = ACTIVITY_CONFIG[member.activity] || ACTIVITY_CONFIG.idle;
    const pt = member.primary_ticket;
    return (
      <div
        key={member.employee_id}
        className={`tb-member-card tb-activity-${member.activity}`}
        onClick={() => toggleMember(member.employee_id)}
      >
        <div className="tb-card-header">
          <div className="tb-card-name-row">
            <ActivityDot activity={member.activity} />
            <span className="tb-card-name">{member.name}</span>
            <span className="tb-card-platform">{member.platform}</span>
          </div>
          <span className="tb-card-designation">{member.designation}</span>
        </div>

        <div className="tb-card-status" style={{ borderLeftColor: cfg.color }}>
          <span className="tb-card-activity-label" style={{ color: cfg.color }}>{cfg.label}</span>
          <span className="tb-card-ticket-count">{member.ticket_count} ticket{member.ticket_count !== 1 ? 's' : ''}</span>
        </div>

        {pt && (
          <div className="tb-card-primary">
            <div className="tb-card-primary-header">
              <a href={`${PM_TICKET_URL}${pt.ticket_id}`} target="_blank" rel="noopener noreferrer" className="tb-card-tid" onClick={e => e.stopPropagation()}>#{pt.ticket_id}</a>
              <span className={`qcq-status qcq-status-${(pt.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{pt.status}</span>
              <AgeingBadge days={pt.days_in_qc} />
            </div>
            <div className="tb-card-primary-title">{pt.title}</div>
            <div className="tb-card-primary-meta">
              <span>{pt.priority}</span>
              {pt.module && <span>{pt.module}</span>}
              {pt.eta && <span>ETA: {new Date(pt.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            </div>
          </div>
        )}

        {member.activity === 'idle' && (
          <div className="tb-card-idle-msg">No active QC tickets assigned</div>
        )}

        {member.total_qa_estimate_hours > 0 && (
          <div className="tb-card-hours">
            <span>Est: {member.total_qa_estimate_hours}h</span>
            <span>Actual: {member.total_qa_actual_hours || 0}h</span>
          </div>
        )}

        {expandedMember === member.employee_id && (
          <div className="tb-card-expanded" onClick={e => e.stopPropagation()}>
            {memberDetail[member.employee_id] ? (
              <div className="tb-detail-tickets">
                <h4>All Assigned Tickets ({memberDetail[member.employee_id].ticket_count})</h4>
                {(memberDetail[member.employee_id].tickets || []).map(t => (
                  <div key={t.ticket_id} className="tb-detail-ticket">
                    <div className="tb-detail-ticket-header">
                      <a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer" className="tb-detail-tid" onClick={e => e.stopPropagation()}>#{t.ticket_id}</a>
                      <span className={`qcq-status qcq-status-${(t.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{t.status}</span>
                      <span className="tb-detail-priority">{t.priority}</span>
                      <AgeingBadge days={t.days_in_qc} />
                      <span className="tb-detail-score">Score: {t.priority_score}</span>
                    </div>
                    <div className="tb-detail-ticket-title">{t.title}</div>
                    {t.status_durations && Object.keys(t.status_durations).length > 0 && (
                      <div className="tb-detail-durations">
                        {Object.entries(t.status_durations).map(([s, d]) => (
                          <span key={s} className="tb-dur-tag">{s}: {d}d</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button
                  className="btn btn-secondary btn-sm tb-view-profile"
                  onClick={() => navigate(`/employees/${member.employee_id}`)}
                >
                  View Profile
                </button>
              </div>
            ) : (
              <div className="tb-loading">Loading details...</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTableView = () => (
    <div className="qcq-table-container">
      <table className="qcq-table tb-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Designation</th>
            <th>Platform</th>
            <th>Tickets</th>
            <th>Primary Ticket</th>
            <th>Priority</th>
            <th>Age</th>
            <th>Est Hours</th>
            <th>Actual Hours</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => {
            const pt = m.primary_ticket;
            return (
              <tr
                key={m.employee_id}
                className={`tb-table-row tb-table-${m.activity}`}
                onClick={() => toggleMember(m.employee_id)}
              >
                <td>
                  <span className="tb-table-activity" style={{ color: (ACTIVITY_CONFIG[m.activity] || {}).color }}>
                    {(ACTIVITY_CONFIG[m.activity] || {}).label}
                  </span>
                </td>
                <td className="tb-table-name">{m.name}</td>
                <td>{m.designation}</td>
                <td>{m.platform}</td>
                <td className="tb-table-count">{m.ticket_count}</td>
                <td>
                  {pt ? (
                    <span className="tb-table-ticket">
                      #{pt.ticket_id} - {pt.title?.substring(0, 40)}{(pt.title || '').length > 40 ? '...' : ''}
                    </span>
                  ) : '-'}
                </td>
                <td>{pt?.priority || '-'}</td>
                <td>{pt ? <AgeingBadge days={pt.days_in_qc} /> : '-'}</td>
                <td>{m.total_qa_estimate_hours || '-'}</td>
                <td>{m.total_qa_actual_hours || '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Team Board</h1>
            <p className="header-subtitle">QA team activity overview - synced from PM Tool</p>
          </div>
          <div className="header-right" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div className="qcq-platform-toggle">
              <button className={`btn btn-sm ${platformFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('all')}>All ({allMembers.length})</button>
              <button className={`btn btn-sm ${platformFilter === 'Web' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Web')}>Web ({webMemberCount})</button>
              <button className={`btn btn-sm ${platformFilter === 'Mobile' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatformFilter('Mobile')}>Mobile ({mobileMemberCount})</button>
            </div>
            <button onClick={forceRefresh} className="btn btn-secondary btn-sm" title="Force refresh from PM API">Sync & Refresh</button>
          </div>
        </header>

        {/* Summary Cards */}
        <div className="qcq-status-cards">
          <div className="qcq-card qcq-card-total">
            <div className="qcq-card-value">{summary.total_members || 0}</div>
            <div className="qcq-card-label">Team Members</div>
          </div>
          <div className="qcq-card qcq-card-progress">
            <div className="qcq-card-value">{summary.busy || 0}</div>
            <div className="qcq-card-label">Active / Assigned</div>
          </div>
          <div className="qcq-card qcq-card-hold">
            <div className="qcq-card-value">{summary.on_hold || 0}</div>
            <div className="qcq-card-label">On Hold</div>
          </div>
          <div className="qcq-card qcq-card-testing">
            <div className="qcq-card-value">{summary.idle || 0}</div>
            <div className="qcq-card-label">Idle</div>
            <div className="qcq-card-sub">Available for assignment</div>
          </div>
          <div className="qcq-card qcq-card-ageing">
            <div className="qcq-card-value">{summary.total_qc_tickets || 0}</div>
            <div className="qcq-card-label">QC Tickets</div>
          </div>
          <div className="qcq-card qcq-card-fpr">
            <div className="qcq-card-value">{summary.avg_ageing || 0}d</div>
            <div className="qcq-card-label">Avg Ageing</div>
          </div>
        </div>

        {/* Distribution Charts */}
        <div className="qcq-charts-row" style={{ marginBottom: '20px' }}>
          <div className="qcq-chart-panel">
            <h3>Activity Distribution</h3>
            <div className="qcq-chart-wrapper" style={{ height: '220px' }}>
              <Doughnut data={actChartData} options={doughnutOptions} />
            </div>
          </div>
          {Object.keys(platDist).length > 0 && (
            <div className="qcq-chart-panel">
              <h3>Platform Distribution</h3>
              <div className="qcq-chart-wrapper" style={{ height: '220px' }}>
                <Doughnut data={platChartData} options={doughnutOptions} />
              </div>
            </div>
          )}
        </div>

        {/* Filter & View Toggle */}
        <div className="qcq-tabs">
          <button className={`qcq-tab ${filterActivity === 'all' ? 'active' : ''}`} onClick={() => setFilterActivity('all')}>
            All ({board?.members?.length || 0})
          </button>
          {Object.entries(ACTIVITY_CONFIG).map(([key, cfg]) => {
            const count = (board?.members || []).filter(m => m.activity === key).length;
            if (count === 0) return null;
            return (
              <button key={key} className={`qcq-tab ${filterActivity === key ? 'active' : ''}`} onClick={() => setFilterActivity(key)}>
                {cfg.label} ({count})
              </button>
            );
          })}
          <div className="qcq-search" style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Search members..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="qcq-search-input"
            />
            <button
              className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('cards')}
              title="Card view"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('table')}
              title="Table view"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Members */}
        {viewMode === 'cards' ? (
          <div className="tb-members-grid">
            {members.length === 0 ? (
              <div className="qcq-empty" style={{ padding: '40px', textAlign: 'center' }}>No members match the filter</div>
            ) : (
              members.map(m => renderMemberCard(m))
            )}
          </div>
        ) : (
          renderTableView()
        )}
      </main>
    </div>
  );
}
