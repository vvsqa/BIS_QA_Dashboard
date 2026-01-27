"""
Weekly QA Report Generator

Generates a comprehensive PDF report of QA activities for the week including:
- Summary metrics (planned vs completed)
- Tickets moved to BIS Testing and Closed
- Detailed status for each ticket with Redmine bugs, TestRail results, and PM data
- Next week's plan

Usage:
    python weekly_report.py                    # Generate report for current week (Mon-Fri)
    python weekly_report.py --date 2026-01-20  # Generate report for week containing that date
    python weekly_report.py --output report.pdf # Custom output filename
"""

import os
import sys
import argparse
from datetime import datetime, timedelta
from io import BytesIO

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.platypus.flowables import HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

from sqlalchemy import func, and_, or_
from database import SessionLocal
from models import Bug, TicketTracking, TestResult, TestCase, TestRun

# Configuration
REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "techversant-logo.png")

# Status categories
BIS_TESTING_STATUSES = ['BIS Testing', 'BIS Testing (Pre)', 'BIS Testing (Prod)', 'UAT', 'User Acceptance Testing']
CLOSED_STATUSES = ['Closed', 'Done', 'Completed', 'Resolved']
IN_PROGRESS_STATUSES = ['In Progress', 'Development', 'In Development', 'QA Testing', 'QC Testing', 'Code Review']
PLANNED_STATUSES = ['Open', 'New', 'To Do', 'Planned', 'Backlog']


def get_week_dates(reference_date=None):
    """Get Monday and Friday of the week containing the reference date"""
    if reference_date is None:
        reference_date = datetime.now()
    elif isinstance(reference_date, str):
        reference_date = datetime.strptime(reference_date, "%Y-%m-%d")
    
    # Find Monday of the week
    monday = reference_date - timedelta(days=reference_date.weekday())
    friday = monday + timedelta(days=4)
    
    # Set times
    week_start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = friday.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    return week_start, week_end


def get_weekly_data(week_start, week_end):
    """Fetch all data needed for the weekly report"""
    db = SessionLocal()
    
    try:
        data = {
            'week_start': week_start,
            'week_end': week_end,
            'tickets_bis_testing': [],
            'tickets_closed': [],
            'tickets_in_progress': [],
            'tickets_planned': [],
            'bugs_summary': {},
            'testrail_summary': {},
            'next_week_plan': []
        }
        
        # Get tickets moved to BIS Testing this week
        # These are tickets that are currently in BIS Testing status AND were updated this week
        bis_testing_tickets_this_week = db.query(TicketTracking).filter(
            TicketTracking.status.in_(BIS_TESTING_STATUSES),
            TicketTracking.updated_on >= week_start,
            TicketTracking.updated_on <= week_end
        ).order_by(TicketTracking.updated_on.desc()).all()
        
        # Get all tickets currently in BIS Testing (for reference)
        all_bis_testing_tickets = db.query(TicketTracking).filter(
            TicketTracking.status.in_(BIS_TESTING_STATUSES)
        ).order_by(TicketTracking.updated_on.desc()).all()
        
        # Get tickets closed this week
        # Strategy: A ticket is considered "closed this week" if:
        # 1. It's in Closed status
        # 2. Its ETA was within this week OR the week before (completed on or around ETA)
        # This is more accurate than using updated_on which gets modified during every sync
        week_before_start = week_start - timedelta(days=7)
        
        closed_tickets_this_week = db.query(TicketTracking).filter(
            TicketTracking.status.in_(CLOSED_STATUSES),
            TicketTracking.eta >= week_before_start,
            TicketTracking.eta <= week_end
        ).order_by(TicketTracking.eta.desc()).all()
        
        # Get tickets currently in progress
        in_progress_tickets = db.query(TicketTracking).filter(
            TicketTracking.status.in_(IN_PROGRESS_STATUSES)
        ).order_by(TicketTracking.updated_on.desc()).all()
        
        # Process BIS Testing tickets - mark which ones moved this week
        bis_testing_ids_this_week = set(t.ticket_id for t in bis_testing_tickets_this_week)
        for ticket in all_bis_testing_tickets:
            ticket_data = get_ticket_details(db, ticket)
            ticket_data['moved_this_week'] = ticket.ticket_id in bis_testing_ids_this_week
            data['tickets_bis_testing'].append(ticket_data)
        
        # Process Closed tickets (only those likely closed this week)
        for ticket in closed_tickets_this_week:
            ticket_data = get_ticket_details(db, ticket)
            ticket_data['moved_this_week'] = True
            data['tickets_closed'].append(ticket_data)
        
        # Process In Progress tickets
        for ticket in in_progress_tickets:
            ticket_data = get_ticket_details(db, ticket)
            data['tickets_in_progress'].append(ticket_data)
        
        # Get planned tickets for next week (ETA in next week)
        next_week_start = week_end + timedelta(days=3)  # Next Monday
        next_week_end = next_week_start + timedelta(days=4)  # Next Friday
        
        planned_tickets = db.query(TicketTracking).filter(
            TicketTracking.eta >= next_week_start,
            TicketTracking.eta <= next_week_end
        ).all()
        
        for ticket in planned_tickets:
            ticket_data = get_ticket_details(db, ticket)
            data['next_week_plan'].append(ticket_data)
        
        # Calculate summary statistics
        data['summary'] = {
            'total_bis_testing': len(data['tickets_bis_testing']),
            'moved_to_bis_this_week': len([t for t in data['tickets_bis_testing'] if t.get('moved_this_week')]),
            'total_closed': len(data['tickets_closed']),
            'total_in_progress': len(data['tickets_in_progress']),
            'planned_next_week': len(data['next_week_plan']),
            'total_bugs_found': 0,
            'total_bugs_fixed': 0,
            'total_test_cases': 0,
            'test_cases_passed': 0,
            'test_cases_failed': 0
        }
        
        # Aggregate bugs and test results
        for tickets_list in [data['tickets_bis_testing'], data['tickets_closed'], data['tickets_in_progress']]:
            for ticket in tickets_list:
                data['summary']['total_bugs_found'] += ticket.get('bugs_count', 0)
                data['summary']['total_bugs_fixed'] += ticket.get('bugs_fixed', 0)
                data['summary']['total_test_cases'] += ticket.get('test_cases_total', 0)
                data['summary']['test_cases_passed'] += ticket.get('test_cases_passed', 0)
                data['summary']['test_cases_failed'] += ticket.get('test_cases_failed', 0)
        
        return data
        
    finally:
        db.close()


