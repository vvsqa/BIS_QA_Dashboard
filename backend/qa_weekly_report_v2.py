"""
Professional QA Weekly Report Generator V2

Generates a comprehensive, multi-page PDF report for stakeholders and clients.
Includes: QA queue details (pending tickets with priority), new tickets to QC testing,
moved to BIS testing (new), put on hold this week, tickets QA failed this week
(with times tested/failed). Timesheet is not included in this report.

Pages:
1. Cover Page
2. QA Overview Dashboard (with queue, newly to QC, BIS moved, on hold, failed)
3. Newly Released to QA
4. Weekly Comparison
5. BIS Testing Summary
5+. Individual Ticket Details (BIS Testing)
Final. Upcoming QA Plan

Usage:
    python qa_weekly_report_v2.py                    # Current week
    python qa_weekly_report_v2.py --date 2026-01-20  # Specific week
    python qa_weekly_report_v2.py --project "Client Name"
"""

import os
import sys
import argparse
from datetime import datetime, timedelta, date
from collections import defaultdict

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, 
    PageBreak, Image, KeepTogether, Flowable
)
from reportlab.platypus.flowables import HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics import renderPDF

from sqlalchemy import func, and_, or_
from database import SessionLocal
from models import Bug, TicketTracking, TestResult, TestCase, TestRun, TicketStatusHistory, TicketPriorityHistory

# ============================================================================
# CONFIGURATION
# ============================================================================

REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "techversant-logo.png")

# Color Palette - Professional & Modern (consistent, high contrast for text)
COLORS = {
    'primary': colors.HexColor('#1e40af'),      # Deep blue - for headers with white text
    'secondary': colors.HexColor('#475569'),    # Slate - for headers with white text
    'success': colors.HexColor('#15803d'),      # Green - for headers with white text
    'warning': colors.HexColor('#b45309'),      # Amber - for headers with white text
    'danger': colors.HexColor('#b91c1c'),       # Red - for headers with white text
    'info': colors.HexColor('#0e7490'),         # Cyan - for headers with white text
    'purple': colors.HexColor('#6d28d9'),       # Purple - for headers with white text
    'dark': colors.HexColor('#0f172a'),         # Near black for text
    'light': colors.HexColor('#f8fafc'),        # Off-white
    'border': colors.HexColor('#cbd5e1'),       # Border
    'muted': colors.HexColor('#64748b'),        # Muted text
    # Light background colors - USE WITH DARK TEXT, NOT for headers with white text
    'bg_green': colors.HexColor('#dcfce7'),
    'bg_red': colors.HexColor('#fee2e2'),
    'bg_yellow': colors.HexColor('#fef3c7'),
    'bg_blue': colors.HexColor('#dbeafe'),
    'bg_purple': colors.HexColor('#f3e8ff'),
    'bg_cyan': colors.HexColor('#cffafe'),
    # Header-safe colors (darker versions for tables with white text)
    'header_cyan': colors.HexColor('#0891b2'),   # Dark cyan for headers
    'header_green': colors.HexColor('#059669'),  # Dark green for headers
    'header_blue': colors.HexColor('#2563eb'),   # Dark blue for headers
}
# Usable width on A4 with 0.65" margins (8.27 - 1.3 = 6.97 inch)
PAGE_WIDTH_INCH = 8.27
TABLE_MAX_WIDTH = PAGE_WIDTH_INCH - 1.3

# Status Categories
# ================
# QA Team owned statuses - tickets pending with QA team
# Dev team moves tickets TO these statuses, QA team works on them
QA_TEAM_STATUSES = [
    'QC Testing',           # Initial state when received from Dev
    'QC Testing in Progress',  # QA actively testing
    'QC Testing Hold'       # On hold for some reason
]

# BIS-QA Team (Client Team) statuses - QA team moves tickets TO these statuses
# This represents QA team's ACHIEVEMENT - successfully tested and handed over
BIS_TESTING_STATUSES = [
    'BIS Testing',          # Handed to BIS-QA/client team
    'BIS Testing (Pre)', 
    'BIS Testing (Prod)', 
    'Testing In Progress',  # BIS-QA team working
    'UAT', 
    'User Acceptance Testing'
]

# All QA-related statuses (for backward compatibility)
QA_OWNED_STATUSES = QA_TEAM_STATUSES + BIS_TESTING_STATUSES

# Closed statuses
CLOSED_STATUSES = ['Closed', 'Done', 'Completed', 'Resolved', 'Moved to Live']

# Development statuses
IN_PROGRESS_STATUSES = ['In Progress', 'Development', 'In Development', 'Code Review', 'Start Code Review']

# ============================================================================
# DATA COLLECTION
# ============================================================================

