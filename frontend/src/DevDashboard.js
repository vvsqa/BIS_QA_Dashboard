import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

const STAGE_COLORS = {
  early: 'var(--text-muted)', ready: 'var(--accent-blue)', active: 'var(--accent-green)',
  code_review: 'var(--accent-purple)', ready_for_qc: 'var(--accent-red)', dev_testing: 'var(--accent-amber)',
};
const STAGE_LABELS = {
  early: 'Early Stage', ready: 'Ready for Dev', active: 'Active Dev',
  code_review: 'Code Review', ready_for_qc: 'Ready for QC', dev_testing: 'Dev Testing',
};

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  return <span className={`qcq-status qcq-status-${s}`}>{status}</span>;
}

function HoursCell({ est, actual }) {
  if (!est && !actual) return <span>-</span>;
  const overrun = est > 0 && actual > est;
  return <span style={overrun ? { color: 'var(--accent-red)', fontWeight: 700 } : {}}>
    {actual || 0}/{est || 0}h {overrun && <span title={`Overrun: +${(actual - est).toFixed(1)}h`}>!</span>}
  </span>;
}

export default function DevDashboard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('resources');
  const [expandedDev, setExpandedDev] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);
  const [cardFilter, setCardFilter] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [developerFilter, setDeveloperFilter] = useState('');
  const [sortField, setSortField] = useState('ticket_count');
  const [sortDir, setSortDir] = useState('desc');
  const cardListRef = useRef(null);

  const safeFetch = async (url) => {
    try { return await fetch(url.startsWith('http') ? url : `${API_BASE}${url}`); } catch { return null; }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetch('/live/dev-dashboard');
      if (res?.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const forceRefresh = async () => {
    await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
    fetchData();
  };

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortTh = ({ field, children }) => (
    <th className="qcq-sortable-th" onClick={() => handleSort(field)}>
      {children}{sortField === field && <span className="qcq-sort-arrow">{sortDir === 'desc' ? ' \u25BC' : ' \u25B2'}</span>}
    </th>
  );

  const handleCardClick = (filter) => {
    setCardFilter(cardFilter === filter ? null : filter);
    setActiveTab('tickets');
    setTimeout(() => cardListRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  if (loading) {
    return (<div className="dashboard"><AppSidebar /><main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
      <div className="loading-container"><div className="loading-spinner"></div><p>Loading Dev Dashboard...</p></div></main></div>);
  }

  const summary = data?.summary || {};
  const stages = summary.by_stage || {};
  const allTickets = data?.tickets || [];
  const developers = data?.developers || [];
  const modules = data?.modules || [];

  // Platform filter
  const pf = (list) => platformFilter === 'all' ? list : list.filter(t => (t.platform || 'Web') === platformFilter);

  // Card filter + stage filter + search
  const filteredTickets = pf(allTickets).filter(t => {
    if (cardFilter) {
      if (cardFilter === 'refix' && !t.is_refix) return false;
      else if (cardFilter === 'dev_overrun' && !t.is_dev_overrun) return false;
      else if (cardFilter === 'dev' && t.category !== 'dev') return false;
      else if (cardFilter === 'qa' && t.category !== 'qa') return false;
      else if (cardFilter?.startsWith('first_time_')) {
        const status = cardFilter.replace('first_time_', '');
        if (t.status !== status || t.is_refix) return false;
      }
      else if (!['refix','dev_overrun','dev','qa'].includes(cardFilter) && !cardFilter?.startsWith('first_time_') && t.status !== cardFilter) return false;
    }
    if (stageFilter && t.status !== stageFilter) return false;
    if (assigneeFilter && t.current_assignee !== assigneeFilter) return false;
    if (moduleFilter && t.module !== moduleFilter) return false;
    if (developerFilter && !(t.developers_str || '').includes(developerFilter)) return false;
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      return String(t.ticket_id).includes(s) || (t.title || '').toLowerCase().includes(s) ||
        (t.developers_str || '').toLowerCase().includes(s) || (t.module || '').toLowerCase().includes(s) ||
        (t.qc_tester || '').toLowerCase().includes(s) ||
        (t.current_assignee || '').toLowerCase().includes(s);
    }
    return true;
  });

  const doSort = (list) => [...list].sort((a, b) => {
    let av = a[sortField] ?? ''; let bv = b[sortField] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const CardBtn = ({ value, label, sub, filter, color }) => {
    const v = value || 0;
    return (
    <div className={`qcq-card qcq-card-clickable ${cardFilter === filter ? 'qcq-card-active' : ''}`}
      style={{ borderTop: `3px solid ${color || 'var(--border-color)'}`, cursor: 'pointer' }}
      onClick={() => handleCardClick(filter)}>
      <div className="qcq-card-value" style={v > 0 ? { color } : {}}>{v}</div>
      <div className="qcq-card-label">{label}</div>
      {sub && <div className="qcq-card-sub">{sub}</div>}
    </div>
    );
  };

  // Ticket table row (reusable)
  const TicketRow = ({ t }) => (
    <tr className={`qcq-row ${t.is_dev_overrun ? 'rp-overrun-row' : ''}`}>
      <td className="qcq-ticket-id"><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a></td>
      <td className="qcq-title">{t.title}</td>
      <td><span className={`qcq-status qcq-status-${(t.status||'').toLowerCase().replace(/\s+/g,'-')}`}>{t.status}</span></td>
      <td className="qcq-priority">{t.priority}</td>
      <td><span className={`qcq-platform-badge qcq-platform-${(t.platform||'Web').toLowerCase()}`}>{t.platform}</span></td>
      <td>{t.module || '-'}</td>
      <td className="qcq-secondary">{t.developers_str || '-'}</td>
      <td>{t.current_assignee || '-'}</td>
      <td>{t.qc_tester || '-'}</td>
      <td><HoursCell est={t.dev_estimate_hours} actual={t.actual_dev_hours} /></td>
      <td style={{textAlign:'center'}}>{t.cycle_count > 0 ? <span className="qcq-fail">{t.cycle_count}</span> : '-'}</td>
      <td style={{textAlign:'center'}}>{t.bugs_total > 0 ? t.bugs_total : '-'}</td>
      <td style={{textAlign:'center'}}>{t.bugs_open > 0 ? <span className="qcq-fail">{t.bugs_open}</span> : '-'}</td>
      <td style={{textAlign:'center'}}>{t.bugs_released_to_qa > 0 ? <span className="qcq-pass">{t.bugs_released_to_qa}</span> : '-'}</td>
      <td style={{textAlign:'center'}}>{t.bugs_closed > 0 ? <span className="qcq-pass">{t.bugs_closed}</span> : '-'}</td>
      <td style={{textAlign:'center'}}>{t.ageing_days > 0 ? `${t.ageing_days}d` : '-'}</td>
      <td className="qcq-eta">{t.eta ? new Date(t.eta).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '-'}</td>
    </tr>
  );

  // Tab 1: Resources
  const renderResources = () => (
    <div>
      <div className="qcq-search" style={{marginBottom:'12px'}}>
        <input type="text" placeholder="Search developers..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="qcq-search-input" />
      </div>
      <div className="qcq-table-container">
        <table className="qcq-table">
          <thead><tr>
            <SortTh field="name">Developer</SortTh><SortTh field="ticket_count">Total</SortTh>
            <SortTh field="in_progress">In Progress</SortTh><SortTh field="code_review">Code Review</SortTh>
            <SortTh field="ready_for_qc">CR Passed</SortTh><SortTh field="ready_for_dev">Ready for Dev</SortTh>
            <SortTh field="qc_testing">QC Testing</SortTh><SortTh field="qc_failed">QC Failed</SortTh>
            <SortTh field="bis">BIS</SortTh><SortTh field="moved_to_live">Moved to Live</SortTh>
            <SortTh field="refix_count">Refix</SortTh>
            <SortTh field="total_dev_est">Est Hrs</SortTh><SortTh field="total_dev_actual">Actual Hrs</SortTh>
            <th>Modules</th>
          </tr></thead>
          <tbody>
            {doSort(developers.filter(d => !searchFilter || d.name.toLowerCase().includes(searchFilter.toLowerCase()))).map(d => (
              <React.Fragment key={d.name}>
                <tr className={`qcq-row ${expandedDev === d.name ? 'qcq-row-expanded' : ''}`} onClick={() => setExpandedDev(expandedDev === d.name ? null : d.name)}>
                  <td style={{fontWeight:600}}>{d.name}</td>
                  <td style={{textAlign:'center',fontWeight:700}}>{d.ticket_count}</td>
                  <td style={{textAlign:'center',color:d.in_progress>0?'var(--accent-green)':undefined}}>{d.in_progress||'-'}</td>
                  <td style={{textAlign:'center',color:d.code_review>0?'var(--accent-purple)':undefined}}>{d.code_review||'-'}</td>
                  <td style={{textAlign:'center',color:d.ready_for_qc>0?'var(--accent-red)':undefined,fontWeight:d.ready_for_qc>0?700:400}}>{d.ready_for_qc||'-'}</td>
                  <td style={{textAlign:'center'}}>{d.ready_for_dev||'-'}</td>
                  <td style={{textAlign:'center',color:d.qc_testing>0?'var(--accent-blue)':undefined}}>{d.qc_testing||'-'}</td>
                  <td style={{textAlign:'center',color:d.qc_failed>0?'var(--accent-red)':undefined,fontWeight:700}}>{d.qc_failed||'-'}</td>
                  <td style={{textAlign:'center',color:d.bis>0?'var(--accent-purple)':undefined}}>{d.bis||'-'}</td>
                  <td style={{textAlign:'center',color:d.moved_to_live>0?'var(--accent-green)':undefined}}>{d.moved_to_live||'-'}</td>
                  <td style={{textAlign:'center',color:d.refix_count>0?'var(--accent-red)':undefined,fontWeight:d.refix_count>0?700:400}}>{d.refix_count||'-'}</td>
                  <td className="qcq-hours"><HoursCell est={d.total_dev_est} actual={d.total_dev_actual} /></td>
                  <td className="qcq-hours">{d.total_dev_actual||'-'}</td>
                  <td>{(d.modules||[]).slice(0,3).map(m=><span key={m} className="rp-tag rp-tag-expert">{m}</span>)}{d.modules.length>3&&<span className="rp-tag rp-tag-expert">+{d.modules.length-3}</span>}</td>
                </tr>
                {expandedDev === d.name && (
                  <tr className="qcq-expand-row"><td colSpan="15" style={{padding:0}}>
                    <div style={{padding:'12px',background:'var(--bg-secondary)',borderTop:'2px solid var(--accent-teal)'}}>
                      <table className="qcq-table" style={{fontSize:'0.82rem'}}>
                        <thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Module</th><th>Assign To</th><th>Dev Hrs</th><th>Bugs</th><th>Open</th><th>Rel. to QA</th><th>Closed</th><th>ETA</th></tr></thead>
                        <tbody>{(d.tickets||[]).map(t=>{
                          const bug = allTickets.find(x=>x.ticket_id===t.ticket_id)||{};
                          return (
                          <tr key={t.ticket_id} className={`qcq-row ${t.is_refix?'rp-overrun-row':''}`}>
                            <td className="qcq-ticket-id"><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a></td>
                            <td className="qcq-title">{t.title}</td>
                            <td><span className={`qcq-status qcq-status-${(t.status||'').toLowerCase().replace(/\s+/g,'-')}`}>{t.status}</span></td>
                            <td className="qcq-priority">{t.priority}</td><td>{t.module||'-'}</td>
                            <td>{bug.current_assignee||t.current_assignee||'-'}</td>
                            <td><HoursCell est={t.dev_estimate_hours} actual={t.actual_dev_hours} /></td>
                            <td style={{textAlign:'center'}}>{bug.bugs_total>0?bug.bugs_total:'-'}</td>
                            <td style={{textAlign:'center'}}>{bug.bugs_open>0?<span className="qcq-fail">{bug.bugs_open}</span>:'-'}</td>
                            <td style={{textAlign:'center'}}>{bug.bugs_released_to_qa>0?<span className="qcq-pass">{bug.bugs_released_to_qa}</span>:'-'}</td>
                            <td style={{textAlign:'center'}}>{bug.bugs_closed>0?<span className="qcq-pass">{bug.bugs_closed}</span>:'-'}</td>
                            <td className="qcq-eta">{t.eta?new Date(t.eta).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'-'}</td>
                          </tr>);})}</tbody>
                      </table>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Tab 2: Tickets
  const renderTickets = () => (
    <div ref={cardListRef}>
      <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap',alignItems:'center'}}>
        <input type="text" placeholder="Search tickets, devs, modules..." value={searchFilter} onChange={e=>setSearchFilter(e.target.value)} className="qcq-search-input" style={{width:'220px'}} />
        <select className="qcq-search-input" style={{width:'170px'}} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {[...new Set(allTickets.map(t=>t.status))].sort().map(s=><option key={s} value={s}>{s} ({allTickets.filter(t=>t.status===s).length})</option>)}
        </select>
        <select className="qcq-search-input" style={{width:'150px'}} value={moduleFilter} onChange={e=>setModuleFilter(e.target.value)}>
          <option value="">All Modules</option>
          {[...new Set(allTickets.map(t=>t.module).filter(Boolean))].sort().map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <select className="qcq-search-input" style={{width:'160px'}} value={developerFilter} onChange={e=>setDeveloperFilter(e.target.value)}>
          <option value="">All Developers</option>
          {[...new Set(allTickets.flatMap(t=>[t.backend_developer,t.frontend_developer]).filter(Boolean).filter(v=>v!=='-'&&v!==''))].sort().map(d=><option key={d} value={d}>{d}</option>)}
        </select>
        <select className="qcq-search-input" style={{width:'160px'}} value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)}>
          <option value="">All Assign To</option>
          {[...new Set(allTickets.map(t=>t.current_assignee).filter(Boolean).filter(v=>v!=='-'&&v!==''))].sort().map(t=><option key={t} value={t}>{t}</option>)}
        </select>
        {(cardFilter || stageFilter || searchFilter || assigneeFilter || moduleFilter || developerFilter) && (
          <button className="btn btn-sm btn-secondary" onClick={() => {
            setCardFilter(null); setStageFilter(''); setSearchFilter(''); setAssigneeFilter(''); setModuleFilter(''); setDeveloperFilter('');
          }}>Clear All Filters</button>
        )}
        <span style={{marginLeft:'auto',fontSize:'0.8rem',color:'var(--text-muted)'}}>{filteredTickets.length} tickets</span>
      </div>
      <div className="qcq-table-container">
        <table className="qcq-table">
          <thead><tr>
            <SortTh field="ticket_id">Ticket</SortTh><th>Title</th><SortTh field="status">Status</SortTh>
            <SortTh field="priority_order">Priority</SortTh><th>Platform</th><SortTh field="module">Module</SortTh>
            <th>Developer</th><th>Assign To</th><th>QC Tester</th><th>Dev Hrs (Act/Est)</th>
            <th>Cycles</th><th>Bugs</th><th>Open</th><th>Released to QA</th><th>Closed</th>
            <th>Age</th><SortTh field="eta">ETA</SortTh>
          </tr></thead>
          <tbody>
            {filteredTickets.length === 0 ? <tr><td colSpan="16" className="qcq-empty">No tickets match filter</td></tr> :
              doSort(filteredTickets).map(t => <TicketRow key={t.ticket_id} t={t} />)}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Tab 3: Modules
  const renderModules = () => (
    <div>
      <div className="qcq-table-container">
        <table className="qcq-table">
          <thead><tr>
            <th>Module</th><th>Total</th><th>In Progress</th><th>Code Review</th>
            <th style={{background:'rgba(239,68,68,0.15)'}}>CR Passed</th><th>Ready for Dev</th>
            <th>QC Testing</th><th style={{background:'rgba(239,68,68,0.15)'}}>QC Failed</th>
            <th>BIS</th><th>Approved</th><th>Moved to Live</th>
            <th style={{background:'rgba(239,68,68,0.15)'}}>Refix</th><th>Developers</th>
          </tr></thead>
          <tbody>{modules.map(m=>(
            <React.Fragment key={m.module}>
              <tr className={`qcq-row ${expandedModule===m.module?'qcq-row-expanded':''}`} onClick={()=>setExpandedModule(expandedModule===m.module?null:m.module)}>
                <td style={{fontWeight:600}}>{m.module}</td>
                <td style={{textAlign:'center',fontWeight:700}}>{m.total}</td>
                <td style={{textAlign:'center',color:m.in_progress>0?'var(--accent-green)':undefined}}>{m.in_progress||'-'}</td>
                <td style={{textAlign:'center',color:m.code_review>0?'var(--accent-purple)':undefined}}>{m.code_review||'-'}</td>
                <td style={{textAlign:'center',color:m.ready_for_qc>0?'var(--accent-red)':undefined,fontWeight:700}}>{m.ready_for_qc||'-'}</td>
                <td style={{textAlign:'center'}}>{m.ready_for_dev||'-'}</td>
                <td style={{textAlign:'center',color:m.qc_testing>0?'var(--accent-blue)':undefined}}>{m.qc_testing||'-'}</td>
                <td style={{textAlign:'center',color:m.qc_failed>0?'var(--accent-red)':undefined,fontWeight:700}}>{m.qc_failed||'-'}</td>
                <td style={{textAlign:'center',color:m.bis>0?'var(--accent-purple)':undefined}}>{m.bis||'-'}</td>
                <td style={{textAlign:'center',color:m.approved>0?'var(--accent-teal)':undefined}}>{m.approved||'-'}</td>
                <td style={{textAlign:'center',color:m.moved_to_live>0?'var(--accent-green)':undefined}}>{m.moved_to_live||'-'}</td>
                <td style={{textAlign:'center',color:m.refix>0?'var(--accent-red)':undefined,fontWeight:700}}>{m.refix||'-'}</td>
                <td>{(m.developers||[]).slice(0,4).map(d=><span key={d} className="rp-tag rp-tag-expert">{d}</span>)}{m.developers.length>4&&<span className="rp-tag rp-tag-expert">+{m.developers.length-4}</span>}</td>
              </tr>
              {expandedModule===m.module&&(
                <tr className="qcq-expand-row"><td colSpan="13" style={{padding:0}}>
                  <div style={{padding:'12px',background:'var(--bg-secondary)',borderTop:'2px solid var(--accent-teal)'}}>
                    <table className="qcq-table" style={{fontSize:'0.82rem'}}>
                      <thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Developer</th><th>Assign To</th><th>Dev Hrs</th><th>Bugs</th><th>Open</th><th>Rel. to QA</th><th>Closed</th><th>ETA</th></tr></thead>
                      <tbody>{allTickets.filter(t=>t.module===m.module&&t.category==='dev').map(t=>(
                        <tr key={t.ticket_id} className={`qcq-row ${t.is_refix?'rp-overrun-row':''}`}>
                          <td className="qcq-ticket-id"><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noopener noreferrer">#{t.ticket_id}</a></td>
                          <td className="qcq-title">{t.title}</td>
                          <td><span className={`qcq-status qcq-status-${(t.status||'').toLowerCase().replace(/\s+/g,'-')}`}>{t.status}</span></td>
                          <td className="qcq-priority">{t.priority}</td>
                          <td className="qcq-secondary">{t.developers_str||'-'}</td>
                          <td>{t.current_assignee||'-'}</td>
                          <td><HoursCell est={t.dev_estimate_hours} actual={t.actual_dev_hours} /></td>
                          <td style={{textAlign:'center'}}>{t.bugs_total>0?t.bugs_total:'-'}</td>
                          <td style={{textAlign:'center'}}>{t.bugs_open>0?<span className="qcq-fail">{t.bugs_open}</span>:'-'}</td>
                          <td style={{textAlign:'center'}}>{t.bugs_released_to_qa>0?<span className="qcq-pass">{t.bugs_released_to_qa}</span>:'-'}</td>
                          <td style={{textAlign:'center'}}>{t.bugs_closed>0?<span className="qcq-pass">{t.bugs_closed}</span>:'-'}</td>
                          <td className="qcq-eta">{t.eta?new Date(t.eta).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'-'}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Dev Dashboard</h1>
            <p className="header-subtitle">Development pipeline insights</p>
          </div>
          <div className="header-right" style={{display:'flex',gap:'6px',alignItems:'center'}}>
            <div className="qcq-platform-toggle">
              <button className={`btn btn-sm ${platformFilter==='all'?'btn-primary':'btn-secondary'}`} onClick={()=>setPlatformFilter('all')}>All ({allTickets.length})</button>
              <button className={`btn btn-sm ${platformFilter==='Web'?'btn-primary':'btn-secondary'}`} onClick={()=>setPlatformFilter('Web')}>Web ({allTickets.filter(t=>t.platform==='Web').length})</button>
              <button className={`btn btn-sm ${platformFilter==='Mobile'?'btn-primary':'btn-secondary'}`} onClick={()=>setPlatformFilter('Mobile')}>Mobile ({allTickets.filter(t=>t.platform==='Mobile').length})</button>
            </div>
            <button onClick={forceRefresh} className="btn btn-secondary btn-sm">Sync & Refresh</button>
          </div>
        </header>

        {/* Dev Status Cards */}
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px 4px' }}>Development</div>
        <div className="qcq-status-cards">
          <CardBtn value={summary.total_dev} label="Total Dev" filter="dev" color="var(--accent-green)" />
          <CardBtn value={(summary.dev_status_counts || {})['Ready For Development'] || 0} label="Ready For Development" filter="first_time_Ready For Development" color="var(--accent-blue)" />
          <CardBtn value={(summary.dev_status_counts || {})['In Progress'] || 0} label="In Progress" sub="Excl. failed refix tickets" filter="first_time_In Progress" color="var(--accent-green)" />
          <CardBtn value={summary.refix_count} label="Dev Refix" sub="Failed tickets being fixed" filter="refix" color="var(--accent-amber)" />
          {['Hold/Pending','Start Code Review','Code Review Failed','Code Review Passed','Express Lane Review','Testing In Progress'].map(s => {
            const cnt = (summary.dev_status_counts || {})[s] || 0;
            const colors = {'Code Review Passed':'var(--accent-red)','Hold/Pending':'var(--accent-amber)','Start Code Review':'var(--accent-purple)','Code Review Failed':'var(--accent-red)'};
            return cnt > 0 ? <CardBtn key={s} value={cnt} label={s} filter={'first_time_' + s} color={colors[s] || 'var(--accent-blue)'} /> : null;
          })}
          <CardBtn value={(summary.qa_status_counts || {})['QC Review Fail'] || 0} label="QC Review Fail" filter="QC Review Fail" color="var(--accent-red)" />
          <CardBtn value={(summary.qa_status_counts || {})['Tested - Awaiting Fixes'] || 0} label="Tested - Awaiting Fixes" filter="Tested - Awaiting Fixes" color="var(--accent-amber)" />
          <CardBtn value={(summary.qa_status_counts || {})['Approved for Live'] || 0} label="Approved for Live" filter="Approved for Live" color="var(--accent-teal)" />
          <CardBtn value={summary.dev_overrun_count} label="Dev Hrs Overrun" sub="Actual > Estimate" filter="dev_overrun" color="var(--accent-red)" />
        </div>

        {/* QA Status Cards */}
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '12px 0 6px 4px' }}>QA Pipeline</div>
        <div className="qcq-status-cards">
          <CardBtn value={summary.total_qa} label="Total QA" filter="qa" color="var(--accent-blue)" />
          {['QC Testing','QC Testing in Progress','QC Testing Hold','BIS Testing','Moved to Live'].map(s => {
            const cnt = (summary.qa_status_counts || {})[s] || 0;
            const colors = {'QC Testing':'var(--accent-blue)','QC Testing in Progress':'var(--accent-green)','QC Testing Hold':'var(--accent-amber)','BIS Testing':'var(--accent-purple)','Moved to Live':'var(--accent-green)'};
            return cnt > 0 ? <CardBtn key={s} value={cnt} label={s} filter={s} color={colors[s] || 'var(--text-muted)'} /> : null;
          })}
        </div>

        <div className="qcq-tabs">
          <button className={`qcq-tab ${activeTab==='resources'?'active':''}`} onClick={()=>{setActiveTab('resources');setCardFilter(null);}}>Developers ({summary.total_developers})</button>
          <button className={`qcq-tab ${activeTab==='tickets'?'active':''}`} onClick={()=>setActiveTab('tickets')}>All Tickets ({allTickets.length})</button>
          <button className={`qcq-tab ${activeTab==='modules'?'active':''}`} onClick={()=>{setActiveTab('modules');setCardFilter(null);}}>Modules ({modules.length})</button>
        </div>

        {activeTab === 'resources' && renderResources()}
        {activeTab === 'tickets' && renderTickets()}
        {activeTab === 'modules' && renderModules()}
      </main>
    </div>
  );
}
