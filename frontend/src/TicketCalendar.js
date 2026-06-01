import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './api';
import AppSidebar from './AppSidebar';
import './dashboard.css';

const PM_TICKET_URL = 'https://www.bissafety.app/pm/tickets#!/';

const STATUS_COLORS = {
  'In Progress': '#f59e0b', 'Hold/Pending': '#f59e0b',
  'Start Code Review': '#60a5fa', 'Code Review Failed': '#ef4444', 'Express Lane Review': '#60a5fa',
  'Code Review Passed': '#2dd4bf',
  'QC Testing': '#22c55e', 'QC Testing in Progress': '#a78bfa', 'QC Testing Hold': '#f59e0b',
  'QC Review Fail': '#ef4444',
  'BIS Testing': '#f472b6', 'Approved for Live': '#34d399', 'Moved to Live': '#34d399',
  'Closed': '#64748b',
};

const RELEVANT_STATUSES = [
  'Code Review Passed', 'QC Testing', 'QC Testing in Progress', 'QC Testing Hold',
  'QC Review Fail', 'BIS Testing', 'Approved for Live', 'Moved to Live', 'Closed',
];

const MOVE_CARDS = [
  { key: 'new_to_qc', label: 'New to QC Testing', color: 'var(--accent-blue)' },
  { key: 'refix_to_qc', label: 'Refix to QC Testing', color: 'var(--accent-red)' },
  { key: 'to_bis', label: 'Delivered to BIS', color: 'var(--accent-purple, #8b5cf6)' },
  { key: 'approved_for_live', label: 'Approved for Live', color: 'var(--accent-teal)' },
  { key: 'closed', label: 'Closed', color: 'var(--accent-green)' },
];