def get_week_dates(reference_date=None, use_last_7_days=False):
    """
    Get date range for the report.
    
    Args:
        reference_date: If provided, use this date as reference
        use_last_7_days: If True, return last 7 days from today (or reference_date)
                         If False, return Monday-Friday of the week
    """
    if reference_date is None:
        reference_date = datetime.now()
    elif isinstance(reference_date, str):
        reference_date = datetime.strptime(reference_date, "%Y-%m-%d")
    
    if use_last_7_days:
        # Last 7 days: from 7 days ago to today
        week_end = reference_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        week_start = (reference_date - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        # Traditional Monday-Friday week
        monday = reference_date - timedelta(days=reference_date.weekday())
        friday = monday + timedelta(days=4)
        
        week_start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
        week_end = friday.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    return week_start, week_end


def get_comprehensive_data(week_start, week_end):
    """Fetch all data needed for the comprehensive report"""
    db = SessionLocal()
    
    try:
        # Previous week dates for comparison
        prev_week_start = week_start - timedelta(days=7)
        prev_week_end = week_end - timedelta(days=7)
        
        # Next week dates for planning
        next_week_start = week_end + timedelta(days=3)
        next_week_end = next_week_start + timedelta(days=4)
        
        data = {
            'week_start': week_start,
            'week_end': week_end,
            'prev_week_start': prev_week_start,
            'prev_week_end': prev_week_end,
            'generation_time': datetime.now(),
            
            # Current week data
            'current_week': {
                'qa_tickets': [],           # All tickets pending with QA team
                'qc_testing_newly_added': [],  # Newly added to QC Testing from dev this period
                'bis_testing_moved': [],    # QA Achievement: moved to BIS Testing this period
                'closed_moved': [],         # Tickets closed this period (QA responsible)
                'in_progress': [],          # Dev in progress (for reference)
            },
            
            # QA Team Pending Breakdown (by each QA status)
            'qa_pending_breakdown': {
                'QC Testing': 0,
                'QC Testing in Progress': 0,
                'QC Testing Hold': 0,
            },
            
            # Previous week data for comparison
            'previous_week': {
                'qa_tickets_count': 0,
                'bis_testing_count': 0,
                'closed_count': 0,
            },
            
            # Breakdowns (for all QA tickets)
            'breakdowns': {
                'by_module': defaultdict(int),
                'by_feature': defaultdict(int),
                'by_environment': defaultdict(int),
                'by_priority': defaultdict(int),
                'by_status': defaultdict(int),
            },
            
            # Breakdowns for BIS Testing moved tickets (QA achievement)
            'bis_breakdowns': {
                'by_module': defaultdict(int),
                'by_feature': defaultdict(int),
            },
            # Breakdowns for newly added to QC Testing (from dev)
            'qc_newly_added_breakdowns': {
                'by_priority': defaultdict(int),
                'by_status': defaultdict(int),
            },
            # Priority changes this period (for report section)
            'priority_changes': [],
            # Tickets put on hold this week (moved to QC Testing Hold during period)
            'on_hold_this_week': [],
            # Tickets QA failed this week (moved to QC Review Fail / Tested - Awaiting Fixes / Code Review Failed) with times in fail
            'qa_failed_this_week': [],
            
            # Next week plan
            'next_week_plan': [],
            
            # Aggregated metrics
            'metrics': {
                'total_qa_tickets': 0,
                'total_bugs': 0,
                'bugs_open': 0,
                'bugs_fixed': 0,
                'bugs_deferred': 0,
                'total_test_cases': 0,
                'tests_passed': 0,
                'tests_failed': 0,
                'tests_blocked': 0,
            }
        }
        
        # ===== CURRENT: All QA Team owned tickets (pending with QA) =====
        # Use case-insensitive status match so API variations (e.g. "QC testing") are included
        qa_status_conditions = or_(
            *[func.lower(TicketTracking.status) == s.lower() for s in QA_TEAM_STATUSES]
        )
        all_qa_tickets = db.query(TicketTracking).filter(
            TicketTracking.status.isnot(None),
            qa_status_conditions
        ).all()
        
        for ticket in all_qa_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket)
            data['current_week']['qa_tickets'].append(ticket_data)
            
            # Update QA pending breakdown by status (match case-insensitively)
            status = ticket.status
            status_key = next((s for s in QA_TEAM_STATUSES if status and s.lower() == status.strip().lower()), status)
            if status_key in data['qa_pending_breakdown']:
                data['qa_pending_breakdown'][status_key] += 1
            
            # Update breakdowns
            update_breakdowns(data['breakdowns'], ticket_data)
        
        # ===== CURRENT PERIOD: Tickets moved to BIS Testing =====
        # Try to use status history first (more accurate), fallback to updated_on
        bis_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(BIS_TESTING_STATUSES),
            TicketStatusHistory.changed_on >= week_start,
            TicketStatusHistory.changed_on <= week_end
        ).all()
        
        if bis_history:
            # Use status history (accurate)
            bis_ticket_ids = list(set(h.ticket_id for h in bis_history))
            bis_testing_tickets = db.query(TicketTracking).filter(
                TicketTracking.ticket_id.in_(bis_ticket_ids)
            ).all()
        else:
            # Fallback to updated_on (less accurate but works before history is populated)
            bis_testing_tickets = db.query(TicketTracking).filter(
                TicketTracking.status.in_(BIS_TESTING_STATUSES),
                TicketTracking.updated_on >= week_start,
                TicketTracking.updated_on <= week_end
            ).order_by(TicketTracking.updated_on.desc()).all()
        
        for ticket in bis_testing_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=True)
            # Add moved_on date from history if available
            for h in bis_history:
                if h.ticket_id == ticket.ticket_id:
                    ticket_data['moved_to_bis_on'] = h.changed_on
                    ticket_data['moved_from_status'] = h.previous_status
                    break
            data['current_week']['bis_testing_moved'].append(ticket_data)
            
            # Update BIS testing breakdowns (for module-wise and feature-wise distribution)
            if ticket_data['module'] != 'N/A':
                data['bis_breakdowns']['by_module'][ticket_data['module']] += 1
            if ticket_data['feature'] != 'N/A':
                data['bis_breakdowns']['by_feature'][ticket_data['feature']] += 1
        
        # ===== CURRENT PERIOD: Tickets newly added to QC Testing (from development team) =====
        qc_newly_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(QA_TEAM_STATUSES),
            TicketStatusHistory.changed_on >= week_start,
            TicketStatusHistory.changed_on <= week_end
        ).all()
        if qc_newly_history:
            qc_newly_ids = list(set(h.ticket_id for h in qc_newly_history))
            qc_newly_tickets = db.query(TicketTracking).filter(
                TicketTracking.ticket_id.in_(qc_newly_ids)
            ).all()
            for ticket in qc_newly_tickets:
                ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=False)
                for h in qc_newly_history:
                    if h.ticket_id == ticket.ticket_id:
                        ticket_data['moved_to_qc_on'] = h.changed_on
                        ticket_data['moved_from_status'] = h.previous_status
                        break
                data['current_week']['qc_testing_newly_added'].append(ticket_data)
                data['qc_newly_added_breakdowns']['by_priority'][ticket_data['priority']] += 1
                data['qc_newly_added_breakdowns']['by_status'][ticket_data['status']] += 1
        else:
            # Fallback when status history is empty: show tickets currently in QC with updated_on in period
            qa_status_conditions = or_(
                *[func.lower(TicketTracking.status) == s.lower() for s in QA_TEAM_STATUSES]
            )
            qc_newly_fallback = db.query(TicketTracking).filter(
                TicketTracking.status.isnot(None),
                qa_status_conditions,
                TicketTracking.updated_on.isnot(None),
                TicketTracking.updated_on >= week_start,
                TicketTracking.updated_on <= week_end
            ).order_by(TicketTracking.updated_on.desc()).all()
            for ticket in qc_newly_fallback:
                ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=False)
                ticket_data['moved_to_qc_on'] = ticket.updated_on
                ticket_data['moved_from_status'] = None
                ticket_data['_fallback_by_updated'] = True
                data['current_week']['qc_testing_newly_added'].append(ticket_data)
                data['qc_newly_added_breakdowns']['by_priority'][ticket_data['priority']] += 1
                data['qc_newly_added_breakdowns']['by_status'][ticket_data['status']] += 1
        
        # ===== CURRENT PERIOD: Priority changes (any ticket) =====
        priority_history = db.query(TicketPriorityHistory).filter(
            TicketPriorityHistory.changed_on >= week_start,
            TicketPriorityHistory.changed_on <= week_end
        ).order_by(TicketPriorityHistory.changed_on.desc()).all()
        for ph in priority_history:
            ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == ph.ticket_id).first()
            title = (ticket.title or f"Ticket #{ph.ticket_id}")[:50] if ticket else f"Ticket #{ph.ticket_id}"
            data['priority_changes'].append({
                'ticket_id': ph.ticket_id,
                'title': title,
                'previous_priority': ph.previous_priority or '—',
                'new_priority': ph.new_priority or '—',
                'changed_on': ph.changed_on,
            })
        
        # ===== CURRENT PERIOD: Tickets put on hold (moved to QC Testing Hold) =====
        from models import QATaskHoldHistory
        
        on_hold_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status == 'QC Testing Hold',
            TicketStatusHistory.changed_on >= week_start,
            TicketStatusHistory.changed_on <= week_end
        ).all()
        if on_hold_history:
            on_hold_ids = list(set(h.ticket_id for h in on_hold_history))
            for tid in on_hold_ids:
                ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == tid).first()
                if ticket:
                    ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=False)
                    for h in on_hold_history:
                        if h.ticket_id == tid:
                            ticket_data['put_on_hold_on'] = h.changed_on
                            ticket_data['put_on_hold_from'] = h.previous_status
                            break
                    
                    # Try to get hold reason from QATaskHoldHistory (if hold was made via Task Planning)
                    hold_reason_record = db.query(QATaskHoldHistory).filter(
                        QATaskHoldHistory.ticket_id == tid,
                        QATaskHoldHistory.hold_started_at >= week_start,
                        QATaskHoldHistory.hold_started_at <= week_end,
                    ).order_by(QATaskHoldHistory.hold_started_at.desc()).first()
                    
                    if hold_reason_record:
                        ticket_data['hold_reason'] = hold_reason_record.hold_reason
                        ticket_data['hold_type'] = hold_reason_record.hold_type
                        ticket_data['hold_created_by'] = hold_reason_record.created_by
                    else:
                        ticket_data['hold_reason'] = None
                        ticket_data['hold_type'] = None
                        ticket_data['hold_created_by'] = None
                    
                    data['on_hold_this_week'].append(ticket_data)
        
        # ===== CURRENT PERIOD: Tickets QA failed (moved to QC Review Fail / Tested - Awaiting Fixes / Code Review Failed) =====
        from qa_planning import get_qc_fail_count, QC_FAIL_STATUSES
        qa_fail_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(QC_FAIL_STATUSES),
            TicketStatusHistory.changed_on >= week_start,
            TicketStatusHistory.changed_on <= week_end
        ).all()
        if qa_fail_history:
            qa_fail_ids = list(set(h.ticket_id for h in qa_fail_history))
            for tid in qa_fail_ids:
                ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == tid).first()
                if ticket:
                    ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=False)
                    ticket_data['times_tested_and_failed'] = get_qc_fail_count(db, tid)
                    data['qa_failed_this_week'].append(ticket_data)
        
        # ===== CURRENT PERIOD: Tickets moved to Closed (QA team responsible only) =====
        # Use status history for accuracy
        closed_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(CLOSED_STATUSES),
            TicketStatusHistory.changed_on >= week_start,
            TicketStatusHistory.changed_on <= week_end
        ).all()
        
        if closed_history:
            closed_ticket_ids = list(set(h.ticket_id for h in closed_history))
            closed_tickets = db.query(TicketTracking).filter(
                TicketTracking.ticket_id.in_(closed_ticket_ids)
            ).all()
        else:
            closed_tickets = db.query(TicketTracking).filter(
                TicketTracking.status.in_(CLOSED_STATUSES),
                TicketTracking.updated_on >= week_start,
                TicketTracking.updated_on <= week_end
            ).order_by(TicketTracking.updated_on.desc()).all()
        
        for ticket in closed_tickets:
            # Only include tickets where QA team was responsible (has QC tester assigned)
            if ticket.qc_tester:
                ticket_data = get_enriched_ticket_data(db, ticket, include_full_details=False)
                data['current_week']['closed_moved'].append(ticket_data)
        
        # ===== CURRENT WEEK: In Progress tickets =====
        in_progress_tickets = db.query(TicketTracking).filter(
            TicketTracking.status.in_(IN_PROGRESS_STATUSES)
        ).all()
        
        for ticket in in_progress_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket)
            data['current_week']['in_progress'].append(ticket_data)
        
        # ===== PREVIOUS PERIOD: Counts for comparison =====
        # Use status history if available for more accurate counts
        prev_bis_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(BIS_TESTING_STATUSES),
            TicketStatusHistory.changed_on >= prev_week_start,
            TicketStatusHistory.changed_on <= prev_week_end
        ).all()
        
        prev_closed_history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(CLOSED_STATUSES),
            TicketStatusHistory.changed_on >= prev_week_start,
            TicketStatusHistory.changed_on <= prev_week_end
        ).all()
        
        # Current QA count (snapshot)
        prev_qa_count = db.query(TicketTracking).filter(
            TicketTracking.status.in_(QA_TEAM_STATUSES)
        ).count()
        
        # Use history count if available, otherwise fallback
        if prev_bis_history:
            prev_bis_count = len(set(h.ticket_id for h in prev_bis_history))
        else:
            prev_bis_count = db.query(TicketTracking).filter(
                TicketTracking.status.in_(BIS_TESTING_STATUSES),
                TicketTracking.updated_on >= prev_week_start,
                TicketTracking.updated_on <= prev_week_end
            ).count()
        
        if prev_closed_history:
            prev_closed_count = len(set(h.ticket_id for h in prev_closed_history))
        else:
            prev_closed_count = db.query(TicketTracking).filter(
                TicketTracking.status.in_(CLOSED_STATUSES),
                TicketTracking.updated_on >= prev_week_start,
                TicketTracking.updated_on <= prev_week_end
            ).count()
        
        data['previous_week']['qa_tickets_count'] = prev_qa_count
        data['previous_week']['bis_testing_count'] = prev_bis_count
        data['previous_week']['closed_count'] = prev_closed_count
        
        # Previous week: newly moved to QC (incoming)
        prev_qc_newly = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status.in_(QA_TEAM_STATUSES),
            TicketStatusHistory.changed_on >= prev_week_start,
            TicketStatusHistory.changed_on <= prev_week_end
        ).all()
        data['previous_week']['qc_newly_count'] = len(set(h.ticket_id for h in prev_qc_newly))
        
        # ===== NEXT WEEK: Planned tickets =====
        planned_tickets = db.query(TicketTracking).filter(
            TicketTracking.eta >= next_week_start,
            TicketTracking.eta <= next_week_end,
            ~TicketTracking.status.in_(CLOSED_STATUSES)
        ).order_by(TicketTracking.eta.asc()).all()
        
        for ticket in planned_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket)
            data['next_week_plan'].append(ticket_data)
        
        # Next week ETA calendar: group by date for report widget
        next_week_eta_calendar = []
        if data['next_week_plan']:
            from collections import defaultdict as _dd
            by_date = _dd(list)
            for t in data['next_week_plan']:
                eta = t.get('eta')
                if eta:
                    d = eta.strftime('%Y-%m-%d') if hasattr(eta, 'strftime') else (eta[:10] if isinstance(eta, str) else None)
                    if d:
                        by_date[d].append(t)
            for d in sorted(by_date.keys()):
                next_week_eta_calendar.append({'date': d, 'tickets': by_date[d]})
        data['next_week_eta_calendar'] = next_week_eta_calendar
        
        # Tickets QA was working on this (report) week: union of all touched tickets
        seen_ids = set()
        tickets_worked = []
        for lst in [
            data['current_week']['qa_tickets'],
            data['current_week']['qc_testing_newly_added'],
            data['current_week']['bis_testing_moved'],
            data['current_week']['closed_moved'],
            data['on_hold_this_week'],
            data['qa_failed_this_week'],
        ]:
            for t in lst:
                tid = t.get('ticket_id')
                if tid and tid not in seen_ids:
                    seen_ids.add(tid)
                    tickets_worked.append(t)
        data['tickets_worked_on_this_week'] = tickets_worked
        
        # Variance: incoming vs outgoing vs last week
        this_incoming = len(data['current_week'].get('qc_testing_newly_added', []))
        this_outgoing = len(data['current_week']['bis_testing_moved']) + len(data['current_week']['closed_moved'])
        last_incoming = data['previous_week'].get('qc_newly_count', 0)
        last_outgoing = data['previous_week']['bis_testing_count'] + data['previous_week']['closed_count']
        data['variance'] = {
            'this_week_incoming': this_incoming,
            'this_week_outgoing': this_outgoing,
            'last_week_incoming': last_incoming,
            'last_week_outgoing': last_outgoing,
            'incoming_change': this_incoming - last_incoming,
            'outgoing_change': this_outgoing - last_outgoing,
        }
        
        # ===== AGGREGATE METRICS =====
        data['metrics']['total_qa_tickets'] = len(data['current_week']['qa_tickets'])
        
        # QA pending at start of report week (from date): current pending - newly added + moved out this week
        total_pending_now = len(data['current_week']['qa_tickets'])
        newly_added_count = len(data['current_week'].get('qc_testing_newly_added', []))
        moved_to_bis_count = len(data['current_week']['bis_testing_moved'])
        closed_count = len(data['current_week']['closed_moved'])
        data['at_start_qa_pending'] = total_pending_now - newly_added_count + moved_to_bis_count + closed_count
        
        # Aggregate from all ticket data
        for ticket_list in [data['current_week']['bis_testing_moved'], 
                           data['current_week']['closed_moved'],
                           data['current_week']['in_progress']]:
            for t in ticket_list:
                data['metrics']['total_bugs'] += t.get('bugs_total', 0)
                data['metrics']['bugs_open'] += t.get('bugs_open', 0)
                data['metrics']['bugs_fixed'] += t.get('bugs_closed', 0)
                data['metrics']['bugs_deferred'] += t.get('bugs_deferred', 0)
                data['metrics']['total_test_cases'] += t.get('tests_total', 0)
                data['metrics']['tests_passed'] += t.get('tests_passed', 0)
                data['metrics']['tests_failed'] += t.get('tests_failed', 0)
                data['metrics']['tests_blocked'] += t.get('tests_blocked', 0)
        
        return data
        
    finally:
        db.close()