def get_ticket_details(db, ticket):
    """Get comprehensive details for a single ticket"""
    ticket_id = ticket.ticket_id
    
    # Get bugs from Redmine
    bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id).all()
    bugs_open = [b for b in bugs if b.status and b.status.lower() not in ['closed', 'resolved', 'verified']]
    bugs_fixed = [b for b in bugs if b.status and b.status.lower() in ['closed', 'resolved', 'verified']]
    
    # Bug severity breakdown
    severity_counts = {}
    for bug in bugs:
        sev = bug.severity or 'Unknown'
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
    
    # Get test results from TestRail
    test_results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
    test_passed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'passed'])
    test_failed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'failed'])
    test_blocked = len([t for t in test_results if t.status_name and t.status_name.lower() == 'blocked'])
    
    # Combine developers
    developers = []
    if ticket.backend_developer:
        developers.append(ticket.backend_developer)
    if ticket.frontend_developer:
        developers.append(ticket.frontend_developer)
    if ticket.developer_assigned:
        developers.append(ticket.developer_assigned)
    developers = list(set(developers))
    
    # QA testers
    qa_testers = []
    if ticket.qc_tester:
        qa_testers.append(ticket.qc_tester)
    qa_testers = list(set(qa_testers))
    
    return {
        'ticket_id': ticket_id,
        'status': ticket.status or 'Unknown',
        'eta': ticket.eta.strftime('%Y-%m-%d') if ticket.eta else 'Not Set',
        'developers': ', '.join(developers) if developers else 'Not Assigned',
        'qa_testers': ', '.join(qa_testers) if qa_testers else 'Not Assigned',
        'dev_estimate': ticket.dev_estimate_hours or 0,
        'dev_actual': ticket.actual_dev_hours or 0,
        'qa_estimate': ticket.qa_estimate_hours or 0,
        'qa_actual': ticket.actual_qa_hours or 0,
        'bugs_count': len(bugs),
        'bugs_open': len(bugs_open),
        'bugs_fixed': len(bugs_fixed),
        'bugs_by_severity': severity_counts,
        'bug_details': [{
            'id': b.bug_id,
            'subject': (b.subject[:50] + '...') if b.subject and len(b.subject) > 50 else (b.subject or 'No Subject'),
            'status': b.status or 'Unknown',
            'severity': b.severity or 'Unknown',
            'assignee': b.assignee or 'Unassigned'
        } for b in bugs[:10]],  # Limit to 10 bugs per ticket
        'test_cases_total': len(test_results),
        'test_cases_passed': test_passed,
        'test_cases_failed': test_failed,
        'test_cases_blocked': test_blocked,
        'updated_on': ticket.updated_on.strftime('%Y-%m-%d %H:%M') if ticket.updated_on else 'Unknown'
    }