function TicketMovementSection({ year, month }) {
  const [mv, setMv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState('closed');
  const [modFilter, setModFilter] = useState('');
  const [qcFilter, setQcFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    const now = new Date();
    const offset = (now.getFullYear() * 12 + now.getMonth()) - (year * 12 + (month - 1));
    if (offset < 0) { setMv(null); setLoading(false); return; }
    setLoading(true);
    fetch(`${API_BASE}/ticket-movement?offset=${offset}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMv(d))
      .finally(() => setLoading(false));
  }, [year, month]);

  if (loading) return <div style={{ padding: '12px', color: 'var(--text-muted)' }}>Loading ticket movement…</div>;
  if (!mv) return null;

  const card = mv[sel] || { count: 0, tickets: [] };
  const modules = [...new Set((card.tickets || []).map(t => t.module))].sort();
  const testers = [...new Set((card.tickets || []).map(t => t.qc_tester))].sort();
  let rows = (card.tickets || []).filter(t =>
    (!modFilter || t.module === modFilter) &&
    (!qcFilter || t.qc_tester === qcFilter) &&
    (!search || String(t.ticket_id).includes(search) || (t.title || '').toLowerCase().includes(search.toLowerCase()))
  );
  rows = [...rows].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'ticket_id' || sortKey === 'refix_count') { av = Number(av) || 0; bv = Number(bv) || 0; }
    else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const toggleSort = (k) => { if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir('asc'); } };
  const Th = ({ k, children, left }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', textAlign: left ? 'left' : 'center' }}>
      {children}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const isRefix = sel === 'refix_to_qc';

  const exportExcel = () => {
    const headers = ['Ticket', 'Title', 'Module', 'Priority', 'QC Tester', ...(isRefix ? ['Refix Count'] : []), 'Date'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    rows.forEach(t => {
      const r = [t.ticket_id, t.title, t.module, t.priority, t.qc_tester, ...(isRefix ? [t.refix_count] : []), (t.date || '').slice(0, 10)];
      lines.push(r.map(esc).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-movement_${sel}_${(mv.period?.label || '').replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="qcq-section" style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <h2 className="qcq-section-title" style={{ margin: 0 }}>Monthly Ticket Movement — {mv.period?.label}</h2>
        <span className={`emp-period-badge ${mv.period?.frozen ? 'emp-final' : 'emp-live'}`}>{mv.period?.frozen ? 'Final' : 'Live'}</span>
      </div>

      <div className="qcq-status-cards" style={{ marginBottom: '14px' }}>
        {MOVE_CARDS.map(c => (
          <div key={c.key} onClick={() => { setSel(c.key); setModFilter(''); setQcFilter(''); setSearch(''); setSortKey('date'); setSortDir('desc'); }}
            className="qcq-card" style={{ cursor: 'pointer', borderTop: `3px solid ${c.color}`, outline: sel === c.key ? `2px solid ${c.color}` : 'none' }}>
            <div className="qcq-card-value" style={{ color: c.color }}>{(mv[c.key] || {}).count || 0}</div>
            <div className="qcq-card-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="qcq-search-input" placeholder="Search ticket / title…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: '180px' }} />
        <select className="qcq-search-input" value={modFilter} onChange={e => setModFilter(e.target.value)}>
          <option value="">All modules</option>{modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="qcq-search-input" value={qcFilter} onChange={e => setQcFilter(e.target.value)}>
          <option value="">All QC testers</option>{testers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{rows.length} of {card.count}</span>
        <button className="btn btn-sm btn-primary" onClick={exportExcel} disabled={rows.length === 0}
          style={{ marginLeft: 'auto' }}>Export to Excel</button>
      </div>

      <div className="qcq-table-container">
        <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
          <thead><tr>
            <Th k="ticket_id">Ticket</Th>
            <th style={{ textAlign: 'left' }}>Title</th>
            <Th k="module">Module</Th>
            <Th k="priority">Priority</Th>
            <Th k="qc_tester">QC Tester</Th>
            {isRefix && <Th k="refix_count">Refix #</Th>}
            <Th k="date">Date</Th>
          </tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={`${t.ticket_id}-${t.date}`} className="qcq-row">
                <td style={{ textAlign: 'center' }}><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                <td style={{ maxWidth: '280px', whiteSpace: 'normal', textAlign: 'left' }}>{t.title}</td>
                <td style={{ textAlign: 'center' }}>{t.module}</td>
                <td style={{ textAlign: 'center' }}>{t.priority}</td>
                <td style={{ textAlign: 'center' }}>{t.qc_tester}</td>
                {isRefix && <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-red)' }}>{t.refix_count}x</td>}
                <td style={{ textAlign: 'center' }}>{(t.date || '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p style={{ color: 'var(--text-muted)', padding: '8px' }}>No tickets.</p>}
    </div>
  );
}

export default function TicketCalendar() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/live/ticket-calendar`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="dashboard">
        <AppSidebar />
        <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
          <div className="loading-container"><div className="loading-spinner"></div><p>Loading Calendar...</p></div>
        </main>
      </div>
    );
  }

  const calendar = data?.calendar || [];
  const [year, month] = currentMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startPad = (firstDay.getDay() + 6) % 7; // Monday = 0
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Build day map
  const dayMap = {};
  calendar.forEach(d => { dayMap[d.date] = d; });

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDay(null); setSelectedStatus(null);
  };
  const nextMonth = () => {
    const d = new Date(year, month, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDay(null); setSelectedStatus(null);
  };

  // Get tickets for selected day/status
  const getSelectedTickets = () => {
    if (!selectedDay) return [];
    const dayData = dayMap[selectedDay];
    if (!dayData) return [];
    if (selectedStatus) {
      return dayData.statuses?.[selectedStatus]?.tickets || [];
    }
    // All tickets for the day
    return Object.values(dayData.statuses || {}).flatMap(s => s.tickets || []);
  };

  const selectedTickets = getSelectedTickets();

  // Month totals
  const monthDays = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    monthDays.push(dateStr);
  }
  const monthTotal = monthDays.reduce((s, d) => s + (dayMap[d]?.total || 0), 0);

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content" style={{ marginLeft: 'var(--sidebar-width)' }}>
        <header className="content-header">
          <div className="header-left">
            <h1>Ticket Movement Calendar</h1>
            <p className="header-subtitle">Daily ticket status transitions — click any day to see details</p>
          </div>
        </header>

        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
          <button className="btn btn-sm btn-secondary" onClick={prevMonth}>&lt; Prev</button>
          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{monthNames[month - 1]} {year}</span>
          <button className="btn btn-sm btn-secondary" onClick={nextMonth}>Next &gt;</button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '12px' }}>{monthTotal} ticket movements this month</span>
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '16px' }}>
          {/* Day headers */}
          {dayNames.map(d => (
            <div key={d} style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px' }}>{d}</div>
          ))}

          {/* Padding */}
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} style={{ background: 'var(--bg-secondary)', borderRadius: '6px', minHeight: '90px', opacity: 0.3 }} />
          ))}

          {/* Days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayData = dayMap[dateStr];
            const total = dayData?.total || 0;
            const isToday = dateStr === new Date().toISOString().split('T')[0];
            const isSelected = selectedDay === dateStr;
            const isWeekend = ((startPad + i) % 7) >= 5;

            // Get relevant status counts
            const statusCounts = {};
            if (dayData) {
              Object.entries(dayData.statuses || {}).forEach(([s, v]) => {
                if (RELEVANT_STATUSES.includes(s)) statusCounts[s] = v.count;
              });
            }

            return (
              <div key={day} onClick={() => { setSelectedDay(isSelected ? null : dateStr); setSelectedStatus(null); }}
                style={{
                  background: isSelected ? 'rgba(20,184,166,0.15)' : isWeekend ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                  border: isSelected ? '2px solid var(--accent-teal)' : isToday ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                  borderRadius: '8px', minHeight: '90px', padding: '6px', cursor: 'pointer',
                  transition: 'all 0.2s', opacity: isWeekend && total === 0 ? 0.4 : 1,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent-teal)' : 'var(--text-primary)' }}>{day}</span>
                  {total > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: total >= 20 ? 'var(--accent-red)' : total >= 10 ? 'var(--accent-amber)' : 'var(--accent-green)' }}>{total}</span>}
                </div>
                {/* Mini status bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {RELEVANT_STATUSES.filter(s => statusCounts[s]).map(s => (
                    <div key={s} onClick={(e) => { e.stopPropagation(); setSelectedDay(dateStr); setSelectedStatus(selectedDay === dateStr && selectedStatus === s ? null : s); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLORS[s] || '#64748b', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.55rem', color: STATUS_COLORS[s] || 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {statusCounts[s]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.7rem' }}>
          {RELEVANT_STATUSES.map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] || '#64748b' }} />
              {s}
            </span>
          ))}
        </div>

        {/* Monthly ticket movement cards + lists (below the calendar) */}
        <TicketMovementSection year={year} month={month} />

        {/* Selected day detail */}
        {selectedDay && (
          <div className="qcq-section" style={{ border: '1px solid var(--accent-teal)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{selectedDay}</span>
              <span style={{ color: 'var(--text-muted)' }}>({selectedTickets.length} tickets{selectedStatus ? ` in ${selectedStatus}` : ''})</span>

              {/* Status filter badges */}
              {dayMap[selectedDay] && Object.entries(dayMap[selectedDay].statuses || {}).filter(([s]) => RELEVANT_STATUSES.includes(s)).map(([s, v]) => (
                <span key={s} onClick={() => setSelectedStatus(selectedStatus === s ? null : s)}
                  style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                    background: selectedStatus === s ? (STATUS_COLORS[s] || '#64748b') : `${STATUS_COLORS[s] || '#64748b'}15`,
                    color: selectedStatus === s ? '#fff' : (STATUS_COLORS[s] || '#64748b'),
                    border: `1px solid ${STATUS_COLORS[s] || '#64748b'}` }}>
                  {s}: {v.count}
                </span>
              ))}
              <button className="btn btn-sm btn-secondary" onClick={() => { setSelectedDay(null); setSelectedStatus(null); }} style={{ marginLeft: 'auto' }}>Close</button>
            </div>

            {selectedTickets.length > 0 ? (
              <div className="qcq-table-container">
                <table className="qcq-table" style={{ fontSize: '0.78rem' }}>
                  <thead>
                    <tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Module</th><th>Developer</th><th>QC Tester</th></tr>
                  </thead>
                  <tbody>
                    {selectedTickets.map(t => (
                      <tr key={t.ticket_id} className="qcq-row">
                        <td style={{ textAlign: 'center' }}><a href={`${PM_TICKET_URL}${t.ticket_id}`} target="_blank" rel="noreferrer" className="qcq-ticket-link">#{t.ticket_id}</a></td>
                        <td style={{ maxWidth: '250px', wordBreak: 'break-word', whiteSpace: 'normal', textAlign: 'left' }}>{t.title}</td>
                        <td style={{ textAlign: 'center' }}><span className="qcq-status-badge" style={{ background: `${STATUS_COLORS[t.status] || '#64748b'}20`, color: STATUS_COLORS[t.status] || '#64748b' }}>{t.status}</span></td>
                        <td style={{ textAlign: 'center' }}>{t.priority}</td>
                        <td style={{ textAlign: 'center' }}>{t.module || '-'}</td>
                        <td style={{ textAlign: 'center', fontSize: '0.72rem' }}>{t.developers_str || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{t.qc_tester || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p style={{ color: 'var(--text-muted)' }}>No ticket movements on this day</p>}
          </div>
        )}
      </main>
    </div>
  );
}
