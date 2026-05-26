import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';
const TR_URL = 'https://bistrainer.testrail.io/index.php?/plans/view/';

export default function AutomationUtilization() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualForm, setManualForm] = useState({ person: '', date: '', module: '', cases_scripted: 0, cases_executed: 0, activity: 'scripting', notes: '' });
  const [activeTab, setActiveTab] = useState('overview');
  const [historyView, setHistoryView] = useState('weekly');
  const [memberWeekly, setMemberWeekly] = useState(null);
  const [loadingMember, setLoadingMember] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, teamRes] = await Promise.all([
        fetch(`${API_BASE}/live/automation-utilization`),
        fetch(`${API_BASE}/live/automation-team`),
      ]);
      if (res.ok) setData(await res.json());
      if (teamRes.ok) setTeamData(await teamRes.json());
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMemberWeekly = async (person) => {
    setLoadingMember(true);
    try {
      const res = await fetch(`${API_BASE}/live/automation-team/${encodeURIComponent(person)}`);
      if (res.ok) setMemberWeekly(await res.json());
    } finally { setLoadingMember(false); }
  };

  const submitManualEntry = async () => {
    const res = await fetch(`${API_BASE}/live/automation-team/log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manualForm),
    });
    if (res.ok) { setShowManualEntry(false); fetchData(); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const downloadReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/live/reports/automation-weekly`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (res.headers.get('content-disposition')?.split('filename=')[1] || 'Automation_Report.xlsx').replace(/"/g, '');
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Report download failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading Automation Data...</p></div>
        </main>
      </div>
    );
  }

  const summary = data?.summary || {};
  const plans = data?.plans || [];
  const monthly = data?.monthly_trend || [];
  const modules = data?.module_coverage || [];
  const weeklyHistory = data?.weekly_history || [];
  const monthlyHistory = data?.monthly_history || [];
  const execModules = data?.execution_modules || [];
  const maxMonthlyTotal = Math.max(...monthly.map(m => m.total), 1);

  // Color palette for modules
  const MODULE_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316','#06b6d4','#84cc16','#a855f7','#6366f1','#10b981','#e11d48','#0ea5e9','#d946ef','#eab308','#64748b','#fb923c','#2dd4bf'];

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Automation Utilization</h1>
            <p className="header-subtitle">Test automation coverage, execution trends & time saved</p>
          </div>
          <div className="header-right">
            <button onClick={downloadReport} className="btn btn-primary btn-sm" disabled={generating}>
              {generating ? 'Generating...' : 'Download Report'}
            </button>
            <button onClick={fetchData} className="btn btn-secondary btn-sm" style={{ marginLeft: '6px' }}>Refresh</button>
          </div>
        </header>

        {/* Tabs */}
        <div className="qcq-tabs" style={{ flexWrap: 'wrap' }}>
          <button className={`qcq-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
          <button className={`qcq-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Execution History</button>
          {(teamData?.members || []).map(m => (
            <button key={m.name} className={`qcq-tab ${activeTab === `member_${m.name}` ? 'active' : ''}`}
              onClick={() => { setActiveTab(`member_${m.name}`); fetchMemberWeekly(m.name); }}>
              {m.name.split(' ')[0]} ({m.total_scripted})
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (<>
        {/* Summary Cards — auto/manual split */}
        <div className="qcq-status-cards">
          <div className="qcq-card qcq-card-total">
            <div style={{display:'flex',gap:'8px',justifyContent:'center',alignItems:'baseline'}}>
              <span style={{fontSize:'1.6rem',fontWeight:700,color:'var(--accent-teal)'}}>{summary.total_auto_executions || 0}</span>
              <span style={{fontSize:'1rem',color:'var(--accent-amber)'}}>{summary.total_manual_executions || 0}</span>
            </div>
            <div className="qcq-card-label">Automated + Manual Executions</div>
            <div className="qcq-card-sub">{summary.total_test_executions || 0} total</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-teal)' }}>
            <div className="qcq-card-value">{summary.total_automated_cases || 0}</div>
            <div className="qcq-card-label">Automated Cases</div>
            <div className="qcq-card-sub">{summary.automation_coverage || 0}% of {summary.total_test_cases || 0}</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
            <div className="qcq-card-value">{summary.total_plans || 0}</div>
            <div className="qcq-card-label">Test Plans</div>
            <div className="qcq-card-sub">Across all modules</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
            <div className="qcq-card-value">{summary.avg_reuse_ratio || 0}x</div>
            <div className="qcq-card-label">Avg Auto Reuse</div>
            <div className="qcq-card-sub">Times each automated case re-executed</div>
          </div>
          <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
            <div className="qcq-card-value" style={{ color: 'var(--accent-green)' }}>{summary.qa_hours_saved || 0}h</div>
            <div className="qcq-card-label">QA Hours Saved</div>
            <div className="qcq-card-sub">Manual effort replaced by automation</div>
          </div>
        </div>

        {/* Monthly Trend — Auto vs Manual */}
        <div className="qcq-section">
          <h2 className="qcq-section-title">Monthly Execution Trend (Automated vs Manual)</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            {monthly.map(m => {
              // Estimate auto/manual for monthly using the same ratio approach
              const autoExec = Math.round((m.total || 0) * (summary.total_auto_executions / (summary.total_test_executions || 1)));
              const manualExec = (m.total || 0) - autoExec;
              const autoW = maxMonthlyTotal > 0 ? (autoExec / maxMonthlyTotal) * 100 : 0;
              const manualW = maxMonthlyTotal > 0 ? (manualExec / maxMonthlyTotal) * 100 : 0;
              return (
                <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '70px', textAlign: 'right', fontSize: '0.82rem', fontWeight: 600 }}>{m.month}</div>
                  <div style={{ flex: 1, display: 'flex', height: '28px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)' }}>
                    <div style={{ width: `${autoW}%`, background: '#14b8a6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#fff', fontWeight: 600, minWidth: autoExec > 0 ? '24px' : 0 }}>{autoExec}</div>
                    <div style={{ width: `${manualW}%`, background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#fff', fontWeight: 600, minWidth: manualExec > 0 ? '24px' : 0 }}>{manualExec}</div>
                  </div>
                  <div style={{ width: '140px', fontSize: '0.78rem', display: 'flex', gap: '8px' }}>
                    <span>{m.plans} plans</span>
                    <span style={{ fontWeight: 600 }}>{m.total} total</span>
                  </div>
                  <div style={{ width: '80px', fontSize: '0.72rem', color: 'var(--accent-green)' }}>
                    {m.qa_hours_saved > 0 ? `${Math.round(m.qa_hours_saved)}h saved` : ''}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '0.72rem' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#14b8a6' }} /> Automated</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f59e0b' }} /> Manual</span>
          </div>
        </div>

        {/* Module-wise table with auto/manual */}
        <div className="qcq-section">
          <h2 className="qcq-section-title">Module-wise Execution Breakdown</h2>
          <div className="qcq-table-container">
            <table className="qcq-table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th style={{textAlign:'center'}}>Automated<br/>Cases</th>
                  <th style={{textAlign:'center'}}>Manual<br/>Cases</th>
                  <th style={{textAlign:'center'}}>Plans</th>
                  <th style={{textAlign:'center',background:'rgba(20,184,166,0.15)'}}>Auto<br/>Exec</th>
                  <th style={{textAlign:'center',background:'rgba(245,158,11,0.15)'}}>Manual<br/>Exec</th>
                  <th style={{textAlign:'center',fontWeight:700}}>Total<br/>Exec</th>
                  <th style={{textAlign:'center'}}>Reuse</th>
                  <th style={{textAlign:'center'}}>Coverage</th>
                  <th style={{width:'140px'}}>Auto vs Manual</th>
                </tr>
              </thead>
              <tbody>
                {modules.filter(m => m.total_executions > 0).map(m => {
                  const maxExec = Math.max(...modules.map(x => x.total_executions || 0), 1);
                  const autoEx = m.auto_executions || 0;
                  const manualEx = m.manual_executions || 0;
                  const manualCases = Math.max(0, (m.total_cases || 0) - (m.automated || 0));
                  return (
                    <tr key={m.module} className="qcq-row">
                      <td style={{ fontWeight: 600 }}>{m.module}</td>
                      <td style={{ textAlign: 'center', color: 'var(--accent-teal)', fontWeight: 600 }}>{m.automated}</td>
                      <td style={{ textAlign: 'center', color: manualCases > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{manualCases || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{m.plans_count || 0}</td>
                      <td style={{ textAlign: 'center', color: 'var(--accent-teal)', fontWeight: 600 }}>{autoEx}</td>
                      <td style={{ textAlign: 'center', color: 'var(--accent-amber)' }}>{manualEx || '-'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>{m.total_executions}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: m.reuse_ratio >= 3 ? 'var(--accent-green)' : m.reuse_ratio >= 1 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                        {m.reuse_ratio || 0}x
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: m.automation_pct >= 50 ? 'var(--accent-green)' : m.automation_pct >= 20 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>{m.automation_pct}%</td>
                      <td>
                        <div style={{ height: '10px', background: 'rgba(100,116,139,0.15)', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                          <div style={{ width: `${(autoEx / maxExec) * 100}%`, height: '100%', background: '#14b8a6' }} />
                          <div style={{ width: `${(manualEx / maxExec) * 100}%`, height: '100%', background: '#f59e0b' }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Plans/Runs */}
        <div className="qcq-section">
          <h2 className="qcq-section-title">Recent Test Plans ({plans.length})</h2>
          <div className="qcq-table-container">
            <table className="qcq-table">
              <thead>
                <tr><th>Plan</th><th>Ticket</th><th>Module</th><th>Date</th><th>Total Exec</th><th>Auto Exec</th><th>Manual Exec</th><th>QA Hrs Saved</th></tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.plan_id} className="qcq-row">
                    <td><a href={`${TR_URL}${p.plan_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>{p.name}</a></td>
                    <td>{p.ticket_id ? <a href={`${PM_TICKET_URL}${p.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{p.ticket_id}</a> : '-'}</td>
                    <td>{p.module || '-'}</td>
                    <td>{p.created_on}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.total}</td>
                    <td style={{ textAlign: 'center', color: 'var(--accent-teal)', fontWeight: 600 }}>{p.auto_exec || 0}</td>
                    <td style={{ textAlign: 'center', color: 'var(--accent-amber)' }}>{p.manual_exec || 0}</td>
                    <td style={{ textAlign: 'center', color: p.qa_hours_saved > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{p.qa_hours_saved > 0 ? `${p.qa_hours_saved}h` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>)}

        {/* Execution History Tab */}
        {activeTab === 'history' && (() => {
          const dailyHistory = data?.daily_history || [];
          const cumulativeByMod = data?.cumulative_by_module || {};

          // Get current week's Mon-Fri
          const getWeekDays = (refDate) => {
            const d = new Date(refDate);
            const day = d.getDay();
            const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            const days = [];
            for (let i = 0; i < 5; i++) {
              const dd = new Date(mon); dd.setDate(mon.getDate() + i);
              days.push(dd.toISOString().split('T')[0]);
            }
            return days;
          };
          const today = new Date().toISOString().split('T')[0];
          const weekDays = getWeekDays(today);
          const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

          // Build daily calendar data for this week
          const dailyMap = {};
          dailyHistory.forEach(d => { dailyMap[d.date] = d; });

          // Helper: get total from daily module value (could be int or {total,auto,manual})
          const getModVal = (d, m, key='total') => {
            const v = dailyMap[d]?.modules?.[m];
            if (!v) return 0;
            return typeof v === 'object' ? (v[key] || 0) : (key === 'total' ? v : 0);
          };

          // Modules that have any execution
          const activeMods = execModules.filter(m => modules.some(mm => mm.module === m && mm.total_executions > 0));

          // This week totals per module
          const thisWeekByMod = {};
          activeMods.forEach(m => {
            thisWeekByMod[m] = weekDays.reduce((s, d) => s + getModVal(d, m), 0);
          });

          // Last week for comparison
          const lastWeekDays = getWeekDays(new Date(new Date(today).getTime() - 7*86400000));
          const lastWeekByMod = {};
          activeMods.forEach(m => {
            lastWeekByMod[m] = lastWeekDays.reduce((s, d) => s + getModVal(d, m), 0);
          });

          // Overall totals
          const thisWeekTotal = Object.values(thisWeekByMod).reduce((s, v) => s + v, 0);
          const lastWeekTotal = Object.values(lastWeekByMod).reduce((s, v) => s + v, 0);
          const allTimeTotal = modules.reduce((s, m) => s + (m.total_executions || 0), 0);

          return (
          <div>
          {/* Progress cards */}
          {(() => {
            const allAutoExec = modules.reduce((s, m) => s + (m.auto_executions || 0), 0);
            const allManualExec = modules.reduce((s, m) => s + (m.manual_executions || 0), 0);
            const thisWeekAuto = weekDays.reduce((s, d) => s + (dailyMap[d]?.auto_total || 0), 0);
            const thisWeekManual = weekDays.reduce((s, d) => s + (dailyMap[d]?.manual_total || 0), 0);
            const lastWeekAuto = lastWeekDays.reduce((s, d) => s + (dailyMap[d]?.auto_total || 0), 0);
            const lastWeekManual = lastWeekDays.reduce((s, d) => s + (dailyMap[d]?.manual_total || 0), 0);
            return (
            <div className="qcq-status-cards">
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-teal)' }}>
                <div className="qcq-card-value">{allAutoExec - thisWeekAuto}</div>
                <div className="qcq-card-label">Automated Executions Till Last Week</div>
                <div className="qcq-card-sub" style={{color:'var(--accent-amber)'}}>{allManualExec - thisWeekManual} manual</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
                <div style={{display:'flex',gap:'8px',justifyContent:'center',alignItems:'baseline'}}>
                  <span style={{fontSize:'1.6rem',fontWeight:700,color:'var(--accent-teal)'}}>+{thisWeekAuto}</span>
                  <span style={{fontSize:'1rem',color:'var(--accent-amber)'}}>+{thisWeekManual}</span>
                </div>
                <div className="qcq-card-label">This Week (Auto + Manual)</div>
                <div className="qcq-card-sub">{weekDays[0]} to {weekDays[4]}</div>
              </div>
              <div className="qcq-card qcq-card-total">
                <div style={{display:'flex',gap:'8px',justifyContent:'center',alignItems:'baseline'}}>
                  <span style={{fontSize:'1.6rem',fontWeight:700,color:'var(--accent-teal)'}}>{allAutoExec}</span>
                  <span style={{fontSize:'1rem',color:'var(--accent-amber)'}}>{allManualExec}</span>
                </div>
                <div className="qcq-card-label">Total (Auto + Manual) All Time</div>
                <div className="qcq-card-sub">{allTimeTotal} combined</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
                <div style={{display:'flex',gap:'8px',justifyContent:'center',alignItems:'baseline'}}>
                  <span style={{fontSize:'1.4rem',fontWeight:700,color:'var(--accent-teal)'}}>{lastWeekAuto}</span>
                  <span style={{fontSize:'0.95rem',color:'var(--accent-amber)'}}>{lastWeekManual}</span>
                </div>
                <div className="qcq-card-label">Last Week (Auto + Manual)</div>
                <div className="qcq-card-sub">{lastWeekDays[0]} to {lastWeekDays[4]}</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-amber)' }}>
                <div className="qcq-card-value" style={{ color: thisWeekTotal >= lastWeekTotal ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {thisWeekTotal >= lastWeekTotal ? '+' : ''}{thisWeekTotal - lastWeekTotal}
                </div>
                <div className="qcq-card-label">Week-over-Week Change</div>
              </div>
            </div>);
          })()}

          {/* Weekly toggle */}
          {(() => {
            // Navigate weeks
            const weekOffset = (() => { try { return parseInt(new URLSearchParams(window.location.search).get('wo')) || 0; } catch { return 0; } })();
            const getWeekDaysOffset = (off) => {
              const d = new Date(); d.setDate(d.getDate() + off * 7);
              const day = d.getDay();
              const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
              return Array.from({length: 5}, (_, i) => { const dd = new Date(mon); dd.setDate(mon.getDate() + i); return dd.toISOString().split('T')[0]; });
            };

            // Only show modules with executions in the selected week
            const modsWithExec = activeMods.filter(m =>
              weekDays.some(d => {
                const dm = dailyMap[d]?.modules?.[m];
                return dm && (typeof dm === 'object' ? dm.total > 0 : dm > 0);
              })
            );

            return (<>
          {/* Calendar: Modules as rows, Days as columns, Auto/Manual split */}
          <div className="qcq-section">
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px'}}>
              <h2 className="qcq-section-title" style={{margin:0}}>
                Weekly Execution Calendar
              </h2>
              <span style={{fontSize:'0.78rem',color:'var(--text-muted)'}}>{weekDays[0]} to {weekDays[4]}</span>
            </div>
            <div style={{display:'flex',gap:'12px',marginBottom:'10px',fontSize:'0.72rem'}}>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--accent-teal)',marginRight:4}}/>Automated</span>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--accent-amber)',marginRight:4}}/>Manual</span>
            </div>
            <div className="qcq-table-container">
              <table className="qcq-table" style={{ fontSize: '0.76rem' }}>
                <thead>
                  <tr>
                    <th style={{minWidth:'140px'}}>Module</th>
                    <th style={{textAlign:'center',fontSize:'0.66rem'}}>Auto<br/>Cases</th>
                    <th style={{textAlign:'center',fontSize:'0.66rem'}}>Manual<br/>Cases</th>
                    {weekDays.map((d, di) => (
                      <th key={d} style={{textAlign:'center',minWidth:'80px', background: d === today ? 'rgba(20,184,166,0.12)' : ''}}>
                        {dayNames[di]}<br/><span style={{fontSize:'0.6rem',color:'var(--text-muted)'}}>{d.slice(5)}</span>
                        {d === today && <span style={{color:'var(--accent-teal)',fontSize:'0.55rem',display:'block'}}>TODAY</span>}
                      </th>
                    ))}
                    <th style={{textAlign:'center',fontWeight:700}}>Week<br/>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(modsWithExec.length > 0 ? modsWithExec : activeMods).map((m, mi) => {
                    const modInfo = modules.find(mm => mm.module === m) || {};
                    const autoCount = modInfo.automated || 0;
                    const manualCount = Math.max(0, (modInfo.total_cases || 0) - autoCount);
                    let weekAuto = 0, weekManual = 0;
                    return (
                      <tr key={m} className="qcq-row">
                        <td style={{fontWeight:600,fontSize:'0.74rem'}}>
                          <span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:MODULE_COLORS[mi % MODULE_COLORS.length],marginRight:5}}/>
                          {m}
                        </td>
                        <td style={{textAlign:'center',color:'var(--accent-teal)',fontWeight:600,fontSize:'0.72rem'}}>{autoCount}</td>
                        <td style={{textAlign:'center',color:'var(--accent-amber)',fontSize:'0.72rem'}}>{manualCount || '-'}</td>
                        {weekDays.map(d => {
                          const auto = getModVal(d, m, 'auto');
                          const manual = getModVal(d, m, 'manual');
                          const total = getModVal(d, m, 'total');
                          weekAuto += auto; weekManual += manual;
                          return (
                            <td key={d} style={{textAlign:'center',padding:'3px 4px', background: total > 0 ? `${MODULE_COLORS[mi % MODULE_COLORS.length]}08` : ''}}>
                              {total > 0 ? (
                                <div style={{display:'flex',flexDirection:'column',gap:'1px',alignItems:'center'}}>
                                  {auto > 0 && <span style={{color:'var(--accent-teal)',fontWeight:700,fontSize:'0.75rem'}}>{auto}</span>}
                                  {manual > 0 && <span style={{color:'var(--accent-amber)',fontSize:'0.68rem'}}>{manual}</span>}
                                  {auto === 0 && manual === 0 && total > 0 && <span style={{fontWeight:600}}>{total}</span>}
                                </div>
                              ) : <span style={{color:'var(--text-muted)'}}>-</span>}
                            </td>
                          );
                        })}
                        <td style={{textAlign:'center'}}>
                          <div style={{display:'flex',flexDirection:'column',gap:'1px',alignItems:'center'}}>
                            <span style={{fontWeight:700,color:'var(--accent-teal)'}}>{weekAuto || '-'}</span>
                            {weekManual > 0 && <span style={{color:'var(--accent-amber)',fontSize:'0.68rem'}}>{weekManual}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals */}
                  <tr className="qcq-row" style={{background:'var(--bg-tertiary)'}}>
                    <td style={{fontWeight:700}}>TOTAL</td>
                    <td style={{textAlign:'center',fontWeight:700,color:'var(--accent-teal)'}}>{modules.reduce((s,m)=>s+(m.automated||0),0)}</td>
                    <td style={{textAlign:'center',color:'var(--accent-amber)'}}>{modules.reduce((s,m)=>s+Math.max(0,(m.total_cases||0)-(m.automated||0)),0)}</td>
                    {weekDays.map(d => {
                      const dd = dailyMap[d];
                      const auto = dd?.auto_total || 0;
                      const manual = dd?.manual_total || 0;
                      return (
                        <td key={d} style={{textAlign:'center'}}>
                          <div style={{display:'flex',flexDirection:'column',gap:'1px',alignItems:'center'}}>
                            {auto > 0 && <span style={{fontWeight:700,color:'var(--accent-teal)'}}>{auto}</span>}
                            {manual > 0 && <span style={{color:'var(--accent-amber)',fontSize:'0.68rem'}}>{manual}</span>}
                            {auto === 0 && manual === 0 && <span>-</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{textAlign:'center'}}>
                      <span style={{fontWeight:700,color:'var(--accent-teal)'}}>{thisWeekTotal}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily execution trend (Mon-Fri) — SVG line chart */}
          <div className="qcq-section">
            <h2 className="qcq-section-title">Daily Execution Trend (Mon — Fri)</h2>
            {(() => {
              // Get daily data for this week's Mon-Fri
              const dayData = weekDays.map(d => {
                const dd = dailyMap[d];
                return {
                  date: d,
                  day: dayNames[weekDays.indexOf(d)],
                  total: dd?.total || 0,
                  auto: dd?.auto_total || 0,
                  manual: dd?.manual_total || 0,
                };
              });
              const W = 600, H = 180, pad = 50;
              const maxVal = Math.max(...dayData.map(d => Math.max(d.total, d.auto, d.manual)), 10);
              const xStep = (W - pad * 2) / 4;  // 5 days = 4 gaps
              const yScale = (v) => H - pad - (v / maxVal) * (H - pad * 2);

              const autoPts = dayData.map((d, i) => `${pad + i * xStep},${yScale(d.auto)}`).join(' ');
              const manualPts = dayData.map((d, i) => `${pad + i * xStep},${yScale(d.manual)}`).join(' ');
              const totalPts = dayData.map((d, i) => `${pad + i * xStep},${yScale(d.total)}`).join(' ');

              return (
                <div style={{overflowX:'auto'}}>
                  <svg viewBox={`0 0 ${W} ${H + 25}`} style={{width:'100%',maxHeight:'230px'}}>
                    {/* Grid */}
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                      const y = yScale(maxVal * pct);
                      return <g key={pct}><line x1={pad} y1={y} x2={W-pad} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="4"/>
                        <text x={pad-6} y={y+3} textAnchor="end" fill="#64748b" fontSize="9">{Math.round(maxVal*pct)}</text></g>;
                    })}
                    {/* Lines */}
                    <polyline points={totalPts} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="5,3"/>
                    <polyline points={autoPts} fill="none" stroke="#14b8a6" strokeWidth="2.5"/>
                    <polyline points={manualPts} fill="none" stroke="#f59e0b" strokeWidth="2"/>
                    {/* Dots + values */}
                    {dayData.map((d, i) => {
                      const x = pad + i * xStep;
                      const isToday = d.date === today;
                      return <g key={d.date}>
                        <circle cx={x} cy={yScale(d.auto)} r={isToday ? 5 : 3.5} fill="#14b8a6" stroke={isToday ? '#fff' : 'none'} strokeWidth="1.5"/>
                        <circle cx={x} cy={yScale(d.manual)} r={isToday ? 4 : 3} fill="#f59e0b"/>
                        {d.auto > 0 && <text x={x} y={yScale(d.auto)-8} textAnchor="middle" fill="#14b8a6" fontSize="10" fontWeight="bold">{d.auto}</text>}
                        {d.manual > 0 && <text x={x} y={yScale(d.manual)-8} textAnchor="middle" fill="#f59e0b" fontSize="9">{d.manual}</text>}
                        <text x={x} y={H-pad+16} textAnchor="middle" fill={isToday ? '#14b8a6' : '#64748b'} fontSize="10" fontWeight={isToday ? 'bold' : 'normal'}>{d.day}</text>
                        <text x={x} y={H-pad+27} textAnchor="middle" fill="#64748b" fontSize="7">{d.date.slice(5)}</text>
                      </g>;
                    })}
                  </svg>
                  <div style={{display:'flex',gap:'20px',justifyContent:'center',fontSize:'0.75rem',marginTop:'4px'}}>
                    <span><span style={{display:'inline-block',width:20,height:3,background:'#14b8a6',marginRight:4,verticalAlign:'middle'}}/>Automated</span>
                    <span><span style={{display:'inline-block',width:20,height:3,background:'#f59e0b',marginRight:4,verticalAlign:'middle'}}/>Manual</span>
                    <span><span style={{display:'inline-block',width:20,height:2,background:'#64748b',marginRight:4,verticalAlign:'middle',borderTop:'1px dashed #64748b'}}/>Total</span>
                  </div>
                </div>
              );
            })()}
          </div>
          </>);
          })()}

          {/* Module Productivity — Repeated Executions = Value Add */}
          <div className="qcq-section">
            <h2 className="qcq-section-title">Module Productivity (Automation Value Add)</h2>
            <div className="qcq-table-container">
              <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th>Module</th>
                    <th style={{ textAlign: 'center' }}>Automated<br/>Cases</th>
                    <th style={{ textAlign: 'center' }}>Total<br/>Executions</th>
                    <th style={{ textAlign: 'center', background: 'rgba(20,184,166,0.12)' }}>Auto<br/>Executions</th>
                    <th style={{ textAlign: 'center', background: 'rgba(245,158,11,0.12)' }}>Manual<br/>Executions</th>
                    <th style={{ textAlign: 'center' }}>Reuse<br/>Ratio</th>
                    <th style={{ textAlign: 'center' }}>Plans</th>
                    <th style={{ textAlign: 'center' }}>Tickets</th>
                    <th style={{ width: '120px' }}>Productivity</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.filter(m => m.total_executions > 0).map(m => {
                    const maxEx = Math.max(...modules.map(x => x.total_executions || 0), 1);
                    const autoEx = m.auto_executions || 0;
                    const manualEx = m.manual_executions || 0;
                    return (
                      <tr key={m.module} className="qcq-row">
                        <td style={{ fontWeight: 600 }}>{m.module}</td>
                        <td style={{ textAlign: 'center', color: 'var(--accent-teal)', fontWeight: 600 }}>{m.automated || 0}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{m.total_executions}</td>
                        <td style={{ textAlign: 'center', color: 'var(--accent-teal)', fontWeight: 600 }}>{autoEx}</td>
                        <td style={{ textAlign: 'center', color: 'var(--accent-amber)' }}>{manualEx || '-'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: m.reuse_ratio >= 3 ? 'var(--accent-green)' : m.reuse_ratio >= 1 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                          {m.reuse_ratio || 0}x
                        </td>
                        <td style={{ textAlign: 'center' }}>{m.plans_count || 0}</td>
                        <td style={{ textAlign: 'center' }}>{m.tickets_covered || 0}</td>
                        <td>
                          <div style={{ height: '10px', background: 'rgba(100,116,139,0.15)', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${(autoEx / maxEx) * 100}%`, height: '100%', background: '#14b8a6' }} />
                            <div style={{ width: `${(manualEx / maxEx) * 100}%`, height: '100%', background: '#f59e0b' }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </div>);
        })()}

        {/* Per-Member and Team sections below */}
        {false && (
          <div>

            {(() => {
              const histData = historyView === 'weekly' ? weeklyHistory : monthlyHistory;
              const periodKey = historyView === 'weekly' ? 'week' : 'month';
              const maxTotal = Math.max(...histData.map(r => r.total), 1);

              // Get modules that have data
              const activeMods = execModules.filter(m =>
                histData.some(r => (r.modules?.[m] || 0) > 0)
              );
              const modColors = {};
              activeMods.forEach((m, i) => { modColors[m] = MODULE_COLORS[i % MODULE_COLORS.length]; });

              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    {activeMods.map(m => (
                      <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: modColors[m], display: 'inline-block' }} />
                        {m}
                      </div>
                    ))}
                  </div>

                  {/* Stacked bars per period */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {histData.map(row => (
                      <div key={row[periodKey]} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '100px', textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {row[periodKey]}
                        </div>
                        <div style={{ flex: 1, display: 'flex', height: '26px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-tertiary, #1e293b)' }}>
                          {activeMods.map(m => {
                            const val = row.modules?.[m] || 0;
                            if (val === 0) return null;
                            return (
                              <div key={m} style={{
                                width: `${(val / maxTotal) * 100}%`, minWidth: val > 0 ? '16px' : 0,
                                background: modColors[m], display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.65rem', color: '#fff', fontWeight: 600,
                              }} title={`${m}: ${val} executions`}>
                                {val >= 20 ? val : ''}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ width: '50px', textAlign: 'right', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {row.total}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Table view below */}
                  <div className="qcq-table-container" style={{ marginTop: '16px' }}>
                    <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                      <thead>
                        <tr>
                          <th>{historyView === 'weekly' ? 'Week' : 'Month'}</th>
                          {activeMods.map(m => (
                            <th key={m} style={{ textAlign: 'center', fontSize: '0.7rem' }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: modColors[m], marginRight: 3 }} />
                              {m.length > 15 ? m.slice(0, 14) + '..' : m}
                            </th>
                          ))}
                          <th style={{ textAlign: 'center', fontWeight: 700 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {histData.map(row => (
                          <tr key={row[periodKey]} className="qcq-row">
                            <td style={{ fontWeight: 600 }}>{row[periodKey]}</td>
                            {activeMods.map(m => {
                              const val = row.modules?.[m] || 0;
                              return (
                                <td key={m} style={{ textAlign: 'center', color: val > 0 ? 'var(--accent-teal)' : 'var(--text-muted)', fontWeight: val > 0 ? 600 : 400 }}>
                                  {val || '-'}
                                </td>
                              );
                            })}
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{row.total}</td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="qcq-row" style={{ background: 'var(--bg-tertiary)' }}>
                          <td style={{ fontWeight: 700 }}>TOTAL</td>
                          {activeMods.map(m => {
                            const total = histData.reduce((s, r) => s + (r.modules?.[m] || 0), 0);
                            return <td key={m} style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-teal)' }}>{total}</td>;
                          })}
                          <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-teal)' }}>
                            {histData.reduce((s, r) => s + r.total, 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Per-Member Weekly Activity Tab */}
        {activeTab.startsWith('member_') && memberWeekly && !loadingMember && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">{memberWeekly.person} — Weekly Activity</h2>

            {/* Performance overview */}
            <div className="qcq-status-cards" style={{ marginBottom: '16px' }}>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-teal)' }}>
                <div className="qcq-card-value">{memberWeekly.total_scripted}</div>
                <div className="qcq-card-label">Total Scripted</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
                <div className="qcq-card-value">{memberWeekly.total_executed}</div>
                <div className="qcq-card-label">Total Executed</div>
              </div>
              <div className="qcq-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
                <div className="qcq-card-value">{memberWeekly.weeks?.length || 0}</div>
                <div className="qcq-card-label">Active Weeks</div>
              </div>
            </div>

            {/* Weekly effort tracker table */}
            <div className="qcq-table-container">
              <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: '140px' }}>Week</th>
                    <th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th>
                    <th style={{ background: 'rgba(20,184,166,0.2)' }}>Scripted</th>
                    <th>Cumulative</th>
                    <th style={{ minWidth: '200px' }}>Notes / Breakdown</th>
                    <th style={{ background: 'rgba(59,130,246,0.2)' }}>Executed</th>
                  </tr>
                </thead>
                <tbody>
                  {(memberWeekly.weeks || []).map((w, idx) => {
                    const isCurrentWeek = w.week.includes(new Date().toISOString().split('T')[0]);
                    return (
                      <tr key={w.week} className="qcq-row" style={isCurrentWeek ? { background: 'rgba(20,184,166,0.08)', borderLeft: '3px solid var(--accent-teal)' } : {}}>
                        <td style={{ fontWeight: 600, fontSize: '0.72rem' }}>
                          {w.week.split(' - ')[0]}
                          {isCurrentWeek && <span style={{ color: 'var(--accent-teal)', fontSize: '0.65rem', display: 'block' }}>CURRENT</span>}
                        </td>
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => {
                          const dd = w.days?.[day] || {};
                          const scripted = dd.scripted || 0;
                          const executed = dd.executed || 0;
                          const hasActivity = scripted > 0 || executed > 0;
                          return (
                            <td key={day} style={{ textAlign: 'center', padding: '4px', minWidth: '50px' }}
                              title={dd.notes || ''}>
                              {hasActivity ? (
                                <div>
                                  {scripted > 0 && <div style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>{scripted}</div>}
                                  {executed > 0 && <div style={{ color: 'var(--accent-blue)', fontSize: '0.7rem' }}>E:{executed}</div>}
                                </div>
                              ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center', fontWeight: 700, color: w.scripted > 0 ? 'var(--accent-teal)' : 'var(--text-muted)' }}>
                          {w.scripted || '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{w.cumulative}</td>
                        <td style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '250px' }}>
                          {w.module_breakdown || '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: w.executed > 0 ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
                          {w.executed || '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Grand total row */}
                  <tr className="qcq-row" style={{ background: 'var(--bg-tertiary)' }}>
                    <td style={{ fontWeight: 700 }}>GRAND TOTAL</td>
                    <td colSpan={5}></td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-teal)' }}>{memberWeekly.total_scripted}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{memberWeekly.total_scripted}</td>
                    <td></td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-blue)' }}>{memberWeekly.total_executed}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab.startsWith('member_') && loadingMember && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
        )}

        {/* Combined Team Weekly Effort */}
        {teamData?.members && (
          <div className="qcq-section">
            <h2 className="qcq-section-title">
              Team Weekly Effort (Combined)
              <button className="btn btn-sm btn-secondary" onClick={() => setShowManualEntry(!showManualEntry)} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>
                {showManualEntry ? 'Cancel' : '+ Log Entry'}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={async () => { await fetch(`${API_BASE}/live/automation-team/sync-git`, { method: 'POST' }); fetchData(); }} style={{ marginLeft: '6px', fontSize: '0.72rem' }}>
                Sync Git
              </button>
            </h2>

            {/* Manual entry form */}
            {showManualEntry && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <select value={manualForm.person} onChange={e => setManualForm(p => ({ ...p, person: e.target.value }))} className="qcq-search-input" style={{ width: '150px' }}>
                  <option value="">Select Person</option>
                  {(teamData.members || []).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                <input type="date" value={manualForm.date} onChange={e => setManualForm(p => ({ ...p, date: e.target.value }))} className="qcq-search-input" style={{ width: '140px' }} />
                <input type="text" placeholder="Module" value={manualForm.module} onChange={e => setManualForm(p => ({ ...p, module: e.target.value }))} className="qcq-search-input" style={{ width: '150px' }} />
                <select value={manualForm.activity} onChange={e => setManualForm(p => ({ ...p, activity: e.target.value }))} className="qcq-search-input" style={{ width: '120px' }}>
                  <option value="scripting">Scripting</option>
                  <option value="execution">Execution</option>
                </select>
                <input type="number" placeholder="Cases Scripted" value={manualForm.cases_scripted} onChange={e => setManualForm(p => ({ ...p, cases_scripted: parseInt(e.target.value) || 0 }))} className="qcq-search-input" style={{ width: '120px' }} />
                <input type="number" placeholder="Cases Executed" value={manualForm.cases_executed} onChange={e => setManualForm(p => ({ ...p, cases_executed: parseInt(e.target.value) || 0 }))} className="qcq-search-input" style={{ width: '120px' }} />
                <input type="text" placeholder="Notes" value={manualForm.notes} onChange={e => setManualForm(p => ({ ...p, notes: e.target.value }))} className="qcq-search-input" style={{ width: '180px' }} />
                <button className="btn btn-sm btn-primary" onClick={submitManualEntry} disabled={!manualForm.person || !manualForm.date}>Save</button>
              </div>
            )}

            {/* Combined weekly effort table — all members' scripting + execution */}
            {(() => {
              // Merge all members' weekly trends
              const allWeeks = {};
              (teamData.members || []).forEach(m => {
                (m.weekly_trend || []).forEach(w => {
                  if (!allWeeks[w.week]) allWeeks[w.week] = { scripted: 0, executed: 0, members: {} };
                  allWeeks[w.week].scripted += w.scripted;
                  allWeeks[w.week].executed += w.executed;
                  if (w.scripted > 0 || w.executed > 0) {
                    allWeeks[w.week].members[m.name] = { scripted: w.scripted, executed: w.executed };
                  }
                });
              });
              const weeks = Object.entries(allWeeks).sort(([a],[b]) => a.localeCompare(b));
              let cumScripted = 0, cumExecuted = 0;

              return (
                <div className="qcq-table-container">
                  {/* Summary row */}
                  <div style={{display:'flex',gap:'16px',marginBottom:'12px'}}>
                    {(teamData.members || []).map(m => (
                      <div key={m.name} style={{display:'flex',gap:'8px',alignItems:'center',fontSize:'0.78rem'}}>
                        <span style={{fontWeight:700}}>{m.name.split(' ')[0]}:</span>
                        <span style={{color:'var(--accent-teal)'}}>{m.total_scripted} scripted</span>
                        <span style={{color:'var(--accent-blue)'}}>{m.total_executed} executed</span>
                      </div>
                    ))}
                  </div>
                  <table className="qcq-table" style={{fontSize:'0.78rem'}}>
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th style={{textAlign:'center',background:'rgba(20,184,166,0.12)'}}>Scripted</th>
                        <th style={{textAlign:'center'}}>Cumulative</th>
                        <th style={{textAlign:'center',background:'rgba(59,130,246,0.12)'}}>Executed</th>
                        <th style={{textAlign:'center'}}>Cum. Exec</th>
                        <th>Contributors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map(([wk, d]) => {
                        cumScripted += d.scripted;
                        cumExecuted += d.executed;
                        const contributors = Object.entries(d.members).map(([n, v]) => {
                          const parts = [];
                          if (v.scripted) parts.push(`${v.scripted}s`);
                          if (v.executed) parts.push(`${v.executed}e`);
                          return `${n.split(' ')[0]}: ${parts.join('+')}`;
                        }).join(', ');
                        return (
                          <tr key={wk} className="qcq-row">
                            <td style={{fontWeight:600,fontSize:'0.72rem'}}>{wk}</td>
                            <td style={{textAlign:'center',fontWeight:700,color: d.scripted > 0 ? 'var(--accent-teal)' : 'var(--text-muted)'}}>{d.scripted || '-'}</td>
                            <td style={{textAlign:'center'}}>{cumScripted}</td>
                            <td style={{textAlign:'center',fontWeight:600,color: d.executed > 0 ? 'var(--accent-blue)' : 'var(--text-muted)'}}>{d.executed || '-'}</td>
                            <td style={{textAlign:'center'}}>{cumExecuted}</td>
                            <td style={{fontSize:'0.7rem',color:'var(--text-secondary)'}}>{contributors || '-'}</td>
                          </tr>
                        );
                      })}
                      <tr className="qcq-row" style={{background:'var(--bg-tertiary)'}}>
                        <td style={{fontWeight:700}}>TOTAL</td>
                        <td style={{textAlign:'center',fontWeight:700,color:'var(--accent-teal)'}}>{cumScripted}</td>
                        <td></td>
                        <td style={{textAlign:'center',fontWeight:700,color:'var(--accent-blue)'}}>{cumExecuted}</td>
                        <td></td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}
      </main>
    </div>
  );
}
