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