def get_enriched_ticket_data(db, ticket, include_full_details=False):
    """Get comprehensive data for a single ticket"""
    ticket_id = ticket.ticket_id
    
    # Get bugs from Redmine
    bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id).all()
    
    bugs_open = []
    bugs_closed = []
    bugs_deferred = []
    severity_counts = defaultdict(int)
    environment_counts = defaultdict(int)
    
    for bug in bugs:
        status_lower = (bug.status or '').lower()
        if status_lower in ['closed', 'resolved', 'verified', 'fixed']:
            bugs_closed.append(bug)
        elif status_lower in ['deferred', 'wont fix', 'duplicate']:
            bugs_deferred.append(bug)
        else:
            bugs_open.append(bug)
        
        severity_counts[bug.severity or 'Unknown'] += 1
        environment_counts[bug.environment or 'Unknown'] += 1
    
    # Get test results
    test_results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
    tests_passed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'passed'])
    tests_failed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'failed'])
    tests_blocked = len([t for t in test_results if t.status_name and t.status_name.lower() == 'blocked'])
    tests_untested = len([t for t in test_results if t.status_name and t.status_name.lower() == 'untested'])
    
    # Get ticket title from PM API (TicketTracking), else first bug
    ticket_title = (getattr(ticket, 'title', None) or '').strip()
    if not ticket_title and bugs:
        first_bug = bugs[0]
        if first_bug.subject:
            parts = first_bug.subject.split(" - ")
            ticket_title = parts[0] if parts else first_bug.subject
    if not ticket_title:
        ticket_title = f"Ticket #{ticket_id}"

    ticket_priority = (getattr(ticket, 'priority', None) or '').strip() or 'Not Set'

    # Ageing: created_on -> closed_on or today
    created_dt = getattr(ticket, 'created_on', None)
    closed_dt = getattr(ticket, 'closed_on', None)
    created_date = created_dt.date() if created_dt and hasattr(created_dt, 'date') else (created_dt if isinstance(created_dt, date) else None)
    closed_date = closed_dt.date() if closed_dt and hasattr(closed_dt, 'date') else (closed_dt if isinstance(closed_dt, date) else None)
    is_closed = (ticket.status or '').lower() in ['closed', 'moved to live', 'completed']
    ageing_days = None
    days_to_close = None
    if created_date:
        if is_closed and closed_date:
            ageing_days = (closed_date - created_date).days
            days_to_close = ageing_days
        else:
            today = date.today()
            ageing_days = (today - created_date).days
    priority_changes_count = db.query(func.count(TicketPriorityHistory.id)).filter(
        TicketPriorityHistory.ticket_id == ticket_id
    ).scalar() or 0

    # Get module and feature from bugs
    module = None
    feature = None
    if bugs:
        module = bugs[0].module
        feature = bugs[0].feature
    
    # Team members
    developers = []
    if ticket.backend_developer:
        developers.append(ticket.backend_developer)
    if ticket.frontend_developer:
        developers.append(ticket.frontend_developer)
    developers = list(set(developers))
    
    result = {
        'ticket_id': ticket_id,
        'title': ticket_title,
        'priority': ticket_priority,
        'status': ticket.status or 'Unknown',
        'eta': ticket.eta,
        'eta_str': ticket.eta.strftime('%Y-%m-%d') if ticket.eta else 'Not Set',
        'module': module or 'N/A',
        'feature': feature or 'N/A',
        'developers': developers,
        'developers_str': ', '.join(developers) if developers else 'Not Assigned',
        'qa_tester': ticket.qc_tester or 'Not Assigned',
        'current_assignee': ticket.current_assignee or 'Unassigned',
        'dev_estimate': ticket.dev_estimate_hours or 0,
        'dev_actual': ticket.actual_dev_hours or 0,
        'qa_estimate': ticket.qa_estimate_hours or 0,
        'qa_actual': ticket.actual_qa_hours or 0,
        'updated_on': ticket.updated_on,
        'created_on': ticket.created_on.strftime('%Y-%m-%d %H:%M') if getattr(ticket, 'created_on', None) else None,
        'closed_on': ticket.closed_on.strftime('%Y-%m-%d %H:%M') if getattr(ticket, 'closed_on', None) else None,
        'ageing_days': ageing_days,
        'days_to_close': days_to_close,
        'priority_changes_count': priority_changes_count,
        
        # Bug metrics
        'bugs_total': len(bugs),
        'bugs_open': len(bugs_open),
        'bugs_closed': len(bugs_closed),
        'bugs_deferred': len(bugs_deferred),
        'bugs_by_severity': dict(severity_counts),
        'bugs_by_environment': dict(environment_counts),
        
        # Test metrics
        'tests_total': len(test_results),
        'tests_passed': tests_passed,
        'tests_failed': tests_failed,
        'tests_blocked': tests_blocked,
        'tests_untested': tests_untested,
        'pass_rate': round((tests_passed / len(test_results) * 100), 1) if test_results else 0,
    }
    
    # Include full bug and test details for detailed pages
    if include_full_details:
        result['bug_details'] = [{
            'id': b.bug_id,
            'subject': b.subject or 'No Subject',
            'status': b.status or 'Unknown',
            'severity': b.severity or 'Unknown',
            'priority': b.priority or 'Unknown',
            'environment': b.environment or 'Unknown',
            'assignee': b.assignee or 'Unassigned',
            'created_on': b.created_on.strftime('%Y-%m-%d') if b.created_on else 'Unknown'
        } for b in bugs[:15]]  # Limit to 15 bugs
        
        result['test_details'] = [{
            'case_id': t.case_id,
            'status': t.status_name or 'Unknown',
            'assigned_to': t.assigned_to or 'Unassigned'
        } for t in test_results[:20]]  # Limit to 20 tests
    
    return result


def update_breakdowns(breakdowns, ticket_data):
    """Update breakdown counts"""
    breakdowns['by_status'][ticket_data['status']] += 1
    if ticket_data['module'] != 'N/A':
        breakdowns['by_module'][ticket_data['module']] += 1
    if ticket_data['feature'] != 'N/A':
        breakdowns['by_feature'][ticket_data['feature']] += 1


# ============================================================================
# PDF STYLES
# ============================================================================

def create_professional_styles():
    """Create professional, enterprise-grade styles with clear hierarchy and spacing"""
    styles = getSampleStyleSheet()
    
    # Cover page styles
    styles.add(ParagraphStyle(
        name='CoverTitle',
        parent=styles['Heading1'],
        fontSize=32,
        spaceAfter=12,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold',
        leading=38
    ))
    
    styles.add(ParagraphStyle(
        name='CoverSubtitle',
        parent=styles['Normal'],
        fontSize=15,
        alignment=TA_CENTER,
        textColor=COLORS['secondary'],
        spaceAfter=24,
        leading=18
    ))
    
    styles.add(ParagraphStyle(
        name='CoverDate',
        parent=styles['Normal'],
        fontSize=13,
        alignment=TA_CENTER,
        textColor=COLORS['primary'],
        fontName='Helvetica-Bold',
        spaceBefore=16,
        spaceAfter=8
    ))
    
    # Section styles - clear hierarchy, no overlap
    styles.add(ParagraphStyle(
        name='SectionHeader',
        parent=styles['Heading1'],
        fontSize=16,
        spaceBefore=20,
        spaceAfter=12,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold',
        borderPadding=6,
        leading=20
    ))
    
    styles.add(ParagraphStyle(
        name='SubSectionHeader',
        parent=styles['Heading2'],
        fontSize=12,
        spaceBefore=12,
        spaceAfter=6,
        textColor=COLORS['primary'],
        fontName='Helvetica-Bold',
        leading=14
    ))
    
    styles.add(ParagraphStyle(
        name='CardTitle',
        parent=styles['Heading3'],
        fontSize=10,
        spaceBefore=4,
        spaceAfter=2,
        textColor=COLORS['secondary'],
        leading=12
    ))
    
    # Metric styles
    styles.add(ParagraphStyle(
        name='MetricLarge',
        parent=styles['Normal'],
        fontSize=28,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold',
        leading=32
    ))
    
    styles.add(ParagraphStyle(
        name='MetricMedium',
        parent=styles['Normal'],
        fontSize=22,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold',
        leading=26
    ))
    
    styles.add(ParagraphStyle(
        name='MetricLabel',
        parent=styles['Normal'],
        fontSize=8,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        leading=10
    ))
    
    styles.add(ParagraphStyle(
        name='MetricSmall',
        parent=styles['Normal'],
        fontSize=10,
        alignment=TA_CENTER,
        textColor=COLORS['secondary'],
        leading=12
    ))
    
    # Body text styles
    styles.add(ParagraphStyle(
        name='ReportBody',
        parent=styles['Normal'],
        fontSize=9,
        textColor=COLORS['dark'],
        leading=12,
        spaceAfter=4
    ))
    
    styles.add(ParagraphStyle(
        name='SmallText',
        parent=styles['Normal'],
        fontSize=7,
        textColor=COLORS['muted'],
        leading=9
    ))
    
    styles.add(ParagraphStyle(
        name='FooterText',
        parent=styles['Normal'],
        fontSize=7,
        alignment=TA_CENTER,
        textColor=COLORS['muted']
    ))
    
    # Trend indicators
    styles.add(ParagraphStyle(
        name='TrendUp',
        parent=styles['Normal'],
        fontSize=9,
        textColor=COLORS['success'],
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='TrendDown',
        parent=styles['Normal'],
        fontSize=9,
        textColor=COLORS['danger'],
        fontName='Helvetica-Bold'
    ))
    
    return styles