def create_styles():
    """Create custom styles for the PDF"""
    styles = getSampleStyleSheet()
    
    styles.add(ParagraphStyle(
        name='ReportTitle',
        parent=styles['Heading1'],
        fontSize=24,
        spaceAfter=30,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1e293b')
    ))
    
    styles.add(ParagraphStyle(
        name='SectionTitle',
        parent=styles['Heading2'],
        fontSize=16,
        spaceBefore=20,
        spaceAfter=10,
        textColor=colors.HexColor('#3b82f6'),
        borderPadding=5
    ))
    
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading3'],
        fontSize=12,
        spaceBefore=15,
        spaceAfter=8,
        textColor=colors.HexColor('#64748b')
    ))
    
    styles.add(ParagraphStyle(
        name='SmallText',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#64748b')
    ))
    
    styles.add(ParagraphStyle(
        name='MetricValue',
        parent=styles['Normal'],
        fontSize=28,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1e293b'),
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='MetricLabel',
        parent=styles['Normal'],
        fontSize=10,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#64748b')
    ))
    
    return styles


def create_summary_table(data, styles):
    """Create the summary metrics section"""
    summary = data['summary']
    
    # Summary metrics in a nice grid
    metrics = [
        [
            Paragraph(f"<b>{summary['moved_to_bis_this_week']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['total_closed']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['total_in_progress']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['planned_next_week']}</b>", styles['MetricValue']),
        ],
        [
            Paragraph("Moved to BIS Testing", styles['MetricLabel']),
            Paragraph("Closed This Week", styles['MetricLabel']),
            Paragraph("In Progress", styles['MetricLabel']),
            Paragraph("Planned Next Week", styles['MetricLabel']),
        ]
    ]
    
    table = Table(metrics, colWidths=[1.8*inch, 1.8*inch, 1.8*inch, 1.8*inch])
    table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#dcfce7')),  # Green for BIS
        ('BACKGROUND', (1, 0), (1, 1), colors.HexColor('#dbeafe')),  # Blue for Closed
        ('BACKGROUND', (2, 0), (2, 1), colors.HexColor('#fef3c7')),  # Yellow for In Progress
        ('BACKGROUND', (3, 0), (3, 1), colors.HexColor('#f3e8ff')),  # Purple for Planned
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 15),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 15),
    ]))
    
    return table


def create_bugs_summary_table(data, styles):
    """Create bugs summary section"""
    summary = data['summary']
    
    metrics = [
        [
            Paragraph(f"<b>{summary['total_bugs_found']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['total_bugs_fixed']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['total_bugs_found'] - summary['total_bugs_fixed']}</b>", styles['MetricValue']),
        ],
        [
            Paragraph("Total Bugs Found", styles['MetricLabel']),
            Paragraph("Bugs Fixed", styles['MetricLabel']),
            Paragraph("Bugs Open", styles['MetricLabel']),
        ]
    ]
    
    table = Table(metrics, colWidths=[2.4*inch, 2.4*inch, 2.4*inch])
    table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#fee2e2')),  # Red for total
        ('BACKGROUND', (1, 0), (1, 1), colors.HexColor('#dcfce7')),  # Green for fixed
        ('BACKGROUND', (2, 0), (2, 1), colors.HexColor('#fef3c7')),  # Yellow for open
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 15),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 15),
    ]))
    
    return table


