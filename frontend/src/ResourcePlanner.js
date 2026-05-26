import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

const STATUS_COLORS = {
  busy: 'var(--accent-red)',
  partially_available: 'var(--accent-amber)',
  available: 'var(--accent-green)',
};
const STATUS_LABELS = {
  busy: 'Busy',
  partially_available: 'Partial',
  available: 'Available',
};

export default function ResourcePlanner() {
  const [activeTab, setActiveTab] = useState('team_queue');
  const [loading, setLoading] = useState(true);
  const [teamQueue, setTeamQueue] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [ownership, setOwnership] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedMember, setExpandedMember] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [ownershipPlatform, setOwnershipPlatform] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const ticketListRef = React.useRef(null);

  const safeFetch = async (url) => {
    try { return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`); } catch { return null; }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tqRes, matRes, ownRes] = await Promise.all([
        safeFetch('/live/team-queue'),
        safeFetch('/live/module-ownership-matrix'),
        safeFetch('/live/module-ownership'),
      ]);
      if (tqRes?.ok) setTeamQueue(await tqRes.json());
      if (matRes?.ok) setMatrix(await matRes.json());
      if (ownRes?.ok) {
        const o = await ownRes.json();
        setOwnership(o);
        setEditData(JSON.parse(JSON.stringify(o)));
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const [refreshing, setRefreshing] = useState(false);
  const forceRefresh = async () => {
    setRefreshing(true);
    setExpandedMember(null); setExpandedModule(null); setSearchFilter('');
    try {
      await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  };

  const saveOwnership = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/live/module-ownership`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: editData.modules, team_members: editData.team_members }),
      });
      if (res.ok) { setEditMode(false); fetchAll(); }
    } finally { setSaving(false); }
  };

  const updateModuleOwner = (module, role, newOwners) => {
    setEditData(prev => ({
      ...prev,
      modules: { ...prev.modules, [module]: { ...prev.modules[module], [role]: newOwners } },
    }));
  };

  const toggleModuleTickets = async (module, group) => {
    if (expandedModule?.module === module && expandedModule?.group === group) {
      setExpandedModule(null);
      return;
    }
    setLoadingTickets(true);
    try {
      const platParam = ownershipPlatform !== 'all' ? `&platform=${ownershipPlatform}` : '';
      const res = await safeFetch(`/live/module-tickets/${encodeURIComponent(module)}?status_group=${group}${platParam}`);
      if (res?.ok) {
        const data = await res.json();
        setExpandedModule({ module, group, tickets: data.tickets, count: data.count });
        setTimeout(() => { ticketListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
      }
    } finally { setLoadingTickets(false); }
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading Resource Planner...</p></div>
        </main>
      </div>
    );
  }

  const allMembers = teamQueue?.members || [];
  const filteredMembers = allMembers.filter(m => {
    if (searchFilter && !m.name.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (teamFilter !== 'all' && m.team !== teamFilter) return false;
    return true;
  });
  const webMembers = filteredMembers.filter(m => m.team === 'Web');
  const mobileMembers = filteredMembers.filter(m => m.team === 'Mobile');
  const automationMembers = filteredMembers.filter(m => m.team === 'Automation');

  const busyCount = allMembers.filter(m => m.status === 'busy').length;
  const partialCount = allMembers.filter(m => m.status === 'partially_available').length;
  const availableCount = allMembers.filter(m => m.status === 'available').length;

  const matrixData = matrix?.matrix || [];
  const teamMembers = matrix?.team_members || ownership?.team_members || [];

  const ClickableCount = ({ value, module, group, color, bold }) => {
    if (!value) return <span>-</span>;
    const isActive = expandedModule?.module === module && expandedModule?.group === group;
    return (
      <span onClick={(e) => { e.stopPropagation(); toggleModuleTickets(module, group); }}
        style={{ cursor: 'pointer', fontWeight: bold ? 700 : 600, color: color || 'var(--text-primary)', textDecoration: isActive ? 'underline' : 'none' }}
        title={`Click to see ${value} tickets`}>{value}</span>
    );
  };

  // ===== TAB 1: TEAM QUEUE =====
  const renderTeamQueue = () => {
    const renderMemberCard = (m) => {
      const isExpanded = expandedMember === m.name;
      return (
        <div key={m.name} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '8px', overflow: 'hidden' }}>
          {/* Member header row */}
          <div
            onClick={() => setExpandedMember(isExpanded ? null : m.name)}
            style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', gap: '12px', flexWrap: 'wrap' }}
          >
            {/* Status dot + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[m.status], flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{m.name}</span>
            </div>

            {/* Current load badges */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              {m.in_progress > 0 && <span className="qcq-status-badge" style={{ background: 'var(--accent-red)', color: '#fff', fontSize: '0.7rem', padding: '2px 8px' }}>{m.in_progress} In Progress</span>}
              {m.assigned > 0 && <span className="qcq-status-badge" style={{ background: 'var(--accent-blue)', color: '#fff', fontSize: '0.7rem', padding: '2px 8px' }}>{m.assigned} Assigned</span>}
              {m.on_hold > 0 && <span className="qcq-status-badge" style={{ background: 'var(--accent-amber)', color: '#fff', fontSize: '0.7rem', padding: '2px 8px' }}>{m.on_hold} Hold</span>}
              {m.approved_for_live > 0 && <span className="qcq-status-badge" style={{ background: 'var(--accent-teal)', color: '#fff', fontSize: '0.7rem', padding: '2px 8px' }}>{m.approved_for_live} Approved</span>}
              {m.total_tickets === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>No active tickets</span>}
            </div>

            {/* Hours remaining */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '100px' }}>
              <div style={{ width: '60px', height: '5px', background: 'rgba(100,116,139,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (m.remaining_hours / 40) * 100)}%`, height: '100%', background: STATUS_COLORS[m.status], borderRadius: '3px' }} />
              </div>
              <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{m.remaining_hours}h</span>
            </div>

            {/* Module tags */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(m.primary_modules || []).map(mod => <span key={mod} className="rp-tag rp-tag-primary" style={{ fontSize: '0.68rem' }}>{mod}</span>)}
              {(m.support_modules || []).map(mod => <span key={mod} className="rp-tag rp-tag-support" style={{ fontSize: '0.68rem' }}>{mod}</span>)}
            </div>

            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
          </div>

          {/* Next suggested preview */}
          {(m.next_suggested || []).length > 0 && !isExpanded && (
            <div style={{ padding: '0 14px 8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Next:</span>
              {m.next_suggested.slice(0, 2).map(t => (
                <a key={t.ticket_id} href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: '0.72rem', padding: '2px 8px', background: t.is_refix ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', border: `1px solid ${t.is_refix ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: '4px', color: t.is_refix ? 'var(--accent-red)' : 'var(--accent-green)', textDecoration: 'none' }}
                  title={`${t.title} | ${t.module} | Score: ${t.score} | ${t.reasons.join(', ')}${t.is_refix ? ' | RETEST' : ''}`}>
                  #{t.ticket_id} {t.is_refix && <span style={{ fontWeight: 700 }}>R</span>} <span style={{ color: 'var(--text-muted)' }}>{t.module}</span>
                </a>
              ))}
              {(() => { const refixCount = (m.current_tickets || []).filter(t => t.is_refix).length;
                return refixCount > 0 ? <span style={{ fontSize: '0.72rem', color: 'var(--accent-red)', fontWeight: 600 }}>{refixCount} refix in queue</span> : null;
              })()}
            </div>
          )}

          {/* Expanded: full details */}
          {isExpanded && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-color)' }}>
              {/* Current tickets */}
              {m.current_tickets?.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Current Tickets ({m.total_tickets}) {(() => { const rc = (m.current_tickets||[]).filter(t=>t.is_refix).length; return rc > 0 ? <span style={{color:'var(--accent-red)'}}> — {rc} refix</span> : null; })()}</h4>
                  <table className="qcq-table" style={{ fontSize: '0.8rem' }}>
                    <thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Module</th><th>Est</th><th>Actual</th><th>Refix</th></tr></thead>
                    <tbody>
                      {m.current_tickets.map(t => (
                        <tr key={t.ticket_id} className="qcq-row">
                          <td><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                          <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</td>
                          <td><span className="qcq-status-badge">{t.status}</span></td>
                          <td>{t.priority}</td>
                          <td>{t.module || '-'}</td>
                          <td style={{ textAlign: 'center' }}>{t.qa_estimate_hours || '-'}</td>
                          <td style={{ textAlign: 'center' }}>{t.qa_actual_hours || '-'}</td>
                          <td style={{ textAlign: 'center' }}>{t.is_refix ? <span className="qcq-fail">Refix</span> : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Next suggested tickets */}
              {m.next_suggested?.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginBottom: '6px' }}>Suggested Next Tickets</h4>
                  <table className="qcq-table" style={{ fontSize: '0.8rem' }}>
                    <thead><tr><th>Ticket</th><th>Title</th><th>Module</th><th>Priority</th><th>Est Hrs</th><th>Type</th><th>Score</th><th>Why</th></tr></thead>
                    <tbody>
                      {m.next_suggested.map(t => (
                        <tr key={t.ticket_id} className="qcq-row">
                          <td><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                          <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</td>
                          <td>{t.module}</td>
                          <td>{t.priority}</td>
                          <td style={{ textAlign: 'center' }}>{t.qa_estimate_hours || '-'}</td>
                          <td style={{ textAlign: 'center' }}>{t.is_refix ? <span className="qcq-fail">Retest</span> : <span style={{color:'var(--accent-green)'}}>New</span>}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <div style={{ width: '40px', height: '5px', background: 'rgba(100,116,139,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${t.score}%`, height: '100%', background: t.score >= 40 ? 'var(--accent-green)' : t.score >= 20 ? 'var(--accent-amber)' : 'var(--accent-red)', borderRadius: '3px' }} />
                              </div>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{t.score}</span>
                            </div>
                          </td>
                          <td>
                            {t.reasons.map((r, i) => <span key={i} className="rp-tag rp-tag-primary" style={{ fontSize: '0.65rem', marginRight: '3px' }}>{r}</span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {m.next_suggested?.length === 0 && m.total_tickets === 0 && (
                <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No unassigned tickets in their modules</div>
              )}
            </div>
          )}
        </div>
      );
    };

    const renderTeamSection = (label, members, color) => {
      if (members.length === 0) return null;
      return (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', color }}>{label} ({members.length})</h3>
          {members.map(m => renderMemberCard(m))}
        </div>
      );
    };

    return (
      <div>
        {/* Summary cards */}
        <div className="qcq-status-cards">
          <div className="qcq-card qcq-card-total">
            <div className="qcq-card-value">{allMembers.length}</div>
            <div className="qcq-card-label">Team Members</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-red)' }}>
            <div className="qcq-card-value">{busyCount}</div>
            <div className="qcq-card-label">Busy</div>
            <div className="qcq-card-sub">Testing in progress</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-amber)' }}>
            <div className="qcq-card-value">{partialCount}</div>
            <div className="qcq-card-label">Assigned</div>
            <div className="qcq-card-sub">Has tickets, can take more</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
            <div className="qcq-card-value">{availableCount}</div>
            <div className="qcq-card-label">Available</div>
            <div className="qcq-card-sub">Ready for assignment</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
            <div className="qcq-card-value">{teamQueue?.unassigned_count || 0}</div>
            <div className="qcq-card-label">Unassigned</div>
            <div className="qcq-card-sub">QC tickets awaiting tester</div>
          </div>
        </div>

        {/* Unassigned by module */}
        {(teamQueue?.unassigned_by_module || []).length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Unassigned by module:</span>
            {(teamQueue.unassigned_by_module || []).map(m => (
              <span key={m.module} style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '4px', color: 'var(--accent-red)' }}>
                {m.module} <strong>{m.count}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <input type="text" placeholder="Search members..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="qcq-search-input" style={{ width: '200px' }} />
          <div className="qcq-platform-toggle">
            {['all', 'Web', 'Mobile', 'Automation'].map(t => (
              <button key={t} className={`btn btn-sm ${teamFilter === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTeamFilter(t)}>
                {t === 'all' ? 'All Teams' : t}
              </button>
            ))}
          </div>
        </div>

        {/* Team sections */}
        {teamFilter === 'all' ? (
          <>
            {renderTeamSection('Web QA Team', webMembers, 'var(--accent-blue)')}
            {renderTeamSection('Mobile QA Team', mobileMembers, 'var(--accent-purple, #8b5cf6)')}
            {renderTeamSection('Automation Team', automationMembers, 'var(--accent-teal)')}
          </>
        ) : (
          <div>{filteredMembers.map(m => renderMemberCard(m))}</div>
        )}
      </div>
    );
  };

  // ===== TAB 2: MODULE OWNERSHIP MATRIX =====
  const renderOwnership = () => {
    const data = editMode ? editData : ownership;
    return (
      <div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setEditMode(!editMode); if (!editMode) setEditData(JSON.parse(JSON.stringify(ownership))); }}>
            {editMode ? 'Cancel Edit' : 'Edit Ownership'}
          </button>
          {editMode && <button className="btn btn-sm btn-primary" onClick={saveOwnership} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>}
          <div className="qcq-platform-toggle" style={{ marginLeft: '12px' }}>
            <button className={`btn btn-sm ${ownershipPlatform === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOwnershipPlatform('all')}>All</button>
            <button className={`btn btn-sm ${ownershipPlatform === 'Web' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOwnershipPlatform('Web')}>Web</button>
            <button className={`btn btn-sm ${ownershipPlatform === 'Mobile' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOwnershipPlatform('Mobile')}>Mobile</button>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {matrix?.total_modules || 0} modules | {matrix?.owned_modules || 0} owned | <span style={{ color: 'var(--accent-red)' }}>{matrix?.unowned_modules || 0} unowned</span>
          </span>
        </div>

        <div className="qcq-table-container">
          <table className="qcq-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>QC Active</th><th>In Progress</th><th>QC Failed</th><th>BIS</th><th>Approved</th>
                <th style={{background:'rgba(245,158,11,0.3)'}}>Dev Pipeline</th>
                <th style={{background:'rgba(239,68,68,0.15)'}}>CR Passed</th>
                <th>Dev In Progress</th>
                <th style={{background:'rgba(239,68,68,0.15)'}}>Dev Refix</th>
                <th>Primary Owners</th><th>Support Owners</th>
                <th style={{background:'rgba(20,184,166,0.2)'}}>Test Cases</th>
                <th style={{background:'rgba(34,197,94,0.2)'}}>Automated</th>
                <th>Top Experts</th>
              </tr>
            </thead>
            <tbody>
              {matrixData.map(m => {
                const isExpanded = expandedModule?.module === m.module;
                const COL_SPAN = 15;
                return (
                <React.Fragment key={m.module}>
                <tr className={`qcq-row ${!m.has_owner ? 'rp-unowned-row' : ''} ${isExpanded ? 'qcq-row-expanded' : ''}`}>
                  <td style={{ fontWeight: 600 }}>{m.module}</td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.qc_active} module={m.module} group="qc_active" color={m.qc_active > 0 ? 'var(--accent-blue)' : undefined} bold /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.in_progress} module={m.module} group="in_progress" color={m.in_progress > 0 ? 'var(--accent-green)' : undefined} /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.qc_failed} module={m.module} group="qc_failed" color={m.qc_failed > 0 ? 'var(--accent-red)' : undefined} /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.bis} module={m.module} group="bis" /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.approved} module={m.module} group="approved" /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.dev_total} module={m.module} group="dev_pipeline" color={m.dev_total > 0 ? 'var(--accent-amber)' : undefined} bold /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.dev_near_qc} module={m.module} group="cr_passed" color={m.dev_near_qc > 0 ? 'var(--accent-red)' : undefined} bold /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.dev_in_progress} module={m.module} group="dev_in_progress" /></td>
                  <td style={{ textAlign: 'center' }}><ClickableCount value={m.dev_refix} module={m.module} group="dev_refix" color={m.dev_refix > 0 ? 'var(--accent-red)' : undefined} bold /></td>
                  <td>
                    {editMode ? (
                      <select multiple value={data?.modules?.[m.module]?.primary_owners || []}
                        onChange={e => updateModuleOwner(m.module, 'primary_owners', Array.from(e.target.selectedOptions, o => o.value))}
                        className="rp-multi-select">
                        {teamMembers.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (m.primary_owners || []).map(o => <span key={o} className="rp-tag rp-tag-primary">{o}</span>)}
                    {!editMode && m.primary_owners.length === 0 && <span style={{ color: 'var(--accent-red)', fontSize: '0.8rem' }}>Unowned</span>}
                  </td>
                  <td>
                    {editMode ? (
                      <select multiple value={data?.modules?.[m.module]?.support_owners || []}
                        onChange={e => updateModuleOwner(m.module, 'support_owners', Array.from(e.target.selectedOptions, o => o.value))}
                        className="rp-multi-select">
                        {teamMembers.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (m.support_owners || []).map(o => <span key={o} className="rp-tag rp-tag-support">{o}</span>)}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: m.test_cases > 0 ? 600 : 400, color: m.test_cases > 0 ? 'var(--accent-teal)' : 'var(--text-muted)' }}>{m.test_cases || '-'}</td>
                  <td style={{ textAlign: 'center' }}>{m.test_automated > 0 ? <span><span className="qcq-pass">{m.test_automated}</span> <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>({m.test_cases > 0 ? Math.round(m.test_automated/m.test_cases*100) : 0}%)</span></span> : '-'}</td>
                  <td>{(m.top_experts || []).slice(0, 3).map(e => <span key={e.name} className="rp-tag rp-tag-expert">{e.name} ({e.count})</span>)}</td>
                </tr>
                {isExpanded && (
                  <tr className="qcq-expand-row">
                    <td colSpan={COL_SPAN} style={{ padding: 0 }}>
                      <div ref={ticketListRef} style={{ padding: '12px', background: 'var(--bg-secondary)', borderTop: '2px solid var(--accent-teal)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{expandedModule.module} — {expandedModule.group.replace(/_/g, ' ')} ({expandedModule.count})</span>
                          <button className="btn btn-sm btn-secondary" onClick={() => setExpandedModule(null)} style={{ marginLeft: 'auto' }}>Close</button>
                        </div>
                        {loadingTickets ? <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div> : (
                          <table className="qcq-table" style={{ fontSize: '0.82rem' }}>
                            <thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Platform</th><th>QC Tester</th><th>Developer</th><th>Est Hrs</th><th>Actual Hrs</th><th>ETA</th></tr></thead>
                            <tbody>
                              {(expandedModule.tickets || []).length === 0 ? (
                                <tr><td colSpan="10" className="qcq-empty">No tickets</td></tr>
                              ) : (expandedModule.tickets || []).map(t => (
                                <tr key={t.ticket_id} className="qcq-row">
                                  <td><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a></td>
                                  <td className="qcq-title">{t.title}</td>
                                  <td><span className="qcq-status-badge">{t.status}</span></td>
                                  <td>{t.priority}</td>
                                  <td>{t.platform}</td>
                                  <td>{t.qc_tester || '-'}</td>
                                  <td>{t.developers_str || '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.qa_estimate_hours || '-'}</td>
                                  <td style={{textAlign:'center'}}>{t.qa_actual_hours || '-'}</td>
                                  <td>{t.eta ? new Date(t.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Resource Planner</h1>
            <p className="header-subtitle">Team workload, module ownership & next ticket suggestions</p>
          </div>
          <div className="header-right">
            <button onClick={forceRefresh} className="btn btn-secondary btn-sm" disabled={refreshing}>{refreshing ? 'Syncing...' : 'Sync & Refresh'}</button>
          </div>
        </header>

        <div className="qcq-tabs">
          <button className={`qcq-tab ${activeTab === 'team_queue' ? 'active' : ''}`} onClick={() => setActiveTab('team_queue')}>
            Team Queue ({allMembers.length})
          </button>
          <button className={`qcq-tab ${activeTab === 'ownership' ? 'active' : ''}`} onClick={() => setActiveTab('ownership')}>
            Module Ownership ({matrix?.total_modules || 0})
          </button>
        </div>

        {activeTab === 'team_queue' && renderTeamQueue()}
        {activeTab === 'ownership' && renderOwnership()}
      </main>
    </div>
  );
}