# ============================================================================
# TABLE STYLE HELPERS
# ============================================================================

def get_base_table_style(header_bg_color=None):
    """Return base TableStyle list for consistent padding, alignment, borders."""
    header_bg = header_bg_color or COLORS['primary']
    return [
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('BACKGROUND', (0, 0), (-1, 0), header_bg),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
    ]


# ============================================================================
# CHART GENERATORS
# ============================================================================

# Chart color palette (professional, distinct)
CHART_COLORS = [
    colors.HexColor('#1e40af'),  # Blue
    colors.HexColor('#15803d'),  # Green
    colors.HexColor('#b91c1c'),  # Red
    colors.HexColor('#b45309'),  # Amber
    colors.HexColor('#6d28d9'),  # Purple
    colors.HexColor('#0e7490'),  # Cyan
    colors.HexColor('#475569'),  # Slate
    colors.HexColor('#64748b'),  # Muted
]


def create_pie_chart(data_dict, title="", width=200, height=200):
    """Create a pie chart with title and legend; no overlapping."""
    if not data_dict or sum(data_dict.values()) == 0:
        return None
    
    drawing = Drawing(width, height)
    
    # Title at top (reserve space)
    title_height = 18
    legend_height = 32
    chart_area = height - title_height - legend_height
    pie_size = min(100, chart_area - 10)
    pie_x = (width - pie_size) // 2
    pie_y = legend_height + (chart_area - pie_size) // 2
    
    pie = Pie()
    pie.x = pie_x
    pie.y = pie_y
    pie.width = pie_size
    pie.height = pie_size
    
    labels = list(data_dict.keys())
    values = list(data_dict.values())
    pie.data = values
    pie.labels = [f"{l[:10]} ({v})" if len(l) > 10 else f"{l} ({v})" for l, v in zip(labels, values)]
    
    pie.slices.strokeWidth = 1
    pie.slices.strokeColor = colors.white
    for i in range(len(values)):
        pie.slices[i].fillColor = CHART_COLORS[i % len(CHART_COLORS)]
        pie.slices[i].popout = 0
    pie.sideLabels = False
    pie.simpleLabels = True
    pie.slices.fontName = 'Helvetica'
    pie.slices.fontSize = 7
    
    drawing.add(pie)
    
    # Title at top
    if title:
        drawing.add(String(width / 2, height - 12, title, textAnchor='middle',
                          fontName='Helvetica-Bold', fontSize=9, fillColor=COLORS['dark']))
    
    # Legend below pie
    legend_y = 8
    legend_x = 12
    for i, (label, value) in enumerate(zip(labels, values)):
        row, col = i // 3, i % 3
        x_pos = legend_x + col * (width / 3)
        y_pos = legend_y - row * 12
        if y_pos < 0:
            continue
        drawing.add(Rect(x_pos, y_pos, 8, 8, fillColor=CHART_COLORS[i % len(CHART_COLORS)], strokeColor=None))
        lbl = (label[:12] + '…') if len(label) > 12 else label
        drawing.add(String(x_pos + 11, y_pos + 1, f"{lbl}: {value}", fontName='Helvetica', fontSize=7, fillColor=COLORS['dark']))
    
    return drawing


def create_bar_chart(data_dict, title="", width=380, height=200, bar_color=None):
    """Create a vertical bar chart with title; no overlapping labels."""
    if not data_dict:
        return None
    
    drawing = Drawing(width, height)
    title_h, bottom_h, left_w, right_w = 22, 50, 55, 45
    chart_w = width - left_w - right_w
    chart_h = height - title_h - bottom_h
    
    chart = VerticalBarChart()
    chart.x = left_w
    chart.y = bottom_h
    chart.width = chart_w
    chart.height = chart_h
    
    labels = list(data_dict.keys())
    values = list(data_dict.values())
    chart.data = [values]
    chart.categoryAxis.categoryNames = [l[:14] + ('…' if len(l) > 14 else '') for l in labels]
    
    chart.bars[0].fillColor = bar_color or COLORS['primary']
    chart.bars[0].strokeColor = None
    chart.bars.strokeWidth = 0
    
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max(values) * 1.15 if values else 10
    chart.valueAxis.valueStep = max(1, max(values) // 5) if values else 2
    chart.valueAxis.labels.fontName = 'Helvetica'
    chart.valueAxis.labels.fontSize = 8
    chart.valueAxis.labels.fillColor = COLORS['dark']
    
    chart.categoryAxis.labels.fontName = 'Helvetica'
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.fillColor = COLORS['dark']
    chart.categoryAxis.labels.angle = 25
    chart.categoryAxis.labels.boxAnchor = 'ne'
    
    drawing.add(chart)
    if title:
        drawing.add(String(width / 2, height - 14, title, textAnchor='middle',
                          fontName='Helvetica-Bold', fontSize=9, fillColor=COLORS['dark']))
    return drawing


def create_comparison_bar_chart(prev_values, curr_values, labels, title="", width=400, height=200):
    """Create a grouped bar chart for comparison; title and legend don't overlap."""
    if not labels:
        return None
    
    drawing = Drawing(width, height)
    title_h, legend_h = 20, 28
    chart_x, chart_y = 65, legend_h
    chart_w = width - 115
    chart_h = height - title_h - legend_h - 10
    
    chart = VerticalBarChart()
    chart.x = chart_x
    chart.y = chart_y
    chart.width = chart_w
    chart.height = chart_h
    
    chart.data = [prev_values, curr_values]
    chart.categoryAxis.categoryNames = [l[:18] + ('…' if len(l) > 18 else '') for l in labels]
    
    chart.bars[0].fillColor = colors.HexColor('#94a3b8')
    chart.bars[1].fillColor = COLORS['primary']
    chart.bars.strokeWidth = 0
    
    max_val = max(max(prev_values) if prev_values else 0, max(curr_values) if curr_values else 0)
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max_val * 1.25 if max_val > 0 else 10
    chart.valueAxis.labels.fontName = 'Helvetica'
    chart.valueAxis.labels.fontSize = 8
    chart.valueAxis.labels.fillColor = COLORS['dark']
    chart.categoryAxis.labels.fontName = 'Helvetica'
    chart.categoryAxis.labels.fontSize = 8
    chart.categoryAxis.labels.fillColor = COLORS['dark']
    
    drawing.add(chart)
    if title:
        drawing.add(String(width / 2, height - 12, title, textAnchor='middle',
                          fontName='Helvetica-Bold', fontSize=9, fillColor=COLORS['dark']))
    legend_y = 8
    drawing.add(Rect(width - 115, legend_y, 10, 10, fillColor=colors.HexColor('#94a3b8'), strokeColor=None))
    drawing.add(String(width - 102, legend_y + 1, "Last Week", fontName='Helvetica', fontSize=8, fillColor=COLORS['dark']))
    drawing.add(Rect(width - 58, legend_y, 10, 10, fillColor=COLORS['primary'], strokeColor=None))
    drawing.add(String(width - 45, legend_y + 1, "This Week", fontName='Helvetica', fontSize=8, fillColor=COLORS['dark']))
    return drawing


def create_horizontal_progress_bar(value, max_value, label="", width=280, height=36, bar_color=None):
    """Create a horizontal progress bar; label and value don't overlap."""
    drawing = Drawing(width, height)
    bar_height = 18
    bar_y = (height - bar_height) // 2
    left_margin, right_margin = 55, 38
    
    drawing.add(Rect(left_margin, bar_y, width - left_margin - right_margin, bar_height,
                     fillColor=colors.HexColor('#e2e8f0'), strokeColor=COLORS['border'], strokeWidth=1))
    if max_value > 0:
        progress_width = (value / max_value) * (width - left_margin - right_margin)
        drawing.add(Rect(left_margin, bar_y, progress_width, bar_height,
                         fillColor=bar_color or COLORS['success'], strokeColor=None))
    if label:
        drawing.add(String(5, bar_y + 4, label[:25], fontName='Helvetica', fontSize=8, fillColor=COLORS['dark']))
    percentage = round((value / max_value * 100), 1) if max_value > 0 else 0
    drawing.add(String(width - 32, bar_y + 4, f"{percentage}%", fontName='Helvetica-Bold', fontSize=8, fillColor=COLORS['dark']))
    return drawing


# ============================================================================
# PAGE GENERATORS
# ============================================================================

def create_cover_page(data, styles, project_name=None):
    """Page 1: Professional Cover Page"""
    elements = []
    
    # Vertical spacing for balanced cover
    elements.append(Spacer(1, 1.2*inch))
    
    # Logo
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=2.8*inch, height=0.7*inch)
            logo.hAlign = 'CENTER'
            elements.append(logo)
            elements.append(Spacer(1, 0.6*inch))
        except Exception:
            pass
    
    # Main Title
    elements.append(Paragraph("QA Weekly Report", styles['CoverTitle']))
    elements.append(Spacer(1, 0.25*inch))
    
    # Decorative line
    elements.append(HRFlowable(width="50%", thickness=2, color=COLORS['primary'], hAlign='CENTER'))
    elements.append(Spacer(1, 0.4*inch))
    
    # Date range
    week_start = data['week_start'].strftime('%B %d, %Y')
    week_end = data['week_end'].strftime('%B %d, %Y')
    elements.append(Paragraph(f"{week_start} — {week_end}", styles['CoverDate']))
    elements.append(Spacer(1, 0.25*inch))
    
    # Project name if provided
    if project_name:
        elements.append(Paragraph(project_name, styles['CoverSubtitle']))
    
    # Generation info at bottom
    elements.append(Spacer(1, 1.8*inch))
    elements.append(HRFlowable(width="35%", thickness=1, color=COLORS['border'], hAlign='CENTER'))
    elements.append(Spacer(1, 0.15*inch))
    gen_time = data['generation_time'].strftime('%Y-%m-%d %H:%M')
    elements.append(Paragraph(f"Generated: {gen_time}", styles['SmallText']))
    elements.append(Paragraph("Confidential - For Internal Use Only", styles['SmallText']))
    
    elements.append(PageBreak())
    return elements