def create_testrail_summary_table(data, styles):
    """Create TestRail summary section"""
    summary = data['summary']
    
    pass_rate = 0
    if summary['total_test_cases'] > 0:
        pass_rate = round((summary['test_cases_passed'] / summary['total_test_cases']) * 100, 1)
    
    metrics = [
        [
            Paragraph(f"<b>{summary['total_test_cases']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['test_cases_passed']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{summary['test_cases_failed']}</b>", styles['MetricValue']),
            Paragraph(f"<b>{pass_rate}%</b>", styles['MetricValue']),
        ],
        [
            Paragraph("Total Test Cases", styles['MetricLabel']),
            Paragraph("Passed", styles['MetricLabel']),
            Paragraph("Failed", styles['MetricLabel']),
            Paragraph("Pass Rate", styles['MetricLabel']),
        ]
    ]
    
    table = Table(metrics, colWidths=[1.8*inch, 1.8*inch, 1.8*inch, 1.8*inch])
    table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#e0e7ff')),
        ('BACKGROUND', (1, 0), (1, 1), colors.HexColor('#dcfce7')),
        ('BACKGROUND', (2, 0), (2, 1), colors.HexColor('#fee2e2')),
        ('BACKGROUND', (3, 0), (3, 1), colors.HexColor('#dbeafe')),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 15),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 15),
    ]))
    
    return table


def create_tickets_table(tickets, title, styles, show_details=True):
    """Create a detailed tickets table"""
    elements = []
    
    if not tickets:
        elements.append(Paragraph(f"No tickets in {title}", styles['BodyText']))
        return elements
    
    # Header row
    header = ['Ticket ID', 'Status', 'ETA', 'Dev', 'QA', 'Bugs', 'Tests']
    
    # Data rows
    table_data = [header]
    for ticket in tickets:
        bugs_text = f"{ticket['bugs_fixed']}/{ticket['bugs_count']}"
        tests_text = f"{ticket['test_cases_passed']}/{ticket['test_cases_total']}"
        
        row = [
            str(ticket['ticket_id']),
            ticket['status'][:15],
            ticket['eta'],
            ticket['developers'][:20] if len(ticket['developers']) > 20 else ticket['developers'],
            ticket['qa_testers'][:15] if len(ticket['qa_testers']) > 15 else ticket['qa_testers'],
            bugs_text,
            tests_text
        ]
        table_data.append(row)
    
    table = Table(table_data, colWidths=[0.8*inch, 1.1*inch, 0.9*inch, 1.5*inch, 1.2*inch, 0.7*inch, 0.7*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8fafc')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f8fafc'), colors.white]),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]))
    
    elements.append(table)
    
    # Add detailed bug information for BIS Testing tickets
    if show_details:
        for ticket in tickets:
            if ticket.get('bug_details') and len(ticket['bug_details']) > 0:
                elements.append(Spacer(1, 10))
                elements.append(Paragraph(f"<b>Ticket #{ticket['ticket_id']} - Bug Details:</b>", styles['SmallText']))
                
                bug_header = ['Bug ID', 'Subject', 'Status', 'Severity', 'Assignee']
                bug_data = [bug_header]
                
                for bug in ticket['bug_details']:
                    bug_data.append([
                        str(bug['id']),
                        bug['subject'][:40],
                        bug['status'],
                        bug['severity'],
                        bug['assignee'][:15] if len(bug['assignee']) > 15 else bug['assignee']
                    ])
                
                bug_table = Table(bug_data, colWidths=[0.7*inch, 2.5*inch, 0.8*inch, 0.8*inch, 1.2*inch])
                bug_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#64748b')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 7),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
                    ('INNERGRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#e2e8f0')),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ]))
                elements.append(bug_table)
    
    return elements


