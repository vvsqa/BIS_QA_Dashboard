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
  const [buildQuality, setBuildQuality] = useState(null);
  const [bqFilter, setBqFilter] = useState(null); // {type: 'developer'|'module'|'status', value: string}
  const bqListRef = useRef(null);
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
      const [res, bqRes] = await Promise.all([
        safeFetch('/live/dev-dashboard'),
        safeFetch('/live/build-quality'),
      ]);
      if (res?.ok) setData(await res.json());
      if (bqRes?.ok) setBuildQuality(await bqRes.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [syncing, setSyncing] = useState(false);
  const forceRefresh = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/live/refresh`, { method: 'POST' });
      setCardFilter(null); setExpandedDev(null); setExpandedModule(null); setBqFilter(null);
      setSearchFilter(''); setStageFilter(''); setAssigneeFilter(''); setModuleFilter(''); setDeveloperFilter('');
      await fetchData();
    } finally { setSyncing(false); }
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
          </div>
        </header>

        {/* Dev Status Cards */}
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px 4px' }}>Development</div>
        <div className="qcq-status-cards">
          <CardBtn value={summary.total_dev} label="Total Dev" filter="dev" color="var(--accent-green)" />
          <CardBtn value={(summary.dev_status_counts || {})['Ready For Development'] || 0} label="Ready For Development" filter="first_time_Ready For Development" color="var(--accent-blue)" />
          <CardBtn value={(summary.dev_status_counts || {})['In Progress'] || 0} label="In Progress" sub="Excl. failed refix tickets" filter="first_time_In Progress" color="var(--accent-green)" />
          <CardBtn value={summary.refix_count} label="Dev Refix" sub="Failed tickets being fixed" filter="refix" color="var(--accent-amber)" />
          {['Hold/Pending','Start Code Review','Code Review Failed','Code Review Passed','Express Lane Review'].map(s => {
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
          <button className={`qcq-tab ${activeTab==='quality'?'active':''}`} onClick={()=>setActiveTab('quality')} style={{color: activeTab==='quality' ? 'var(--accent-red)' : ''}}>Build Quality</button>
        </div>

        {activeTab === 'resources' && renderResources()}
        {activeTab === 'tickets' && renderTickets()}
        {activeTab === 'modules' && renderModules()}

        {/* Build Quality Analysis Tab */}
        {activeTab === 'quality' && buildQuality && (() => {
          const bq = buildQuality;
          const s = bq.summary || {};
          return (
            <div>
              {/* Summary cards — clickable to filter */}
              {(() => {
                const clickBq = (filter) => {
                  setBqFilter(bqFilter?.type === filter.type && bqFilter?.value === filter.value ? null : filter);
                  setTimeout(() => bqListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                };
                return (
              <div className="qcq-status-cards">
                <div className="qcq-card qcq-card-total">
                  <div className="qcq-card-value">{s.total_qa_tested || 0}</div>
                  <div className="qcq-card-label">Tickets Tested by QA</div>
                </div>
                <div className="qcq-card" style={{borderTop:'3px solid var(--accent-green)'}}>
                  <div className="qcq-card-value" style={{color:'var(--accent-green)'}}>{s.pass_rate || 0}%</div>
                  <div className="qcq-card-label">First-time Pass Rate</div>
                </div>
                <div className="qcq-card qcq-card-clickable" style={{borderTop:'3px solid var(--accent-red)', cursor:'pointer'}} onClick={() => clickBq({type:'all',value:'all'})}>
                  <div className="qcq-card-value" style={{color:'var(--accent-red)'}}>{s.total_failed || 0}</div>
                  <div className="qcq-card-label">Total QC Failures</div>
                  <div className="qcq-card-sub">{s.fail_rate}% fail rate</div>
                </div>
                <div className="qcq-card qcq-card-clickable" style={{borderTop:'3px solid var(--accent-red)', cursor:'pointer'}} onClick={() => clickBq({type:'verdict',value:'Critical'})}>
                  <div className="qcq-card-value" style={{color:'var(--accent-red)'}}>{s.obvious_failures || 0}</div>
                  <div className="qcq-card-label">Obvious / Basic Failures</div>
                  <div className="qcq-card-sub">Click to see list</div>
                </div>
                <div className="qcq-card qcq-card-clickable" style={{borderTop:'3px solid var(--accent-amber)', cursor:'pointer'}} onClick={() => clickBq({type:'status',value:'QC Review Fail'})}>
                  <div className="qcq-card-value">{s.currently_in_qc_fail || 0}</div>
                  <div className="qcq-card-label">Currently in QC Fail</div>
                  <div className="qcq-card-sub">Click to see list</div>
                </div>
                <div className="qcq-card qcq-card-clickable" style={{borderTop:'3px solid var(--accent-amber)', cursor:'pointer'}} onClick={() => clickBq({type:'status',value:'refix'})}>
                  <div className="qcq-card-value">{s.refix_in_dev || 0}</div>
                  <div className="qcq-card-label">Refix in Dev Pipeline</div>
                  <div className="qcq-card-sub">Click to see list</div>
                </div>
              </div>);
              })()}

              {/* Build Quality Verdict */}
              <div className="qcq-section" style={{padding:'12px',background: s.build_quality_score >= 70 ? 'rgba(34,197,94,0.08)' : s.build_quality_score >= 40 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', borderRadius:'8px',border:`1px solid ${s.build_quality_score >= 70 ? 'rgba(34,197,94,0.3)' : s.build_quality_score >= 40 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,marginBottom:'12px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                  <div style={{fontSize:'2rem',fontWeight:700,color: s.build_quality_score >= 70 ? 'var(--accent-green)' : s.build_quality_score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)'}}>{s.build_quality_score || 0}/100</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.95rem'}}>Build Quality Score</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-secondary)'}}>
                      {s.build_quality_score >= 70 ? 'Good — Most builds pass QA on first attempt' :
                       s.build_quality_score >= 40 ? 'Needs Improvement — Significant failures on basic scenarios' :
                       'Poor — Frequent obvious failures despite code review'}
                    </div>
                    <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'4px'}}>
                      {s.obvious_failures || 0} obvious failures (basic scenario bugs found with minimal QA effort) |
                      {s.thorough_failures || 0} thorough test failures (found during deep testing)
                    </div>
                  </div>
                </div>
              </div>

              {/* Developer Fail Analysis */}
              <div className="qcq-section">
                <h2 className="qcq-section-title">Developer Build Quality Ranking</h2>
                <div className="qcq-table-container">
                  <table className="qcq-table">
                    <thead>
                      <tr>
                        <th>Developer</th>
                        <th style={{textAlign:'center'}}>Tested</th>
                        <th style={{textAlign:'center',background:'rgba(239,68,68,0.12)'}}>Failed</th>
                        <th style={{textAlign:'center'}}>Obvious</th>
                        <th style={{textAlign:'center',background:'rgba(239,68,68,0.12)'}}>Fail %</th>
                        <th style={{textAlign:'center'}}>Bugs</th>
                        <th style={{textAlign:'center'}}>Bug/Ticket</th>
                        <th style={{textAlign:'center'}}>Overrun</th>
                        <th style={{textAlign:'center'}}>Score</th>
                        <th style={{width:'100px'}}>Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bq.developers || []).filter(d => d.tickets_tested >= 3).map(d => (
                          <tr key={d.developer} className="qcq-row" style={{cursor: d.failed > 0 ? 'pointer' : 'default', background: bqFilter?.type==='developer' && bqFilter?.value===d.developer ? 'rgba(239,68,68,0.08)' : ''}}
                            onClick={() => { if(d.failed > 0) { setBqFilter(bqFilter?.value===d.developer ? null : {type:'developer',value:d.developer}); setTimeout(()=>bqListRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),100); } }}>
                            <td style={{fontWeight:600}}>{d.developer}</td>
                            <td style={{textAlign:'center'}}>{d.tickets_tested}</td>
                            <td style={{textAlign:'center',color: d.failed > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: d.failed > 0 ? 700 : 400}}>{d.failed || '-'}</td>
                            <td style={{textAlign:'center',color: d.obvious_fails > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: d.obvious_fails > 0 ? 700 : 400}}>{d.obvious_fails || '-'}</td>
                            <td style={{textAlign:'center',fontWeight:700,color: d.fail_rate > 20 ? 'var(--accent-red)' : d.fail_rate > 10 ? 'var(--accent-amber)' : 'var(--accent-green)'}}>{d.fail_rate}%</td>
                            <td style={{textAlign:'center',color: d.bugs_reported > 0 ? 'var(--accent-red)' : 'var(--text-muted)'}}>{d.bugs_reported || '-'}</td>
                            <td style={{textAlign:'center',color: d.bug_density > 2 ? 'var(--accent-red)' : d.bug_density > 1 ? 'var(--accent-amber)' : 'var(--text-muted)'}}>{d.bug_density}</td>
                            <td style={{textAlign:'center',color: d.overrun_count > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'}}>{d.overrun_count || '-'}</td>
                            <td style={{textAlign:'center',fontWeight:700,color: d.quality_score >= 70 ? 'var(--accent-green)' : d.quality_score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)'}}>{d.quality_score}</td>
                            <td>
                              <div style={{height:'8px',background:'rgba(100,116,139,0.15)',borderRadius:'4px',overflow:'hidden'}}>
                                <div style={{width:`${d.quality_score}%`,height:'100%',background: d.quality_score >= 70 ? '#22c55e' : d.quality_score >= 40 ? '#f59e0b' : '#ef4444',borderRadius:'4px'}} />
                              </div>
                            </td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Module Fail Analysis */}
              <div className="qcq-section">
                <h2 className="qcq-section-title">Module-wise Build Quality</h2>
                <div className="qcq-table-container">
                  <table className="qcq-table">
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th style={{textAlign:'center'}}>Tickets Tested</th>
                        <th style={{textAlign:'center',background:'rgba(239,68,68,0.12)'}}>QC Failed</th>
                        <th style={{textAlign:'center'}}>Refix</th>
                        <th style={{textAlign:'center',background:'rgba(239,68,68,0.12)'}}>Fail Rate</th>
                        <th style={{textAlign:'center'}}>Bugs</th>
                        <th style={{width:'120px'}}>Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bq.modules || []).map(m => (
                        <tr key={m.module} className="qcq-row" style={{cursor: m.failed > 0 ? 'pointer' : 'default', background: bqFilter?.type==='module' && bqFilter?.value===m.module ? 'rgba(239,68,68,0.08)' : ''}}
                          onClick={() => { if(m.failed > 0) { setBqFilter(bqFilter?.value===m.module ? null : {type:'module',value:m.module}); setTimeout(()=>bqListRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),100); } }}>
                          <td style={{fontWeight:600}}>{m.module}</td>
                          <td style={{textAlign:'center'}}>{m.tickets_tested}</td>
                          <td style={{textAlign:'center',color: m.failed > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: m.failed > 0 ? 700 : 400}}>{m.failed || '-'}</td>
                          <td style={{textAlign:'center',color: m.refix_in_dev > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'}}>{m.refix_in_dev || '-'}</td>
                          <td style={{textAlign:'center',fontWeight:700,color: m.fail_rate > 30 ? 'var(--accent-red)' : m.fail_rate > 15 ? 'var(--accent-amber)' : 'var(--accent-green)'}}>{m.fail_rate}%</td>
                          <td style={{textAlign:'center',color: m.bugs_reported > 0 ? 'var(--accent-red)' : 'var(--text-muted)'}}>{m.bugs_reported || '-'}</td>
                          <td>
                            <div style={{height:'8px',background:'rgba(100,116,139,0.15)',borderRadius:'4px',overflow:'hidden'}}>
                              <div style={{width:`${100-m.fail_rate}%`,height:'100%',background: m.fail_rate > 30 ? '#ef4444' : m.fail_rate > 15 ? '#f59e0b' : '#22c55e',borderRadius:'4px'}} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Current QC Failures detail */}
              <div className="qcq-section">
                <h2 className="qcq-section-title">Current QC Review Failures ({(bq.current_failures||[]).length})</h2>
                <div className="qcq-table-container">
                  <table className="qcq-table" style={{fontSize:'0.8rem'}}>
                    <thead>
                      <tr><th>Ticket</th><th>Title</th><th>Module</th><th>Priority</th><th>Developer</th><th>QC Tester</th><th>Cycles</th><th>Bugs</th><th>Open Bugs</th></tr>
                    </thead>
                    <tbody>
                      {(bq.current_failures||[]).map(t => (
                        <tr key={t.ticket_id} className="qcq-row">
                          <td><a href={`https://www.bissafety.app/pm/tickets#!/${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                          <td style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.title}>{t.title}</td>
                          <td>{t.module}</td>
                          <td>{t.priority}</td>
                          <td>{t.developers_str || '-'}</td>
                          <td>{t.qc_tester || '-'}</td>
                          <td style={{textAlign:'center',color: t.cycle_count > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: t.cycle_count > 0 ? 700 : 400}}>{t.cycle_count || '-'}</td>
                          <td style={{textAlign:'center',color:'var(--accent-red)',fontWeight:700}}>{t.bugs_total || '-'}</td>
                          <td style={{textAlign:'center',color: t.bugs_open > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'}}>{t.bugs_open || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Failed Build Analysis — quality verdict per ticket */}
              <div className="qcq-section" ref={bqListRef}>
                <h2 className="qcq-section-title">
                  Failed Build Analysis
                  {bqFilter && (
                    <span style={{fontSize:'0.8rem',marginLeft:'8px',color:'var(--accent-red)'}}>
                      — {bqFilter.type === 'developer' ? `Developer: ${bqFilter.value}` :
                         bqFilter.type === 'module' ? `Module: ${bqFilter.value}` :
                         bqFilter.type === 'verdict' ? 'Obvious/Basic Failures' :
                         bqFilter.type === 'status' ? (bqFilter.value === 'refix' ? 'Refix in Dev' : bqFilter.value) : 'All Failures'}
                      <button className="btn btn-sm btn-secondary" onClick={() => setBqFilter(null)} style={{marginLeft:'8px',fontSize:'0.7rem'}}>Clear</button>
                    </span>
                  )}
                </h2>
                {(() => {
                  let filtered = bq.failed_ticket_analysis || [];
                  if (bqFilter) {
                    if (bqFilter.type === 'developer') filtered = filtered.filter(t => (t.developers_str || '').includes(bqFilter.value));
                    else if (bqFilter.type === 'module') filtered = filtered.filter(t => t.module === bqFilter.value);
                    else if (bqFilter.type === 'verdict') filtered = filtered.filter(t => t.verdict.includes(bqFilter.value) || t.verdict.includes('Poor'));
                    else if (bqFilter.type === 'status' && bqFilter.value === 'QC Review Fail') filtered = filtered.filter(t => t.status === 'QC Review Fail');
                    else if (bqFilter.type === 'status' && bqFilter.value === 'refix') filtered = filtered.filter(t => t.status !== 'QC Review Fail');
                  }
                  return (<>
                <p style={{fontSize:'0.78rem',color:'var(--text-muted)',marginBottom:'8px'}}>
                  {filtered.length} tickets — sorted by QA hours before failure (lowest = obvious bugs)
                </p>
                <div className="qcq-table-container">
                  <table className="qcq-table" style={{fontSize:'0.8rem'}}>
                    <thead>
                      <tr>
                        <th>Ticket</th><th>Module</th><th>Developer</th>
                        <th style={{textAlign:'center'}}>QA Hrs Before Fail</th>
                        <th style={{textAlign:'center'}}>Bugs Found</th>
                        <th style={{textAlign:'center'}}>Cycles</th>
                        <th>Status</th>
                        <th>Quality Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(t => (
                        <tr key={t.ticket_id} className="qcq-row" style={{background: t.verdict.includes('Critical') ? 'rgba(239,68,68,0.06)' : t.verdict.includes('Poor') ? 'rgba(245,158,11,0.04)' : ''}}>
                          <td><a href={`https://www.bissafety.app/pm/tickets#!/${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                          <td>{t.module}</td>
                          <td style={{fontSize:'0.75rem'}}>{(t.developers_str || '').split(',')[0] || '-'}</td>
                          <td style={{textAlign:'center',fontWeight:700,color: t.qa_hours_before_fail < 1 ? 'var(--accent-red)' : t.qa_hours_before_fail < 2 ? 'var(--accent-amber)' : 'var(--text-primary)'}}>{t.qa_hours_before_fail}h</td>
                          <td style={{textAlign:'center',color: t.bugs_found > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: t.bugs_found > 0 ? 700 : 400}}>{t.bugs_found || '-'}</td>
                          <td style={{textAlign:'center'}}>{t.cycle_count || '-'}</td>
                          <td><span className="qcq-status-badge" style={{fontSize:'0.68rem'}}>{t.status}</span></td>
                          <td>
                            <span style={{fontSize:'0.72rem',padding:'2px 8px',borderRadius:'4px',
                              background: t.verdict.includes('Critical') ? 'rgba(239,68,68,0.15)' : t.verdict.includes('Poor') ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.1)',
                              color: t.verdict.includes('Critical') ? 'var(--accent-red)' : t.verdict.includes('Poor') ? 'var(--accent-amber)' : 'var(--text-secondary)',
                              fontWeight: 600}}>
                              {t.verdict}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>); })()}
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
