import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './QATaskPlanning.css';
import './ETACalendar.css';

const CATEGORY_ORDER = ['overdue', 'due-soon', 'on-track', 'completed'];

const CATEGORY_META = {
  overdue: { label: 'Overdue', color: '#ff4d4f' },
  'due-soon': { label: 'Due Soon (<=3 days)', color: '#f7b500' },
  'on-track': { label: 'On Track', color: '#22c55e' },
  completed: { label: 'Completed', color: '#3b82f6' },
};

const COMPLETED_STATUS_KEYWORDS = ['complete', 'completed', 'closed', 'done', 'resolved', 'moved to live'];

const PRIORITY_COLORS = {
  URGENT: '#dc2626',
  'High (Bugs)': '#ea580c',
  'High (Billable)': '#f97316',
  'EPIC!': '#d97706',
  'Medium (Bugs)': '#eab308',
  'High Level 1': '#f59e0b',
  'High Level 2': '#fbbf24',
  'High Level 3': '#facc15',
  'High Level 4': '#eab308',
  'Medium': '#22c55e',
  'Low': '#3b82f6',
  'Quote': '#8b5cf6',
  'Suggestion': '#94a3b8',
  'Unspecified': '#6b7280',
};

function parseDateOnly(dateLike) {
  if (!dateLike) return null;
  const part = String(dateLike).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return null;
  const [y, m, d] = part.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateKey(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

function isCompletedStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return COMPLETED_STATUS_KEYWORDS.some((k) => normalized.includes(k));
}

function getTicketCategory(ticket, todayDate) {
  if (isCompletedStatus(ticket.status)) return 'completed';
  const etaDate = parseDateOnly(ticket.eta);
  if (!etaDate) return 'on-track';
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((etaDate.getTime() - todayDate.getTime()) / dayMs);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 3) return 'due-soon';
  return 'on-track';
}