def generate_pdf_report(data, output_path):
    """Generate the PDF report"""
    styles = create_styles()
    
    # Create the document
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=0.5*inch,
        bottomMargin=0.5*inch
    )
    
    elements = []
    
    # Header with Logo
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=2.5*inch, height=0.6*inch)
            logo.hAlign = 'CENTER'
            elements.append(logo)
            elements.append(Spacer(1, 15))
        except Exception as e:
            print(f"Could not load logo: {e}")
    
    # Title
    week_start = data['week_start'].strftime('%B %d, %Y')
    week_end = data['week_end'].strftime('%B %d, %Y')
    
    elements.append(Paragraph("Weekly QA Report", styles['ReportTitle']))
    elements.append(Paragraph(f"{week_start} - {week_end}", styles['SubSection']))
    elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles['SmallText']))
    elements.append(Spacer(1, 20))
    
    # Divider
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#3b82f6')))
    elements.append(Spacer(1, 20))
    
    # Executive Summary
    elements.append(Paragraph("Executive Summary", styles['SectionTitle']))
    elements.append(create_summary_table(data, styles))
    elements.append(Spacer(1, 20))
    
    # Bugs Summary
    elements.append(Paragraph("Bug Tracking Summary", styles['SectionTitle']))
    elements.append(create_bugs_summary_table(data, styles))
    elements.append(Spacer(1, 20))
    
    # TestRail Summary
    elements.append(Paragraph("Test Execution Summary", styles['SectionTitle']))
    elements.append(create_testrail_summary_table(data, styles))
    elements.append(Spacer(1, 20))
    
    # Page break before detailed sections
    elements.append(PageBreak())
    
    # Tickets Moved to BIS Testing This Week
    elements.append(Paragraph("Tickets Moved to BIS Testing This Week", styles['SectionTitle']))
    bis_this_week = [t for t in data['tickets_bis_testing'] if t.get('moved_this_week')]
    elements.extend(create_tickets_table(bis_this_week, "BIS Testing", styles, show_details=True))
    elements.append(Spacer(1, 20))
    
    # Tickets Closed This Week
    elements.append(Paragraph("Tickets Closed This Week", styles['SectionTitle']))
    elements.extend(create_tickets_table(data['tickets_closed'], "Closed", styles, show_details=False))
    elements.append(Spacer(1, 20))
    
    # Page break
    elements.append(PageBreak())
    
    # All Tickets in BIS Testing
    elements.append(Paragraph("All Tickets Currently in BIS Testing", styles['SectionTitle']))
    elements.extend(create_tickets_table(data['tickets_bis_testing'], "BIS Testing", styles, show_details=True))
    elements.append(Spacer(1, 20))
    
    # Page break
    elements.append(PageBreak())
    
    # In Progress Tickets
    elements.append(Paragraph("Tickets Currently In Progress", styles['SectionTitle']))
    elements.extend(create_tickets_table(data['tickets_in_progress'], "In Progress", styles, show_details=False))
    elements.append(Spacer(1, 20))
    
    # Next Week's Plan
    elements.append(Paragraph("Plan for Next Week", styles['SectionTitle']))
    if data['next_week_plan']:
        elements.extend(create_tickets_table(data['next_week_plan'], "Next Week", styles, show_details=False))
    else:
        elements.append(Paragraph("No tickets currently planned for next week based on ETA dates.", styles['BodyText']))
    
    # Build PDF
    doc.build(elements)
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate Weekly QA Report PDF",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python weekly_report.py                         # Current week's report
    python weekly_report.py --date 2026-01-20       # Report for week containing Jan 20, 2026
    python weekly_report.py --output custom.pdf     # Custom output filename
        """
    )
    parser.add_argument('--date', '-d', type=str, help="Reference date (YYYY-MM-DD) for the week")
    parser.add_argument('--output', '-o', type=str, help="Output PDF filename")
    
    args = parser.parse_args()
    
    # Get week dates
    week_start, week_end = get_week_dates(args.date)
    
    print(f"\n{'='*60}")
    print("Weekly QA Report Generator")
    print(f"{'='*60}")
    print(f"Week: {week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}")
    print(f"{'='*60}\n")
    
    # Fetch data
    print("Fetching data from database...")
    data = get_weekly_data(week_start, week_end)
    
    print(f"  - Tickets in BIS Testing: {len(data['tickets_bis_testing'])}")
    print(f"  - Tickets Closed: {len(data['tickets_closed'])}")
    print(f"  - Tickets In Progress: {len(data['tickets_in_progress'])}")
    print(f"  - Planned for Next Week: {len(data['next_week_plan'])}")
    
    # Create reports folder
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    
    # Generate output filename
    if args.output:
        output_path = args.output
        if not output_path.endswith('.pdf'):
            output_path += '.pdf'
    else:
        output_path = os.path.join(
            REPORTS_FOLDER,
            f"QA_Weekly_Report_{week_start.strftime('%Y%m%d')}_{week_end.strftime('%Y%m%d')}.pdf"
        )
    
    # Generate PDF
    print(f"\nGenerating PDF report...")
    generate_pdf_report(data, output_path)
    
    print(f"\n{'='*60}")
    print(f"SUCCESS: Report generated!")
    print(f"{'='*60}")
    print(f"Output: {output_path}")
    print(f"{'='*60}\n")
    
    return output_path


if __name__ == "__main__":
    main()