def create_overview_page(data, styles):
    """Page 2: QA Overview – At From Date → During Week → Pending as of Today"""
    elements = []
    
    current = data['current_week']
    metrics = data['metrics']
    qa_pending = data.get('qa_pending_breakdown', {})
    total_pending = len(current['qa_tickets'])
    from_date_str = data['week_start'].strftime('%Y-%m-%d')
    today_str = data['generation_time'].strftime('%Y-%m-%d')
    at_start = data.get('at_start_qa_pending', 0)
    qc_newly_count = len(current.get('qc_testing_newly_added', []))
    bis_moved_count = len(current['bis_testing_moved'])
    qc_newly_breakdowns = data.get('qc_newly_added_breakdowns', {})
    
    # Section Header
    elements.append(Paragraph("QA Team Overview", styles['SectionHeader']))
    elements.append(Paragraph(
        "<i>At start of week → During the week → Pending as of report generation date</i>",
        styles['SmallText']
    ))
    elements.append(Spacer(1, 0.25*inch))
    
    # ----- Block 1: At From Date (start of report week) -----
    elements.append(Paragraph("1. At Start of Report Week (From Date)", styles['SubSectionHeader']))
    elements.append(Paragraph(f"<b>Date:</b> {from_date_str}", styles['ReportBody']))
    at_start_cell = create_metric_cell(at_start, "QA Pending with QA", COLORS['bg_blue'], styles)
    at_start_table = Table([[at_start_cell]], colWidths=[2.5*inch])
    at_start_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 2, COLORS['primary']),
        ('BACKGROUND', (0, 0), (-1, -1), COLORS['light']),
    ]))
    elements.append(at_start_table)
    elements.append(Paragraph("<i>Count of tickets with QA at the start of the report period.</i>", styles['SmallText']))
    elements.append(Spacer(1, 0.2*inch))
    
    # ----- Block 2: During the week -----
    elements.append(Paragraph("2. During the Week", styles['SubSectionHeader']))
    during_cells = [
        create_metric_cell(bis_moved_count, "Moved to BIS Testing", COLORS['bg_green'], styles),
        create_metric_cell(qc_newly_count, "Newly Released to QC Testing (from Dev)", COLORS['bg_cyan'], styles),
    ]
    during_table = Table([during_cells], colWidths=[2.5*inch, 2.8*inch])
    during_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 2, COLORS['success']),
        ('BACKGROUND', (0, 0), (0, -1), COLORS['light']),
        ('BACKGROUND', (1, 0), (1, -1), COLORS['light']),
    ]))
    elements.append(during_table)
    if qc_newly_count and qc_newly_breakdowns.get('by_priority'):
        elements.append(Paragraph("<b>Newly released by priority:</b> ", styles['ReportBody']))
        pri_parts = [f"{p or '—'}: {c}" for p, c in sorted(qc_newly_breakdowns['by_priority'].items(), key=lambda x: x[1], reverse=True)[:8]]
        elements.append(Paragraph(", ".join(pri_parts), styles['ReportBody']))
    elements.append(Spacer(1, 0.2*inch))
    
    # ----- Block 3: As of Today (report generation date) -----
    elements.append(Paragraph("3. Pending as of Today (Report Generation Date)", styles['SubSectionHeader']))
    elements.append(Paragraph(f"<b>Date:</b> {today_str}", styles['ReportBody']))
    pending_now_cell = create_metric_cell(total_pending, "Total Pending with QA", COLORS['bg_blue'], styles)
    pending_now_table = Table([[pending_now_cell]], colWidths=[2.5*inch])
    pending_now_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 2, COLORS['primary']),
        ('BACKGROUND', (0, 0), (-1, -1), COLORS['light']),
    ]))
    elements.append(pending_now_table)
    elements.append(Paragraph("<b>Breakdown (QC Testing / In Progress / Hold):</b>", styles['ReportBody']))
    
    # QA Team Pending Breakdown by Status - Table and Pie Chart side by side
    elements.append(Spacer(1, 0.1*inch))
    
    pending_table_data = [['Status', 'Count', 'Percentage']]
    status_chart_data = {}
    for status in ['QC Testing', 'QC Testing in Progress', 'QC Testing Hold']:
        count = qa_pending.get(status, 0)
        pct = round((count / total_pending * 100), 1) if total_pending > 0 else 0
        pending_table_data.append([status, str(count), f"{pct}%"])
        if count > 0:
            status_chart_data[status.replace('QC Testing', 'QC').replace(' in Progress', ' Prog').replace(' Hold', ' Hold')] = count
    
    # Add total row
    pending_table_data.append(['Total Pending with QA', str(total_pending), '100%'])
    
    pending_table = Table(pending_table_data, colWidths=[2.6*inch, 0.9*inch, 1*inch])
    pending_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['primary']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -2), COLORS['dark']),
        ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_blue']),
        ('TEXTCOLOR', (0, -1), (-1, -1), COLORS['dark']),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    
    # Create pie chart for status breakdown (fits sidebar)
    status_pie = create_pie_chart(status_chart_data, "Status Distribution", width=200, height=200)
    
    # Combine table and chart side by side (fit within page width)
    if status_pie:
        combined_table = Table([[pending_table, status_pie]], colWidths=[3.8*inch, 2.75*inch])
        combined_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (1, 0), (1, -1), 8),
        ]))
        elements.append(combined_table)
    else:
        elements.append(pending_table)
    
    # QA Queue Details - Pending tickets with priority
    elements.append(Paragraph("<b>QA Queue – Pending tickets by priority</b>", styles['ReportBody']))
    qa_tickets = current.get('qa_tickets', [])
    if qa_tickets:
        priority_order = ['URGENT', 'High (Bugs)', 'High (Billable)', 'High', 'Medium', 'Low', 'Quote', 'Suggestion', 'Unspecified']
        def _pri_sort_key(t):
            p = (t.get('priority') or 'Unspecified').strip()
            try:
                return priority_order.index(p)
            except ValueError:
                return 99
        sorted_qa = sorted(qa_tickets, key=_pri_sort_key)
        queue_data = [['Ticket', 'Title', 'Priority', 'Status', 'QC Tester']]
        for t in sorted_qa[:40]:
            queue_data.append([
                f"#{t.get('ticket_id', '—')}",
                (t.get('title') or '—')[:32],
                (t.get('priority') or '—')[:14],
                (t.get('status') or '—')[:18],
                (t.get('qa_tester') or t.get('qc_tester') or '—')[:16]
            ])
        # repeatRows=1 to repeat header on new pages
        queue_tbl = Table(queue_data, colWidths=[0.65*inch, 2.2*inch, 1*inch, 1.3*inch, 1.2*inch], repeatRows=1)
        queue_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['primary']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(Spacer(1, 0.1*inch))
        elements.append(queue_tbl)
        if len(qa_tickets) > 40:
            elements.append(Paragraph(f"<i>(Showing first 40 of {len(qa_tickets)} pending tickets)</i>", styles['SmallText']))
    else:
        elements.append(Paragraph("<i>No tickets currently pending with QA.</i>", styles['SmallText']))
    elements.append(Spacer(1, 0.3*inch))
    
    # Newly Added to QC Testing (from Development) - Summary in report
    qc_newly = current.get('qc_testing_newly_added', [])
    qc_newly_breakdowns = data.get('qc_newly_added_breakdowns', {})
    used_fallback = any(t.get('_fallback_by_updated') for t in qc_newly)
    elements.append(Paragraph("Newly Added to QC Testing (from Development)", styles['SubSectionHeader']))
    newly_text = f"""
    <b>Count:</b> {len(qc_newly)} tickets moved from Development to QC Testing this period.<br/>
    <i>Tickets handed over by the development team for QA testing.</i>
    """
    if used_fallback:
        newly_text += "<br/><i>Note: Includes tickets in QC Testing with last update in this period (status change history not recorded for all).</i>"
    elements.append(Paragraph(newly_text, styles['ReportBody']))
    if qc_newly and qc_newly_breakdowns.get('by_priority'):
        priority_rows = [['Priority', 'Count']]
        for pri, count in sorted(qc_newly_breakdowns['by_priority'].items(), key=lambda x: x[1], reverse=True)[:10]:
            priority_rows.append([(pri or '—')[:25], str(count)])
        # Add total row
        total_newly = sum(c for _, c in qc_newly_breakdowns['by_priority'].items())
        priority_rows.append(['Total', str(total_newly)])
        
        pri_table = Table(priority_rows, colWidths=[3.5*inch, 1.2*inch])
        pri_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['header_blue']),  # Dark blue for readability
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_blue']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(Spacer(1, 0.15*inch))
        elements.append(pri_table)
        # Ticket list (ID, Title, Priority, Moved From)
        newly_table_data = [['Ticket', 'Title', 'Priority', 'Moved From']]
        for t in qc_newly[:15]:
            moved_from = (t.get('moved_from_status') or '—')[:18]
            newly_table_data.append([
                f"#{t['ticket_id']}",
                (t.get('title') or '—')[:28],
                (t.get('priority') or '—')[:14],
                moved_from
            ])
        # repeatRows=1 for header repeat on page breaks
        newly_tbl = Table(newly_table_data, colWidths=[0.65*inch, 2*inch, 1.1*inch, 1.2*inch], repeatRows=1)
        newly_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['header_cyan']),  # Dark cyan for readability
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(Spacer(1, 0.1*inch))
        elements.append(newly_tbl)
        if len(qc_newly) > 15:
            elements.append(Paragraph(f"<i>(Showing first 15 of {len(qc_newly)} tickets)</i>", styles['SmallText']))
    elements.append(Spacer(1, 0.3*inch))
    
    # QA Achievement Section
    elements.append(Paragraph("QA Team Achievement This Period", styles['SubSectionHeader']))
    achievement_text = f"""
    <b>New – Moved to BIS Testing:</b> {len(current['bis_testing_moved'])} tickets<br/>
    <i>Tickets successfully tested by QA and handed over to BIS-QA/Client team this period.</i>
    """
    elements.append(Paragraph(achievement_text, styles['ReportBody']))
    elements.append(Spacer(1, 0.2*inch))
    
    # Put on hold this week (e.g. for assigning new priority tickets)
    on_hold = data.get('on_hold_this_week', [])
    elements.append(Paragraph("<b>Put on hold this week</b>", styles['ReportBody']))
    elements.append(Paragraph(
        f"<i>Tickets moved to QC Testing Hold during the period (e.g. to assign new priority tickets): {len(on_hold)}</i>",
        styles['SmallText']
    ))
    if on_hold:
        # Include reason column if any ticket has a reason
        has_reasons = any(t.get('hold_reason') for t in on_hold)
        
        if has_reasons:
            hold_data = [['Ticket', 'Title', 'Priority', 'Reason']]
            for t in on_hold[:15]:
                reason = t.get('hold_reason') or '—'
                if len(reason) > 35:
                    reason = reason[:32] + '...'
                hold_data.append([
                    f"#{t.get('ticket_id', '—')}",
                    (t.get('title') or '—')[:22],
                    (t.get('priority') or '—')[:10],
                    reason
                ])
            # Add total row
            hold_data.append(['TOTAL', f'{len(on_hold)} tickets', '', ''])
            hold_tbl = Table(hold_data, colWidths=[0.6*inch, 1.6*inch, 0.8*inch, 2.2*inch], repeatRows=1)
        else:
            hold_data = [['Ticket', 'Title', 'Priority', 'Put on hold from']]
            for t in on_hold[:15]:
                put_on = (t.get('put_on_hold_on') or '—')
                if hasattr(put_on, 'strftime'):
                    put_on = put_on.strftime('%Y-%m-%d')
                hold_data.append([
                    f"#{t.get('ticket_id', '—')}",
                    (t.get('title') or '—')[:28],
                    (t.get('priority') or '—')[:12],
                    (t.get('put_on_hold_from') or '—')[:18]
                ])
            # Add total row
            hold_data.append(['TOTAL', f'{len(on_hold)} tickets', '', ''])
            hold_tbl = Table(hold_data, colWidths=[0.65*inch, 2*inch, 1*inch, 1.5*inch], repeatRows=1)
        
        hold_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['warning']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['bg_yellow']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_yellow']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(Spacer(1, 0.1*inch))
        elements.append(hold_tbl)
        if len(on_hold) > 15:
            elements.append(Paragraph(f"<i>(Showing first 15 of {len(on_hold)})</i>", styles['SmallText']))
    elements.append(Spacer(1, 0.25*inch))
    
    # Tickets QA failed this week (and how many times tested/failed)
    qa_failed = data.get('qa_failed_this_week', [])
    elements.append(Paragraph("<b>Tickets QA failed this week</b>", styles['ReportBody']))
    elements.append(Paragraph(
        f"<i>Tickets moved to QC Review Fail / Tested - Awaiting Fixes / Code Review Failed during the period. Count: {len(qa_failed)}. Column \"Times tested/failed\" = number of times the ticket was moved to fail status (retest cycle).</i>",
        styles['SmallText']
    ))
    if qa_failed:
        fail_data = [['Ticket', 'Title', 'Priority', 'Times tested/failed']]
        for t in qa_failed[:20]:
            fail_data.append([
                f"#{t.get('ticket_id', '—')}",
                (t.get('title') or '—')[:30],
                (t.get('priority') or '—')[:14],
                str(t.get('times_tested_and_failed', 0))
            ])
        # Add total row
        fail_data.append(['TOTAL', f'{len(qa_failed)} tickets', '', ''])
        
        # repeatRows=1 for header repeat on page breaks
        fail_tbl = Table(fail_data, colWidths=[0.65*inch, 2.5*inch, 1.2*inch, 1.2*inch], repeatRows=1)
        fail_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['danger']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['bg_red']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_red']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(Spacer(1, 0.1*inch))
        elements.append(fail_tbl)
        if len(qa_failed) > 20:
            elements.append(Paragraph(f"<i>(Showing first 20 of {len(qa_failed)})</i>", styles['SmallText']))
    elements.append(Spacer(1, 0.3*inch))
    
    # Priority Changes This Period (if any)
    priority_changes = data.get('priority_changes', [])
    if priority_changes:
        elements.append(Paragraph("Priority Changes This Period", styles['SubSectionHeader']))
        pc_data = [['Ticket', 'Title', 'Previous → New', 'Changed On']]
        for pc in priority_changes[:20]:
            changed_str = (pc.get('changed_on').strftime('%Y-%m-%d %H:%M') if hasattr(pc.get('changed_on'), 'strftime') else str(pc.get('changed_on') or '—'))[:16]
            pc_data.append([
                f"#{pc['ticket_id']}",
                (pc.get('title') or '—')[:22],
                f"{pc.get('previous_priority', '—')} → {pc.get('new_priority', '—')}",
                changed_str
            ])
        # Add total row
        pc_data.append(['TOTAL', f'{min(len(priority_changes), 20)} shown', '', ''])
        
        # repeatRows=1 for header repeat on page breaks
        pc_table = Table(pc_data, colWidths=[0.7*inch, 1.8*inch, 1.8*inch, 1.2*inch], repeatRows=1)
        pc_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['primary']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_blue']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(pc_table)
        if len(priority_changes) > 20:
            elements.append(Paragraph(f"<i>(Showing first 20 of {len(priority_changes)} priority changes)</i>", styles['SmallText']))
        elements.append(Spacer(1, 0.3*inch))
    
    # BIS Testing - Module-wise Distribution (QA Achievement breakdown)
    bis_breakdowns = data.get('bis_breakdowns', {})
    if bis_breakdowns.get('by_module'):
        module_header = Paragraph("Moved to BIS Testing - Module-wise Distribution", styles['SubSectionHeader'])
        
        module_data = [['Module', 'Tickets Moved']]
        module_total = 0
        for module, count in sorted(bis_breakdowns['by_module'].items(), key=lambda x: x[1], reverse=True)[:8]:
            module_data.append([module[:40], str(count)])
            module_total += count
        # Add total row
        module_data.append(['TOTAL', str(module_total)])
        
        module_table = Table(module_data, colWidths=[5*inch, 1.5*inch])
        module_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_green']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        # Keep header and table together on the same page
        elements.append(KeepTogether([module_header, Spacer(1, 0.1*inch), module_table]))
        elements.append(Spacer(1, 0.2*inch))
    
    # BIS Testing - Feature-wise Distribution
    if bis_breakdowns.get('by_feature'):
        feature_header = Paragraph("Moved to BIS Testing - Feature-wise Distribution", styles['SubSectionHeader'])
        
        feature_data = [['Feature', 'Tickets Moved']]
        feature_total = 0
        for feature, count in sorted(bis_breakdowns['by_feature'].items(), key=lambda x: x[1], reverse=True)[:8]:
            feature_data.append([feature[:40], str(count)])
            feature_total += count
        # Add total row
        feature_data.append(['TOTAL', str(feature_total)])
        
        feature_table = Table(feature_data, colWidths=[5*inch, 1.5*inch])
        feature_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
            ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
            # Total row styling
            ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_green']),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        # Keep header and table together on the same page
        elements.append(KeepTogether([feature_header, Spacer(1, 0.1*inch), feature_table]))
    
    elements.append(PageBreak())
    return elements