function ETACalendar() {
  const { user } = useAuth();
  const [overviewData, setOverviewData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [etaCalendarMonth, setEtaCalendarMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);

  const loadOverviewData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/qa-planning/overview');
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.detail || msg;
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setOverviewData(data);
    } catch (e) {
      setError(e.message || 'Failed to load ETA calendar data');
      setOverviewData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverviewData();
  }, [loadOverviewData]);

  const monthContext = useMemo(() => {
    const [year, month] = etaCalendarMonth.slice(0, 7).split('-').map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    return { year, month, monthStart, monthEnd };
  }, [etaCalendarMonth]);

  const processed = useMemo(() => {
    const queue = Array.isArray(overviewData?.queue) ? overviewData.queue : [];
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monthKey = `${monthContext.year}-${String(monthContext.month).padStart(2, '0')}`;

    const monthTickets = queue
      .filter((t) => t?.eta && String(t.eta).slice(0, 7) === monthKey)
      .map((t) => ({
        ...t,
        _category: getTicketCategory(t, todayDate),
        _etaDate: parseDateOnly(t.eta),
      }));

    const categoryTotals = CATEGORY_ORDER.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    const ticketsByDate = {};

    monthTickets.forEach((ticket) => {
      const dateKey = String(ticket.eta).slice(0, 10);
      categoryTotals[ticket._category] += 1;
      ticketsByDate[dateKey] = ticketsByDate[dateKey] || [];
      ticketsByDate[dateKey].push(ticket);
    });

    Object.keys(ticketsByDate).forEach((dateKey) => {
      ticketsByDate[dateKey].sort((a, b) => {
        const byCategory = CATEGORY_ORDER.indexOf(a._category) - CATEGORY_ORDER.indexOf(b._category);
        if (byCategory !== 0) return byCategory;
        const aId = Number(a.ticket_id) || 0;
        const bId = Number(b.ticket_id) || 0;
        return bId - aId;
      });
    });

    const upcomingDeadlines = monthTickets
      .filter((t) => t._category !== 'completed')
      .sort((a, b) => (a._etaDate?.getTime() || 0) - (b._etaDate?.getTime() || 0))
      .slice(0, 8);

    return { ticketsByDate, categoryTotals, upcomingDeadlines };
  }, [overviewData, monthContext.year, monthContext.month]);

  const calendarCells = useMemo(() => {
    const firstDay = monthContext.monthStart.getDay();
    const daysInMonth = monthContext.monthEnd.getDate();
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    const cells = [];

    for (let i = 0; i < firstDay; i += 1) {
      cells.push({ day: null, dateKey: null, isCurrentMonth: false, count: 0, categoryCounts: {} });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateObj = new Date(monthContext.year, monthContext.month - 1, day);
      const dateKey = toDateKey(dateObj);
      const tickets = processed.ticketsByDate[dateKey] || [];
      const categoryCounts = CATEGORY_ORDER.reduce((acc, key) => {
        acc[key] = tickets.filter((t) => t._category === key).length;
        return acc;
      }, {});
      cells.push({
        day,
        dateKey,
        isCurrentMonth: true,
        count: tickets.length,
        categoryCounts,
      });
    }

    while (cells.length < totalCells) {
      cells.push({ day: null, dateKey: null, isCurrentMonth: false, count: 0, categoryCounts: {} });
    }

    return cells;
  }, [monthContext, processed.ticketsByDate]);

  const selectedTickets = useMemo(() => {
    if (!selectedDate) return [];
    return processed.ticketsByDate[selectedDate] || [];
  }, [processed.ticketsByDate, selectedDate]);

  const selectedCategoryCounts = useMemo(() => {
    const result = CATEGORY_ORDER.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    selectedTickets.forEach((t) => {
      result[t._category] += 1;
    });
    return result;
  }, [selectedTickets]);

  const orderedSelectedTickets = useMemo(() => {
    if (!selectedTicketId) return selectedTickets;
    const focused = selectedTickets.find((t) => String(t.ticket_id) === String(selectedTicketId));
    if (!focused) return selectedTickets;
    return [focused, ...selectedTickets.filter((t) => String(t.ticket_id) !== String(selectedTicketId))];
  }, [selectedTicketId, selectedTickets]);

  const monthLabel = useMemo(
    () => monthContext.monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [monthContext.monthStart]
  );

  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    const d = parseDateOnly(selectedDate);
    return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : selectedDate;
  }, [selectedDate]);

  const changeMonth = (delta) => {
    const [y, m] = etaCalendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setEtaCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setSelectedDate(null);
    setSelectedTicketId(null);
  };

  const handleCalendarDateSelect = (dateKey) => {
    if (!dateKey) return;
    setSelectedDate(dateKey);
    setSelectedTicketId(null);
  };

  const handleUpcomingTicketSelect = (ticket) => {
    if (!ticket) return;
    const ticketDate = String(ticket.eta || '').slice(0, 10);
    if (ticketDate) setSelectedDate(ticketDate);
    setSelectedTicketId(ticket.ticket_id);
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
        <div className="home-eta-page">
          <header className="home-eta-topbar">
            <div>
              <h1 className="home-eta-title">Deliverables ETA Calendar</h1>
              <p className="home-eta-subtitle">{user?.team ? `${user.team} Team` : 'Engineering Team'}</p>
            </div>
            <div className="home-eta-legend">
              {CATEGORY_ORDER.map((key) => (
                <span key={key} className="home-eta-legend-item">
                  <span className="home-eta-dot" style={{ backgroundColor: CATEGORY_META[key].color }} />
                  {CATEGORY_META[key].label}
                </span>
              ))}
            </div>
          </header>

          {error && <div className="qa-planning-error">{error}</div>}

          {loading ? (
            <div className="qa-planning-skeleton">Loading deliverables...</div>
          ) : !overviewData ? (
            <div className="qa-planning-empty">
              <p>Failed to load deliverables.</p>
              <button type="button" className="btn-secondary" onClick={loadOverviewData}>Retry</button>
            </div>
          ) : (
            <>
              <section className="home-eta-summary-grid">
                {CATEGORY_ORDER.map((key) => (
                  <article key={key} className={`home-eta-summary-card category-${key}`}>
                    <div className="home-eta-summary-accent" style={{ backgroundColor: CATEGORY_META[key].color }} />
                    <div className="home-eta-summary-content">
                      <div className="home-eta-summary-value">{processed.categoryTotals[key]}</div>
                      <div className="home-eta-summary-label">{CATEGORY_META[key].label}</div>
                    </div>
                  </article>
                ))}
              </section>

              <section className="home-eta-main-grid">
                <div className="home-eta-calendar-panel">
                  <div className="home-eta-calendar-header">
                    <button type="button" className="home-eta-nav-btn" onClick={() => changeMonth(-1)}>{'<'}</button>
                    <h2>{monthLabel}</h2>
                    <button type="button" className="home-eta-nav-btn" onClick={() => changeMonth(1)}>{'>'}</button>
                  </div>

                  <div className="home-eta-weekdays">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                      <span key={w}>{w}</span>
                    ))}
                  </div>

                  <div className="home-eta-cells-grid">
                    {calendarCells.map((cell, idx) => {
                      const isSelected = selectedDate && cell.dateKey === selectedDate;
                      const dominantCategory = CATEGORY_ORDER.find((k) => (cell.categoryCounts[k] || 0) > 0);
                      return (
                        <button
                          key={`${cell.dateKey || 'empty'}-${idx}`}
                          type="button"
                          className={`home-eta-cell ${cell.isCurrentMonth ? '' : 'is-outside'} ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => handleCalendarDateSelect(cell.dateKey)}
                          disabled={!cell.dateKey}
                          style={{ '--cell-accent': dominantCategory ? CATEGORY_META[dominantCategory].color : '#334155' }}
                        >
                          {cell.dateKey && (
                            <>
                              <span className="home-eta-cell-day">{cell.day}</span>
                              {cell.count > 0 ? (
                                <>
                                  <span className="home-eta-cell-count">{cell.count}</span>
                                  <span className="home-eta-cell-label">deliverables</span>
                                </>
                              ) : (
                                <span className="home-eta-cell-empty">No deliverables</span>
                              )}
                              <span className="home-eta-mini-marks">
                                {CATEGORY_ORDER.map((key) => (
                                  <span
                                    key={key}
                                    className="home-eta-mini-mark"
                                    style={{ backgroundColor: CATEGORY_META[key].color, opacity: cell.categoryCounts[key] ? 1 : 0.2 }}
                                    title={`${CATEGORY_META[key].label}: ${cell.categoryCounts[key] || 0}`}
                                  >
                                    {cell.categoryCounts[key] || 0}
                                  </span>
                                ))}
                              </span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="home-eta-side-column">
                  <section className="home-eta-side-panel">
                    <div className="home-eta-side-header">
                      <h3>{selectedDate ? selectedDateLabel : 'Select a Date'}</h3>
                      <p>{selectedDate ? `${selectedTickets.length} deliverables` : 'Click on a date to see deliverables'}</p>
                    </div>

                    {!selectedDate ? (
                      <div className="home-eta-empty-state">No date selected</div>
                    ) : selectedTickets.length === 0 ? (
                      <div className="home-eta-empty-state">No deliverables on this date.</div>
                    ) : (
                      <>
                        <div className="home-eta-selected-category-row">
                          {CATEGORY_ORDER.map((key) => (
                            <span key={key} className={`home-eta-category-pill category-${key}`}>
                              {CATEGORY_META[key].label}: {selectedCategoryCounts[key]}
                            </span>
                          ))}
                        </div>

                        <div className="home-eta-ticket-list">
                          {orderedSelectedTickets.map((ticket) => {
                            const category = ticket._category;
                            const isFocused = selectedTicketId && String(ticket.ticket_id) === String(selectedTicketId);
                            return (
                              <article key={ticket.ticket_id} className={`home-eta-ticket-card category-${category} ${isFocused ? 'is-focused-ticket' : ''}`}>
                                <div className="home-eta-ticket-top">
                                  <span className="home-eta-ticket-id">
                                    <Link to={`/tickets?ticket=${ticket.ticket_id}`}>
                                      #{ticket.ticket_id}
                                    </Link>
                                  </span>
                                  <span className={`home-eta-category-pill category-${category}`}>{CATEGORY_META[category].label}</span>
                                </div>

                                <div className="home-eta-ticket-title" title={ticket.title || ''}>{ticket.title || 'Untitled ticket'}</div>

                                <div className="home-eta-ticket-meta-grid">
                                  <span><strong>Priority:</strong> <em style={{ color: PRIORITY_COLORS[ticket.priority] || '#cbd5e1' }}>{ticket.priority || 'Unspecified'}</em></span>
                                  <span><strong>Status:</strong> {ticket.status || '-'}</span>
                                  <span><strong>Tester:</strong> {ticket.qc_tester || '-'}</span>
                                  <span><strong>Developer(s):</strong> {ticket.developers_str || '-'}</span>
                                  <span><strong>Fail Count:</strong> {ticket.times_moved_to_fail ?? 0}</span>
                                  <span><strong>Open Bugs:</strong> {ticket.open_bugs_count ?? 0}</span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </section>

                  <section className="home-eta-side-panel">
                    <div className="home-eta-side-header">
                      <h3>Upcoming Deadlines</h3>
                      <p>Nearest pending deliverables in this month</p>
                    </div>

                    {processed.upcomingDeadlines.length === 0 ? (
                      <div className="home-eta-empty-state">No upcoming deadlines for this month.</div>
                    ) : (
                      <div className="home-eta-upcoming-list">
                        {processed.upcomingDeadlines.map((ticket) => (
                          <div
                            key={`up-${ticket.ticket_id}`}
                            className={`home-eta-upcoming-item category-${ticket._category}`}
                            onClick={() => handleUpcomingTicketSelect(ticket)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleUpcomingTicketSelect(ticket);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            title="Click to view ticket details"
                          >
                            <div>
                              <div className="home-eta-upcoming-title">{ticket.title || `Ticket #${ticket.ticket_id}`}</div>
                              <div className="home-eta-upcoming-sub">
                                <Link to={`/tickets?ticket=${ticket.ticket_id}`}>#{ticket.ticket_id}</Link>
                              </div>
                            </div>
                            <div className="home-eta-upcoming-right">
                              <span className="home-eta-upcoming-status" title={ticket.status || 'No status'}>
                                {ticket.status || 'No status'}
                              </span>
                              <span className={`home-eta-category-pill category-${ticket._category}`}>{CATEGORY_META[ticket._category].label}</span>
                              <span className="home-eta-upcoming-date">{String(ticket.eta).slice(0, 10)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default ETACalendar;
