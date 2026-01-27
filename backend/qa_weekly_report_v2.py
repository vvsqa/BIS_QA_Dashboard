"""
Professional QA Weekly Report Generator V2

Generates a comprehensive, multi-page PDF report for stakeholders and clients.

Pages:
1. Cover Page
2. QA Overview Dashboard
3. Weekly Comparison
4. BIS Testing Summary
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
from datetime import datetime, timedelta
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
from models import Bug, TicketTracking, TestResult, TestCase, TestRun, TicketStatusHistory

# ============================================================================
# CONFIGURATION
# ============================================================================

REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "techversant-logo.png")

# Color Palette - Professional & Modern
COLORS = {
    'primary': colors.HexColor('#2563eb'),      # Blue
    'secondary': colors.HexColor('#64748b'),    # Slate
    'success': colors.HexColor('#16a34a'),      # Green
    'warning': colors.HexColor('#d97706'),      # Amber
    'danger': colors.HexColor('#dc2626'),       # Red
    'info': colors.HexColor('#0891b2'),         # Cyan
    'purple': colors.HexColor('#7c3aed'),       # Purple
    'dark': colors.HexColor('#1e293b'),         # Dark slate
    'light': colors.HexColor('#f8fafc'),        # Light
    'border': colors.HexColor('#e2e8f0'),       # Border
    'muted': colors.HexColor('#94a3b8'),        # Muted text
    'bg_green': colors.HexColor('#dcfce7'),
    'bg_red': colors.HexColor('#fee2e2'),
    'bg_yellow': colors.HexColor('#fef3c7'),
    'bg_blue': colors.HexColor('#dbeafe'),
    'bg_purple': colors.HexColor('#f3e8ff'),
    'bg_cyan': colors.HexColor('#cffafe'),
}

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
        all_qa_tickets = db.query(TicketTracking).filter(
            TicketTracking.status.in_(QA_TEAM_STATUSES)
        ).all()
        
        for ticket in all_qa_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket)
            data['current_week']['qa_tickets'].append(ticket_data)
            
            # Update QA pending breakdown by status
            status = ticket.status
            if status in data['qa_pending_breakdown']:
                data['qa_pending_breakdown'][status] += 1
            
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
        
        # ===== NEXT WEEK: Planned tickets =====
        planned_tickets = db.query(TicketTracking).filter(
            TicketTracking.eta >= next_week_start,
            TicketTracking.eta <= next_week_end,
            ~TicketTracking.status.in_(CLOSED_STATUSES)
        ).order_by(TicketTracking.eta.asc()).all()
        
        for ticket in planned_tickets:
            ticket_data = get_enriched_ticket_data(db, ticket)
            data['next_week_plan'].append(ticket_data)
        
        # ===== AGGREGATE METRICS =====
        data['metrics']['total_qa_tickets'] = len(data['current_week']['qa_tickets'])
        
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
    
    # Get ticket title from first bug
    ticket_title = f"Ticket #{ticket_id}"
    if bugs:
        first_bug = bugs[0]
        if first_bug.subject:
            parts = first_bug.subject.split(" - ")
            ticket_title = parts[0] if parts else first_bug.subject
    
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
    """Create professional, enterprise-grade styles"""
    styles = getSampleStyleSheet()
    
    # Cover page styles
    styles.add(ParagraphStyle(
        name='CoverTitle',
        parent=styles['Heading1'],
        fontSize=36,
        spaceAfter=10,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='CoverSubtitle',
        parent=styles['Normal'],
        fontSize=16,
        alignment=TA_CENTER,
        textColor=COLORS['secondary'],
        spaceAfter=30
    ))
    
    styles.add(ParagraphStyle(
        name='CoverDate',
        parent=styles['Normal'],
        fontSize=14,
        alignment=TA_CENTER,
        textColor=COLORS['primary'],
        fontName='Helvetica-Bold',
        spaceBefore=20
    ))
    
    # Section styles
    styles.add(ParagraphStyle(
        name='SectionHeader',
        parent=styles['Heading1'],
        fontSize=18,
        spaceBefore=25,
        spaceAfter=15,
        textColor=COLORS['dark'],
        borderColor=COLORS['primary'],
        borderWidth=2,
        borderPadding=8
    ))
    
    styles.add(ParagraphStyle(
        name='SubSectionHeader',
        parent=styles['Heading2'],
        fontSize=14,
        spaceBefore=15,
        spaceAfter=10,
        textColor=COLORS['primary']
    ))
    
    styles.add(ParagraphStyle(
        name='CardTitle',
        parent=styles['Heading3'],
        fontSize=11,
        spaceBefore=5,
        spaceAfter=3,
        textColor=COLORS['secondary']
    ))
    
    # Metric styles
    styles.add(ParagraphStyle(
        name='MetricLarge',
        parent=styles['Normal'],
        fontSize=32,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='MetricMedium',
        parent=styles['Normal'],
        fontSize=24,
        alignment=TA_CENTER,
        textColor=COLORS['dark'],
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='MetricLabel',
        parent=styles['Normal'],
        fontSize=9,
        alignment=TA_CENTER,
        textColor=COLORS['dark']  # Darker color for better readability on light backgrounds
    ))
    
    styles.add(ParagraphStyle(
        name='MetricSmall',
        parent=styles['Normal'],
        fontSize=11,
        alignment=TA_CENTER,
        textColor=COLORS['secondary']
    ))
    
    # Body text styles
    styles.add(ParagraphStyle(
        name='ReportBody',
        parent=styles['Normal'],
        fontSize=10,
        textColor=COLORS['dark'],
        leading=14
    ))
    
    styles.add(ParagraphStyle(
        name='SmallText',
        parent=styles['Normal'],
        fontSize=8,
        textColor=COLORS['muted']
    ))
    
    styles.add(ParagraphStyle(
        name='FooterText',
        parent=styles['Normal'],
        fontSize=8,
        alignment=TA_CENTER,
        textColor=COLORS['muted']
    ))
    
    # Trend indicators
    styles.add(ParagraphStyle(
        name='TrendUp',
        parent=styles['Normal'],
        fontSize=10,
        textColor=COLORS['success'],
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='TrendDown',
        parent=styles['Normal'],
        fontSize=10,
        textColor=COLORS['danger'],
        fontName='Helvetica-Bold'
    ))
    
    return styles


# ============================================================================
# CHART GENERATORS
# ============================================================================

# Chart color palette
CHART_COLORS = [
    colors.HexColor('#3498db'),  # Blue
    colors.HexColor('#2ecc71'),  # Green
    colors.HexColor('#e74c3c'),  # Red
    colors.HexColor('#f39c12'),  # Orange
    colors.HexColor('#9b59b6'),  # Purple
    colors.HexColor('#1abc9c'),  # Teal
    colors.HexColor('#34495e'),  # Dark gray
    colors.HexColor('#e67e22'),  # Dark orange
]


def create_pie_chart(data_dict, title="", width=280, height=200):
    """Create a pie chart from a dictionary of label: value pairs"""
    if not data_dict or sum(data_dict.values()) == 0:
        return None
    
    drawing = Drawing(width, height)
    
    pie = Pie()
    # Center the pie chart with more space for labels
    pie.x = width // 2 - 50
    pie.y = 35  # More space from bottom for labels
    pie.width = 100  # Smaller pie to fit labels
    pie.height = 100
    
    # Prepare data
    labels = list(data_dict.keys())
    values = list(data_dict.values())
    
    pie.data = values
    # Shorter labels to prevent overflow
    pie.labels = [f"{l[:8]} ({v})" if len(l) > 8 else f"{l} ({v})" for l, v in zip(labels, values)]
    
    # Style the pie
    pie.slices.strokeWidth = 1
    pie.slices.strokeColor = colors.white
    
    for i, _ in enumerate(values):
        pie.slices[i].fillColor = CHART_COLORS[i % len(CHART_COLORS)]
        pie.slices[i].popout = 0  # Remove popout to prevent overflow
    
    # Use better label positioning
    pie.sideLabels = False  # Use simple labels to prevent overflow
    pie.simpleLabels = True
    pie.slices.fontName = 'Helvetica'
    pie.slices.fontSize = 7  # Smaller font
    
    # Add compact legend below the chart
    legend_y = 5
    legend_x_start = 10
    max_label_width = 70
    items_per_row = min(3, len(labels))  # Max 3 items per row
    legend_spacing = (width - 20) // items_per_row if items_per_row > 0 else 80
    
    for i, (label, value) in enumerate(zip(labels, values)):
        row = i // items_per_row
        col = i % items_per_row
        x_pos = legend_x_start + (col * legend_spacing)
        y_pos = legend_y - (row * 15)  # Stack rows if needed
        
        if x_pos + max_label_width > width or y_pos < 0:
            continue
            
        # Color box
        drawing.add(Rect(x_pos, y_pos, 6, 6, 
                        fillColor=CHART_COLORS[i % len(CHART_COLORS)], 
                        strokeColor=None))
        # Label text - truncate if too long
        label_text = f"{label[:8]}: {value}" if len(label) > 8 else f"{label}: {value}"
        drawing.add(String(x_pos + 9, y_pos, 
                          label_text,
                          fontName='Helvetica', fontSize=6, fillColor=COLORS['dark']))
    
    drawing.add(pie)
    
    # Add title at top - use very dark color for readability
    if title:
        title_text = String(width // 2, height - 15, title,
                           textAnchor='middle',
                           fontName='Helvetica-Bold',
                           fontSize=10,
                           fillColor=colors.HexColor('#0f172a'))  # Very dark for better contrast
        drawing.add(title_text)
    
    return drawing


def create_bar_chart(data_dict, title="", width=400, height=180, bar_color=None):
    """Create a vertical bar chart from a dictionary of label: value pairs"""
    if not data_dict:
        return None
    
    drawing = Drawing(width, height)
    
    chart = VerticalBarChart()
    chart.x = 60
    chart.y = 30
    chart.width = width - 100
    chart.height = height - 60
    
    # Prepare data
    labels = list(data_dict.keys())
    values = list(data_dict.values())
    
    chart.data = [values]
    chart.categoryAxis.categoryNames = [l[:15] for l in labels]  # Truncate long labels
    
    # Style
    chart.bars[0].fillColor = bar_color or COLORS['primary']
    chart.bars[0].strokeColor = None
    chart.bars.strokeWidth = 0
    
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max(values) * 1.2 if values else 10
    chart.valueAxis.valueStep = max(1, max(values) // 5) if values else 2
    chart.valueAxis.labels.fontName = 'Helvetica'
    chart.valueAxis.labels.fontSize = 8
    chart.valueAxis.labels.fillColor = colors.HexColor('#0f172a')  # Dark text for readability
    
    chart.categoryAxis.labels.fontName = 'Helvetica'
    chart.categoryAxis.labels.fontSize = 8
    chart.categoryAxis.labels.fillColor = colors.HexColor('#0f172a')  # Dark text for readability
    chart.categoryAxis.labels.angle = 30
    chart.categoryAxis.labels.boxAnchor = 'ne'
    
    drawing.add(chart)
    
    # Add title - use very dark color for readability
    if title:
        title_text = String(width // 2, height - 10, title,
                           textAnchor='middle',
                           fontName='Helvetica-Bold',
                           fontSize=10,
                           fillColor=colors.HexColor('#0f172a'))  # Very dark for better contrast
        drawing.add(title_text)
    
    return drawing


def create_comparison_bar_chart(prev_values, curr_values, labels, title="", width=400, height=180):
    """Create a grouped bar chart for comparison (previous vs current)"""
    if not labels:
        return None
    
    drawing = Drawing(width, height)
    
    chart = VerticalBarChart()
    chart.x = 70
    chart.y = 40
    chart.width = width - 120
    chart.height = height - 70
    
    chart.data = [prev_values, curr_values]
    chart.categoryAxis.categoryNames = labels
    
    # Style the bars
    chart.bars[0].fillColor = colors.HexColor('#95a5a6')  # Gray for previous
    chart.bars[1].fillColor = colors.HexColor('#3498db')  # Blue for current
    chart.bars.strokeWidth = 0
    
    max_val = max(max(prev_values) if prev_values else 0, max(curr_values) if curr_values else 0)
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max_val * 1.3 if max_val > 0 else 10
    chart.valueAxis.labels.fontName = 'Helvetica'
    chart.valueAxis.labels.fontSize = 8
    chart.valueAxis.labels.fillColor = colors.HexColor('#0f172a')  # Dark text for readability
    
    chart.categoryAxis.labels.fontName = 'Helvetica'
    chart.categoryAxis.labels.fontSize = 9
    chart.categoryAxis.labels.fillColor = colors.HexColor('#0f172a')  # Dark text for readability
    
    drawing.add(chart)
    
    # Add title - use very dark color for readability
    if title:
        title_text = String(width // 2, height - 8, title,
                           textAnchor='middle',
                           fontName='Helvetica-Bold',
                           fontSize=10,
                           fillColor=colors.HexColor('#0f172a'))  # Very dark for better contrast
        drawing.add(title_text)
    
    # Add legend - use dark text for readability
    legend_y = 15
    # Previous week
    drawing.add(Rect(width - 130, legend_y, 12, 12, fillColor=colors.HexColor('#95a5a6'), strokeColor=None))
    drawing.add(String(width - 115, legend_y + 2, "Last Week", fontName='Helvetica', fontSize=8, fillColor=colors.HexColor('#0f172a')))
    # Current week  
    drawing.add(Rect(width - 60, legend_y, 12, 12, fillColor=colors.HexColor('#3498db'), strokeColor=None))
    drawing.add(String(width - 45, legend_y + 2, "This Week", fontName='Helvetica', fontSize=8, fillColor=colors.HexColor('#0f172a')))
    
    return drawing


def create_horizontal_progress_bar(value, max_value, label="", width=300, height=40, bar_color=None):
    """Create a horizontal progress bar"""
    drawing = Drawing(width, height)
    
    bar_height = 20
    bar_y = (height - bar_height) // 2
    
    # Background bar
    drawing.add(Rect(60, bar_y, width - 80, bar_height, 
                    fillColor=colors.HexColor('#ecf0f1'), 
                    strokeColor=colors.HexColor('#bdc3c7'),
                    strokeWidth=1))
    
    # Progress bar
    if max_value > 0:
        progress_width = (value / max_value) * (width - 80)
        drawing.add(Rect(60, bar_y, progress_width, bar_height,
                        fillColor=bar_color or COLORS['success'],
                        strokeColor=None))
    
    # Label - use very dark color for readability
    if label:
        drawing.add(String(5, bar_y + 5, label, fontName='Helvetica', fontSize=9, fillColor=colors.HexColor('#0f172a')))
    
    # Value - use very dark color for readability
    percentage = round((value / max_value * 100), 1) if max_value > 0 else 0
    drawing.add(String(width - 15, bar_y + 5, f"{percentage}%", 
                      fontName='Helvetica-Bold', fontSize=9, fillColor=colors.HexColor('#0f172a')))
    
    return drawing


# ============================================================================
# PAGE GENERATORS
# ============================================================================

def create_cover_page(data, styles, project_name=None):
    """Page 1: Professional Cover Page"""
    elements = []
    
    # Add vertical spacing to center content
    elements.append(Spacer(1, 1.5*inch))
    
    # Logo
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=3*inch, height=0.75*inch)
            logo.hAlign = 'CENTER'
            elements.append(logo)
            elements.append(Spacer(1, 0.8*inch))
        except:
            pass
    
    # Main Title
    elements.append(Paragraph("QA Weekly Report", styles['CoverTitle']))
    elements.append(Spacer(1, 0.3*inch))
    
    # Decorative line
    elements.append(HRFlowable(width="60%", thickness=3, color=COLORS['primary'], hAlign='CENTER'))
    elements.append(Spacer(1, 0.5*inch))
    
    # Date range
    week_start = data['week_start'].strftime('%B %d, %Y')
    week_end = data['week_end'].strftime('%B %d, %Y')
    elements.append(Paragraph(f"{week_start} — {week_end}", styles['CoverDate']))
    elements.append(Spacer(1, 0.3*inch))
    
    # Project name if provided
    if project_name:
        elements.append(Paragraph(project_name, styles['CoverSubtitle']))
    
    # Generation info at bottom
    elements.append(Spacer(1, 2*inch))
    elements.append(HRFlowable(width="40%", thickness=1, color=COLORS['border'], hAlign='CENTER'))
    elements.append(Spacer(1, 0.2*inch))
    gen_time = data['generation_time'].strftime('%Y-%m-%d %H:%M')
    elements.append(Paragraph(f"Generated: {gen_time}", styles['SmallText']))
    elements.append(Paragraph("Confidential - For Internal Use Only", styles['SmallText']))
    
    elements.append(PageBreak())
    return elements


def create_overview_page(data, styles):
    """Page 2: QA Overview Dashboard"""
    elements = []
    
    # Section Header
    elements.append(Paragraph("QA Team Overview", styles['SectionHeader']))
    elements.append(Spacer(1, 0.2*inch))
    
    # Key Metrics Cards (Top Row)
    current = data['current_week']
    metrics = data['metrics']
    qa_pending = data.get('qa_pending_breakdown', {})
    total_pending = len(current['qa_tickets'])
    
    # Main KPIs: Total Pending with QA and Achievement (moved to BIS Testing)
    kpi_data = [
        [
            create_metric_cell(total_pending, "Total Pending with QA", COLORS['bg_blue'], styles),
            create_metric_cell(len(current['bis_testing_moved']), "Moved to BIS Testing", COLORS['bg_green'], styles),
        ]
    ]
    
    kpi_table = Table(kpi_data, colWidths=[3.4*inch, 3.4*inch])
    kpi_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(kpi_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # QA Team Pending Breakdown by Status - Table and Pie Chart side by side
    elements.append(Paragraph("QA Team Pending - Status Breakdown", styles['SubSectionHeader']))
    
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
    
    pending_table = Table(pending_table_data, colWidths=[2.5*inch, 1*inch, 1*inch])
    pending_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['primary']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -2), COLORS['dark']),  # Dark text for data rows
        ('BACKGROUND', (0, -1), (-1, -1), COLORS['bg_blue']),
        ('TEXTCOLOR', (0, -1), (-1, -1), COLORS['dark']),  # Dark text for total row
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    
    # Create pie chart for status breakdown
    status_pie = create_pie_chart(status_chart_data, "Status Distribution", width=240, height=200)
    
    # Combine table and chart side by side
    if status_pie:
        combined_table = Table([[pending_table, status_pie]], colWidths=[4.2*inch, 2.8*inch])
        combined_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(combined_table)
    else:
        elements.append(pending_table)
    
    elements.append(Spacer(1, 0.3*inch))
    
    # QA Achievement Section
    elements.append(Paragraph("QA Team Achievement This Period", styles['SubSectionHeader']))
    achievement_text = f"""
    <b>Tickets Moved to BIS Testing:</b> {len(current['bis_testing_moved'])} tickets<br/>
    <i>These tickets have been successfully tested by QA team and handed over to BIS-QA/Client team.</i>
    """
    elements.append(Paragraph(achievement_text, styles['ReportBody']))
    
    elements.append(Spacer(1, 0.3*inch))
    
    # BIS Testing - Module-wise Distribution (QA Achievement breakdown)
    bis_breakdowns = data.get('bis_breakdowns', {})
    if bis_breakdowns.get('by_module'):
        module_header = Paragraph("Moved to BIS Testing - Module-wise Distribution", styles['SubSectionHeader'])
        
        module_data = [['Module', 'Tickets Moved']]
        for module, count in sorted(bis_breakdowns['by_module'].items(), key=lambda x: x[1], reverse=True)[:8]:
            module_data.append([module[:40], str(count)])
        
        module_table = Table(module_data, colWidths=[5*inch, 1.5*inch])
        module_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
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
        for feature, count in sorted(bis_breakdowns['by_feature'].items(), key=lambda x: x[1], reverse=True)[:8]:
            feature_data.append([feature[:40], str(count)])
        
        feature_table = Table(feature_data, colWidths=[5*inch, 1.5*inch])
        feature_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
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
    
    comparison_table = Table(comparison_data, colWidths=[2.2*inch, 1.3*inch, 1.3*inch, 1*inch, 1*inch])
    comparison_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['dark']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
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


def create_bis_testing_summary_page(data, styles):
    """Page 4: BIS Testing Summary"""
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
    
    table_data = [['Ticket ID', 'Status', 'QA Tester', 'Bugs', 'Tests', 'Pass Rate']]
    for t in bis_tickets:
        table_data.append([
            f"#{t['ticket_id']}",
            t['status'][:18],
            t['qa_tester'][:15],
            f"{t['bugs_open']}/{t['bugs_total']}",
            f"{t['tests_passed']}/{t['tests_total']}",
            f"{t['pass_rate']}%"
        ])
    
    ticket_table = Table(table_data, colWidths=[0.9*inch, 1.4*inch, 1.4*inch, 0.9*inch, 0.9*inch, 0.9*inch])
    ticket_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['success']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
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
        f"<b>Module:</b> {ticket['module']}",
        f"<b>ETA:</b> {ticket['eta_str']}",
    ]]
    # Create info cells with dark text for readability on light background
    info_cells = []
    for cell in info_data[0]:
        # Ensure text is dark for readability
        info_cells.append(Paragraph(cell.replace('<b>', '<b><font color="#1e293b">').replace('</b>', '</font></b>'), styles['ReportBody']))
    
    info_table = Table([info_cells], colWidths=[2.3*inch, 2.3*inch, 2.3*inch])
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
    
    table_data = [['Priority', 'Ticket ID', 'Status', 'ETA', 'QA Tester', 'Est. Hours']]
    for idx, t in enumerate(sorted_planned, 1):
        table_data.append([
            str(idx),
            f"#{t['ticket_id']}",
            t['status'][:15],
            t['eta_str'],
            t['qa_tester'][:12],
            f"{t['qa_estimate']}h"
        ])
    
    plan_table = Table(table_data, colWidths=[0.6*inch, 0.9*inch, 1.3*inch, 1*inch, 1.2*inch, 0.8*inch])
    plan_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLORS['info']),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light']]),
        ('TEXTCOLOR', (0, 1), (-1, -1), COLORS['dark']),  # Dark text for data rows
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(plan_table)
    
    # Total estimated hours
    total_hours = sum(t['qa_estimate'] for t in planned)
    elements.append(Spacer(1, 0.2*inch))
    elements.append(Paragraph(f"<b>Total Estimated QA Hours:</b> {total_hours} hours", styles['ReportBody']))
    
    return elements


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def create_metric_cell(value, label, bg_color, styles):
    """Create a styled metric cell for tables"""
    cell_data = [
        [Paragraph(f"<b>{value}</b>", styles['MetricMedium'])],
        [Paragraph(label, styles['MetricLabel'])]
    ]
    
    cell_table = Table(cell_data, colWidths=[1.6*inch])
    cell_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, COLORS['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
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
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=0.5*inch,
        bottomMargin=0.5*inch
    )
    
    elements = []
    
    # Page 1: Cover
    elements.extend(create_cover_page(data, styles, project_name))
    
    # Page 2: QA Overview Dashboard
    elements.extend(create_overview_page(data, styles))
    
    # Page 3: Weekly Comparison
    elements.extend(create_comparison_page(data, styles))
    
    # Page 4: BIS Testing Summary
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
    print(f"  • Moved to BIS Testing: {len(data['current_week']['bis_testing_moved'])}")
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