def create_comparison_page(data, styles):
    """Page 3: Weekly Comparison"""
    elements = []
    
    elements.append(Paragraph("Weekly Comparison", styles['SectionHeader']))
    elements.append(Paragraph("Current Week vs Previous Week Performance", styles['CardTitle']))
    elements.append(Spacer(1, 0.3*inch))
    
    current = data['current_week']
    previous = data['previous_week']
    
    # Calculate changes
    qa_change = len(current['qa_tickets']) - previous['qa_tickets_count']
    bis_change = len(current['bis_testing_moved']) - previous['bis_testing_count']
    
    # Comparison table
    comparison_data = [
        ['Metric', 'Last Week', 'This Week', 'Change', 'Trend'],
        [
            'Pending with QA',
            str(previous['qa_tickets_count']),
            str(len(current['qa_tickets'])),
            f"{'+' if qa_change >= 0 else ''}{qa_change}",
            get_trend_indicator(qa_change, inverse=True)  # Less is better for backlog
        ],
        [
            'Moved to BIS Testing',
            str(previous['bis_testing_count']),
            str(len(current['bis_testing_moved'])),
            f"{'+' if bis_change >= 0 else ''}{bis_change}",
            get_trend_indicator(bis_change)
        ],
    ]
    
    comparison_table = Table(comparison_data, colWidths=[2*inch, 1.2*inch, 1.2*inch, 0.9*inch, 1.1*inch])
    comparison_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['primary']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(comparison_table)
    
    elements.append(Spacer(1, 0.3*inch))
    
    # Visual comparison bar chart
    comparison_chart = create_comparison_bar_chart(
        prev_values=[previous['qa_tickets_count'], previous['bis_testing_count']],
        curr_values=[len(current['qa_tickets']), len(current['bis_testing_moved'])],
        labels=['Pending with QA', 'Moved to BIS'],
        title="Week-over-Week Comparison",
        width=450,
        height=200
    )
    if comparison_chart:
        elements.append(comparison_chart)
    
    elements.append(Spacer(1, 0.4*inch))
    
    # Net Workload Change
    net_change = qa_change
    change_color = COLORS['success'] if net_change <= 0 else COLORS['warning']
    change_text = "decreased" if net_change < 0 else ("increased" if net_change > 0 else "unchanged")
    
    elements.append(Paragraph("Workload Analysis", styles['SubSectionHeader']))
    
    analysis_text = f"""
    <b>Net QA Workload Change:</b> {'+' if net_change >= 0 else ''}{net_change} tickets<br/><br/>
    The QA workload has {change_text} compared to last week. 
    {len(current['bis_testing_moved'])} tickets were moved to BIS Testing during this period.
    """
    elements.append(Paragraph(analysis_text, styles['ReportBody']))
    
    elements.append(PageBreak())
    return elements


def create_newly_released_to_qa_page(data, styles):
    """Dedicated page: List of tickets newly released to QA with estimates, ETA, developer, status, module, QC tester."""
    elements = []
    
    qc_newly = data['current_week'].get('qc_testing_newly_added', [])
    
    elements.append(Paragraph("Tickets Newly Released to QA (from Development)", styles['SectionHeader']))
    elements.append(Paragraph(
        f"<b>Total: {len(qc_newly)} tickets</b> handed over to QA this period.",
        styles['CardTitle']
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    if not qc_newly:
        elements.append(Paragraph("No tickets were newly released to QC Testing this period.", styles['ReportBody']))
        elements.append(PageBreak())
        return elements
    
    # Ageing: closed = created→closed date, open = created→today (distinct labels)
    def _ageing_cell(t):
        if t.get('days_to_close') is not None:
            return f"Closed: {t['days_to_close']}d"
        if t.get('ageing_days') is not None:
            return f"Open: {t['ageing_days']}d"
        return '—'

    # Simplified table with fewer columns to prevent overlap
    # Split into main info + secondary info tables
    table_data = [[
        'Ticket', 'Title', 'Priority', 'QA Est', 'ETA',
        'Developer(s)', 'Current Status', 'QC Tester', 'Ageing'
    ]]
    for t in qc_newly:
        title_short = (t.get('title') or '—')[:32]
        if len(t.get('title') or '') > 32:
            title_short += '…'
        qa_est = t.get('qa_estimate')
        qa_est_str = f"{qa_est}h" if qa_est is not None else '0h'
        eta_str = t.get('eta_str') or 'Not Set'
        developers = (t.get('developers_str') or 'Not Assigned')[:14]
        if len(t.get('developers_str') or '') > 14:
            developers += '…'
        status_short = (t.get('status') or '—')[:12]
        qa_tester = (t.get('qa_tester') or 'Not Assigned')[:12]
        ageing_str = _ageing_cell(t)
        table_data.append([
            f"#{t['ticket_id']}",
            title_short,
            (t.get('priority') or '—')[:12],
            qa_est_str,
            eta_str[:10] if eta_str != 'Not Set' else eta_str,
            developers,
            status_short,
            qa_tester,
            ageing_str
        ])

    # Optimized column widths (total ~6.9 inch for A4 with margins)
    col_widths = [0.55*inch, 1.55*inch, 0.7*inch, 0.45*inch, 0.65*inch, 0.85*inch, 0.75*inch, 0.8*inch, 0.6*inch]
    
    # Create table with repeatRows to repeat header on each page
    ticket_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    ticket_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['info']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),  # Slightly smaller header
        ('FONTSIZE', (0, 1), (-1, -1), 7),  # Smaller body text
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (4, -1), 'CENTER'),  # QA Est and ETA centered
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        # Word wrap for title column
        ('WORDWRAP', (1, 0), (1, -1), True),
    ]))
    elements.append(ticket_table)
    elements.append(Spacer(1, 0.15*inch))
    elements.append(Paragraph(
        "<i>QA Est = QA estimate hours. Ageing: Open = days since created; Closed = days to close.</i>",
        styles['SmallText']
    ))

    elements.append(PageBreak())
    return elements


def create_bis_testing_summary_page(data, styles):
    """BIS Testing Summary"""
    elements = []
    
    bis_tickets = data['current_week']['bis_testing_moved']
    
    elements.append(Paragraph("Tickets Moved to BIS Testing", styles['SectionHeader']))
    elements.append(Paragraph(f"Total: {len(bis_tickets)} tickets this week", styles['CardTitle']))
    elements.append(Spacer(1, 0.3*inch))
    
    if not bis_tickets:
        elements.append(Paragraph("No tickets were moved to BIS Testing this week.", styles['ReportBody']))
        elements.append(PageBreak())
        return elements
    
    # Summary metrics
    total_bugs = sum(t['bugs_total'] for t in bis_tickets)
    total_tests = sum(t['tests_total'] for t in bis_tickets)
    avg_pass_rate = sum(t['pass_rate'] for t in bis_tickets) / len(bis_tickets) if bis_tickets else 0
    
    summary_data = [
        [
            create_metric_cell(len(bis_tickets), "Tickets", COLORS['bg_blue'], styles),
            create_metric_cell(total_bugs, "Total Bugs", COLORS['bg_red'], styles),
            create_metric_cell(total_tests, "Test Cases", COLORS['bg_cyan'], styles),
            create_metric_cell(f"{avg_pass_rate:.1f}%", "Avg Pass Rate", COLORS['bg_green'], styles),
        ]
    ]
    
    summary_table = Table(summary_data, colWidths=[1.75*inch, 1.75*inch, 1.75*inch, 1.75*inch])
    summary_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Module-wise chart for BIS tickets
    bis_breakdowns = data.get('bis_breakdowns', {})
    if bis_breakdowns.get('by_module'):
        module_chart = create_bar_chart(
            dict(sorted(bis_breakdowns['by_module'].items(), key=lambda x: x[1], reverse=True)[:6]),
            title="Module-wise Distribution",
            width=450,
            height=160,
            bar_color=COLORS['success']
        )
        if module_chart:
            elements.append(module_chart)
            elements.append(Spacer(1, 0.3*inch))
    
    # Ticket list table
    elements.append(Paragraph("Ticket Summary", styles['SubSectionHeader']))
    
    table_data = [['Ticket', 'Title', 'Priority', 'Status', 'QA Tester', 'Bugs', 'Tests', 'Pass %']]
    for t in bis_tickets:
        title_short = (t.get('title') or '')[:28]
        if len(t.get('title') or '') > 28:
            title_short += '…'
        table_data.append([
            f"#{t['ticket_id']}",
            title_short or '—',
            (t.get('priority') or '—')[:10],
            (t['status'] or '—')[:14],
            (t['qa_tester'] or '—')[:12],
            f"{t['bugs_open']}/{t['bugs_total']}",
            f"{t['tests_passed']}/{t['tests_total']}",
            f"{t['pass_rate']}%"
        ])
    
    # Add total row
    table_data.append([
        'TOTAL',
        f'{len(bis_tickets)} tickets',
        '',
        '',
        '',
        f"—/{total_bugs}",
        f"—/{total_tests}",
        f"{avg_pass_rate:.1f}%"
    ])
    
    # repeatRows=1 ensures header repeats on new pages
    ticket_table = Table(table_data, colWidths=[0.55*inch, 1.7*inch, 0.7*inch, 0.95*inch, 0.85*inch, 0.6*inch, 0.65*inch, 0.55*inch], repeatRows=1)
    ticket_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (1, 1), (1, -1), 'LEFT'),  # Title left-aligned
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
        # Total row styling
        ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_green']),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(ticket_table)
    
    elements.append(PageBreak())
    return elements


def create_ticket_detail_page(ticket, styles, section_title="BIS Testing"):
    """Individual Ticket Detail Page"""
    elements = []
    
    # Ticket Header
    elements.append(Paragraph(f"Ticket #{ticket['ticket_id']}", styles['SectionHeader']))
    elements.append(Paragraph(ticket['title'][:80], styles['CardTitle']))
    elements.append(Spacer(1, 0.15*inch))
    
    # Quick Info Row
    info_data = [[
        f"<b>Status:</b> {ticket['status']}",
        f"<b>Priority:</b> {ticket.get('priority') or 'Not Set'}",
        f"<b>ETA:</b> {ticket['eta_str']}",
        f"<b>Module:</b> {ticket['module']}",
    ]]
    # Create info cells with dark text for readability on light background
    info_cells = []
    for cell in info_data[0]:
        # Ensure text is dark for readability
        info_cells.append(Paragraph(cell.replace('<b>', '<b><font color="#1e293b">').replace('</b>', '</font></b>'), styles['ReportBody']))
    
    info_table = Table([info_cells], colWidths=[1.8*inch, 1.8*inch, 1.8*inch, 1.8*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), COLORS['light']),
        ('TEXTCOLOR', (0, 0), (-1, -1), COLORS['dark']),  # Ensure dark text
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # Team Info - ensure dark text
    team_text = f"<b><font color='#1e293b'>Developers:</font></b> {ticket['developers_str']} | <b><font color='#1e293b'>QA:</font></b> {ticket['qa_tester']}"
    elements.append(Paragraph(team_text, styles['ReportBody']))
    elements.append(Spacer(1, 0.2*inch))
    
    # Metrics Cards
    metrics_data = [
        [
            create_metric_cell(ticket['tests_total'], "Total Tests", COLORS['bg_blue'], styles),
            create_metric_cell(ticket['tests_passed'], "Passed", COLORS['bg_green'], styles),
            create_metric_cell(ticket['tests_failed'], "Failed", COLORS['bg_red'], styles),
            create_metric_cell(f"{ticket['pass_rate']}%", "Pass Rate", COLORS['bg_cyan'], styles),
        ]
    ]
    
    metrics_table = Table(metrics_data, colWidths=[1.75*inch, 1.75*inch, 1.75*inch, 1.75*inch])
    metrics_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(metrics_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # Bug Summary
    elements.append(Paragraph("Bug Summary", styles['SubSectionHeader']))
    
    bug_metrics = [
        [
            create_metric_cell(ticket['bugs_total'], "Total Bugs", COLORS['bg_red'], styles),
            create_metric_cell(ticket['bugs_open'], "Open", COLORS['bg_yellow'], styles),
            create_metric_cell(ticket['bugs_closed'], "Fixed", COLORS['bg_green'], styles),
            create_metric_cell(ticket['bugs_deferred'], "Deferred", COLORS['bg_purple'], styles),
        ]
    ]
    
    bug_table = Table(bug_metrics, colWidths=[1.75*inch, 1.75*inch, 1.75*inch, 1.75*inch])
    bug_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(bug_table)
    elements.append(Spacer(1, 0.15*inch))
    
    # Visual charts for test cases and bugs - side by side
    test_chart_data = {}
    if ticket['tests_passed'] > 0:
        test_chart_data['Passed'] = ticket['tests_passed']
    if ticket['tests_failed'] > 0:
        test_chart_data['Failed'] = ticket['tests_failed']
    if ticket.get('tests_blocked', 0) > 0:
        test_chart_data['Blocked'] = ticket['tests_blocked']
    if ticket.get('tests_untested', 0) > 0:
        test_chart_data['Untested'] = ticket['tests_untested']
    
    bug_chart_data = {}
    if ticket['bugs_open'] > 0:
        bug_chart_data['Open'] = ticket['bugs_open']
    if ticket['bugs_closed'] > 0:
        bug_chart_data['Fixed'] = ticket['bugs_closed']
    if ticket['bugs_deferred'] > 0:
        bug_chart_data['Deferred'] = ticket['bugs_deferred']
    
    # Create charts with proper sizing to prevent clipping
    test_pie = create_pie_chart(test_chart_data, "Test Results", width=240, height=200) if test_chart_data else None
    bug_pie = create_pie_chart(bug_chart_data, "Bug Status", width=240, height=200) if bug_chart_data else None
    
    # Display charts side by side if available
    if test_pie or bug_pie:
        chart_row = []
        if test_pie:
            chart_row.append(test_pie)
        if bug_pie:
            chart_row.append(bug_pie)
        
        if chart_row:
            # Adjust column widths to fit charts properly
            chart_width = 3.2*inch if len(chart_row) == 2 else 6.4*inch
            charts_table = Table([chart_row], colWidths=[chart_width] * len(chart_row))
            charts_table.setStyle(TableStyle([
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ]))
            elements.append(charts_table)
            elements.append(Spacer(1, 0.15*inch))
    
    # Severity breakdown - ensure dark text
    if ticket.get('bugs_by_severity'):
        sev_text = " | ".join([f"<b><font color='#1e293b'>{k}:</font></b> {v}" for k, v in ticket['bugs_by_severity'].items()])
        elements.append(Paragraph(f"<font color='#1e293b'>By Severity: {sev_text}</font>", styles['SmallText']))
    
    # Bug Details Tables - Separate tables for Open and Deferred bugs
    if ticket.get('bug_details'):
        # Separate bugs into Open and Deferred categories
        open_bugs = []
        deferred_bugs = []
        
        for bug in ticket['bug_details']:
            bug_status = (bug.get('status') or '').lower().strip()
            
            # Exclude closed/resolved/fixed/verified/reject bugs
            if bug_status in ['closed', 'resolved', 'verified', 'fixed', 'reject', 'rejected']:
                continue
            
            # Categorize as Deferred
            if bug_status in ['deferred', 'wont fix', 'duplicate']:
                deferred_bugs.append(bug)
            # Everything else is Open (not closed, not deferred, not reject)
            elif bug_status:
                open_bugs.append(bug)
        
        # Open Bugs Table
        if open_bugs:
            elements.append(Spacer(1, 0.15*inch))
            elements.append(Paragraph("Open Bugs", styles['SubSectionHeader']))
            
            open_table_data = [['ID', 'Subject', 'Status', 'Severity', 'Assignee']]
            for bug in open_bugs[:10]:  # Limit to 10 bugs
                open_table_data.append([
                    str(bug['id']),
                    bug['subject'][:35] + ('...' if len(bug['subject']) > 35 else ''),
                    bug['status'],
                    bug['severity'],
                    bug['assignee'][:12]
                ])
            
            open_table = Table(open_table_data, colWidths=[0.7*inch, 2.8*inch, 0.9*inch, 0.8*inch, 1*inch])
            open_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f57c00')),  # Darker orange for better contrast
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fff9e6')]),
                ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
                ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ]))
            elements.append(open_table)
            
            # Show if more open bugs exist
            if len(open_bugs) > 10:
                elements.append(Paragraph(f"... and {len(open_bugs) - 10} more open bugs", styles['SmallText']))
        
        # Deferred Bugs Table
        if deferred_bugs:
            elements.append(Spacer(1, 0.15*inch))
            elements.append(Paragraph("Deferred Bugs", styles['SubSectionHeader']))
            
            deferred_table_data = [['ID', 'Subject', 'Status', 'Severity', 'Assignee']]
            for bug in deferred_bugs[:10]:  # Limit to 10 bugs
                deferred_table_data.append([
                    str(bug['id']),
                    bug['subject'][:35] + ('...' if len(bug['subject']) > 35 else ''),
                    bug['status'],
                    bug['severity'],
                    bug['assignee'][:12]
                ])
            
            deferred_table = Table(deferred_table_data, colWidths=[0.7*inch, 2.8*inch, 0.9*inch, 0.8*inch, 1*inch])
            deferred_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#6a1b9a')),  # Darker purple for better contrast
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3e5f5')]),
                ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
                ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ]))
            elements.append(deferred_table)
            
            # Show if more deferred bugs exist
            if len(deferred_bugs) > 10:
                elements.append(Paragraph(f"... and {len(deferred_bugs) - 10} more deferred bugs", styles['SmallText']))
    
    elements.append(PageBreak())
    return elements


def create_upcoming_plan_page(data, styles):
    """Upcoming QA Plan Page"""
    elements = []
    
    planned = data['next_week_plan']
    
    elements.append(Paragraph("Upcoming QA Plan", styles['SectionHeader']))
    
    next_start = data['week_end'] + timedelta(days=3)
    next_end = next_start + timedelta(days=4)
    elements.append(Paragraph(
        f"Week of {next_start.strftime('%B %d')} - {next_end.strftime('%B %d, %Y')}",
        styles['CardTitle']
    ))
    elements.append(Spacer(1, 0.3*inch))
    
    if not planned:
        elements.append(Paragraph(
            "No tickets are currently scheduled for QA next week based on ETA dates.",
            styles['ReportBody']
        ))
        elements.append(Spacer(1, 0.2*inch))
        elements.append(Paragraph(
            "Please update ticket ETAs in the PM Tool to reflect the upcoming QA schedule.",
            styles['SmallText']
        ))
        return elements
    
    # Summary
    elements.append(Paragraph(f"<b>{len(planned)} tickets</b> planned for next week", styles['ReportBody']))
    elements.append(Spacer(1, 0.2*inch))
    
    # Priority Queue Table
    elements.append(Paragraph("Priority Queue", styles['SubSectionHeader']))
    
    # Sort by ETA
    sorted_planned = sorted(planned, key=lambda x: x['eta'] if x['eta'] else datetime.max)
    
    table_data = [['#', 'Ticket ID', 'Title', 'Priority', 'Status', 'ETA', 'QA Tester', 'Est. Hours']]
    for idx, t in enumerate(sorted_planned, 1):
        title_short = (t.get('title') or '')[:22]
        if len(t.get('title') or '') > 22:
            title_short += '…'
        table_data.append([
            str(idx),
            f"#{t['ticket_id']}",
            title_short or '—',
            (t.get('priority') or '—')[:10],
            t['status'][:12],
            t['eta_str'],
            t['qa_tester'][:12],
            f"{t['qa_estimate']}h"
        ])
    
    # Add total row
    total_hours = sum(t['qa_estimate'] for t in planned)
    table_data.append([
        '',
        'TOTAL',
        f'{len(planned)} tickets',
        '',
        '',
        '',
        '',
        f"{total_hours}h"
    ])
    
    # repeatRows=1 to repeat header on page breaks
    plan_table = Table(table_data, colWidths=[0.35*inch, 0.6*inch, 1.6*inch, 0.7*inch, 0.85*inch, 0.8*inch, 0.9*inch, 0.55*inch], repeatRows=1)
    plan_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['info']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (2, 1), (2, -1), 'LEFT'),  # Title left-aligned
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),
        # Total row styling
        ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_cyan']),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(plan_table)
    elements.append(Spacer(1, 0.15*inch))
    elements.append(Paragraph(f"<b>Total Tickets:</b> {len(planned)} | <b>Total Estimated QA Hours:</b> {total_hours}h", styles['ReportBody']))
    
    return elements


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def create_metric_cell(value, label, bg_color, styles):
    """Create a styled metric cell for overview cards; aligned and readable."""
    cell_data = [
        [Paragraph(f"<b>{value}</b>", styles['MetricMedium'])],
        [Paragraph(label, styles['MetricLabel'])]
    ]
    cell_table = Table(cell_data, colWidths=[1.65*inch])
    cell_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 14),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    return cell_table


def get_trend_indicator(change, inverse=False):
    """Get trend indicator text"""
    if change == 0:
        return "→"
    
    is_positive = change > 0
    if inverse:
        is_positive = not is_positive
    
    if is_positive:
        return "↑ Better"
    else:
        return "↓ Needs Attention"


# ============================================================================
# MAIN REPORT GENERATION
# ============================================================================

def generate_comprehensive_report(data, output_path, project_name=None):
    """Generate the complete multi-page PDF report"""
    styles = create_professional_styles()
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=0.65*inch,
        leftMargin=0.65*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch
    )
    
    elements = []
    
    # Page 1: Cover
    elements.extend(create_cover_page(data, styles, project_name))
    
    # Page 2: QA Overview Dashboard
    elements.extend(create_overview_page(data, styles))
    
    # Page 3: Newly Released to QA (list with estimates, ETA, developer, status, module, QC tester)
    elements.extend(create_newly_released_to_qa_page(data, styles))
    
    # Page 4: Weekly Comparison
    elements.extend(create_comparison_page(data, styles))
    
    # Page 5: BIS Testing Summary
    elements.extend(create_bis_testing_summary_page(data, styles))
    
    # Pages 5+: Individual BIS Testing Ticket Details
    for ticket in data['current_week']['bis_testing_moved']:
        elements.extend(create_ticket_detail_page(ticket, styles, "BIS Testing"))
    
    # Final: Upcoming QA Plan
    elements.extend(create_upcoming_plan_page(data, styles))
    
    # Build PDF
    doc.build(elements)
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate Professional QA Weekly Report",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python qa_weekly_report_v2.py                           # Current week
    python qa_weekly_report_v2.py --date 2026-01-20         # Specific week
    python qa_weekly_report_v2.py --project "Client XYZ"    # With project name
        """
    )
    parser.add_argument('--date', '-d', type=str, help="Reference date (YYYY-MM-DD)")
    parser.add_argument('--output', '-o', type=str, help="Output PDF filename")
    parser.add_argument('--project', '-p', type=str, help="Project/Client name for cover page")
    
    args = parser.parse_args()
    
    # Get week dates
    week_start, week_end = get_week_dates(args.date)
    
    print(f"\n{'='*70}")
    print("  Professional QA Weekly Report Generator V2")
    print(f"{'='*70}")
    print(f"  Week: {week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}")
    if args.project:
        print(f"  Project: {args.project}")
    print(f"{'='*70}\n")
    
    # Fetch data
    print("Fetching comprehensive data...")
    data = get_comprehensive_data(week_start, week_end)
    
    print(f"  • QA Tickets: {len(data['current_week']['qa_tickets'])}")
    print(f"  • Newly Added to QC Testing: {len(data['current_week'].get('qc_testing_newly_added', []))}")
    print(f"  • Moved to BIS Testing: {len(data['current_week']['bis_testing_moved'])}")
    print(f"  • Priority Changes: {len(data.get('priority_changes', []))}")
    print(f"  • In Progress: {len(data['current_week']['in_progress'])}")
    print(f"  • Planned Next Week: {len(data['next_week_plan'])}")
    
    # Create output path
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    
    if args.output:
        output_path = args.output
        if not output_path.endswith('.pdf'):
            output_path += '.pdf'
    else:
        output_path = os.path.join(
            REPORTS_FOLDER,
            f"QA_Weekly_Report_V2_{week_start.strftime('%Y%m%d')}_{week_end.strftime('%Y%m%d')}.pdf"
        )
    
    # Generate report
    print(f"\nGenerating comprehensive PDF report...")
    generate_comprehensive_report(data, output_path, args.project)
    
    print(f"\n{'='*70}")
    print(f"  SUCCESS: Report generated!")
    print(f"{'='*70}")
    print(f"  Output: {output_path}")
    print(f"{'='*70}\n")
    
    return output_path


if __name__ == "__main__":
    main()
