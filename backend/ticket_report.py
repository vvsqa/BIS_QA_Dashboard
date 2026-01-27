"""
Individual Ticket Report Generator

Generates a comprehensive PDF report for a single ticket including:
- Ticket tracking details from PM Tool
- All bugs from Redmine
- Test results from TestRail
- Time tracking and team information
"""

import os
import sys
from datetime import datetime
from io import BytesIO

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.platypus.flowables import HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# Logo path
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "techversant-logo.png")

from sqlalchemy import func
from database import SessionLocal
from models import Bug, TicketTracking, TestResult, TestCase, TestRun

# Configuration
REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")


def get_ticket_data(ticket_id):
    """Fetch all data for a single ticket"""
    db = SessionLocal()
    
    try:
        # Get ticket tracking data
        ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
        
        if not ticket:
            return None
        
        # Get all bugs for this ticket
        bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id).order_by(Bug.created_on.desc()).all()
        
        # Get test results
        test_results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
        
        # Categorize bugs
        bugs_by_status = {}
        bugs_by_severity = {}
        bugs_by_environment = {}
        
        for bug in bugs:
            status = bug.status or 'Unknown'
            severity = bug.severity or 'Unknown'
            environment = bug.environment or 'Unknown'
            
            bugs_by_status[status] = bugs_by_status.get(status, 0) + 1
            bugs_by_severity[severity] = bugs_by_severity.get(severity, 0) + 1
            bugs_by_environment[environment] = bugs_by_environment.get(environment, 0) + 1
        
        # Categorize test results
        test_passed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'passed'])
        test_failed = len([t for t in test_results if t.status_name and t.status_name.lower() == 'failed'])
        test_blocked = len([t for t in test_results if t.status_name and t.status_name.lower() == 'blocked'])
        test_untested = len([t for t in test_results if t.status_name and t.status_name.lower() == 'untested'])
        
        # Combine developers
        developers = []
        if ticket.backend_developer:
            developers.append(f"Backend: {ticket.backend_developer}")
        if ticket.frontend_developer:
            developers.append(f"Frontend: {ticket.frontend_developer}")
        if ticket.developer_assigned:
            developers.append(f"Assigned: {ticket.developer_assigned}")
        
        return {
            'ticket_id': ticket_id,
            'ticket': {
                'status': ticket.status or 'Unknown',
                'eta': ticket.eta.strftime('%Y-%m-%d') if ticket.eta else 'Not Set',
                'current_assignee': ticket.current_assignee or 'Unassigned',
                'developers': developers,
                'qc_tester': ticket.qc_tester or 'Not Assigned',
                'dev_estimate_hours': ticket.dev_estimate_hours or 0,
                'actual_dev_hours': ticket.actual_dev_hours or 0,
                'qa_estimate_hours': ticket.qa_estimate_hours or 0,
                'actual_qa_hours': ticket.actual_qa_hours or 0,
                'updated_on': ticket.updated_on.strftime('%Y-%m-%d %H:%M') if ticket.updated_on else 'Unknown'
            },
            'bugs': {
                'total': len(bugs),
                'by_status': bugs_by_status,
                'by_severity': bugs_by_severity,
                'by_environment': bugs_by_environment,
                'list': [{
                    'id': b.bug_id,
                    'subject': b.subject or 'No Subject',
                    'status': b.status or 'Unknown',
                    'severity': b.severity or 'Unknown',
                    'priority': b.priority or 'Unknown',
                    'environment': b.environment or 'Unknown',
                    'assignee': b.assignee or 'Unassigned',
                    'author': b.author or 'Unknown',
                    'created_on': b.created_on.strftime('%Y-%m-%d') if b.created_on else 'Unknown',
                    'updated_on': b.updated_on.strftime('%Y-%m-%d') if b.updated_on else 'Unknown'
                } for b in bugs]
            },
            'tests': {
                'total': len(test_results),
                'passed': test_passed,
                'failed': test_failed,
                'blocked': test_blocked,
                'untested': test_untested,
                'pass_rate': round((test_passed / len(test_results) * 100), 1) if len(test_results) > 0 else 0,
                'list': [{
                    'case_id': t.case_id,
                    'title': t.title or 'No Title',
                    'status': t.status_name or 'Unknown',
                    'assigned_to': t.assigned_to or 'Unassigned',
                    'created_on': t.created_on.strftime('%Y-%m-%d') if t.created_on else 'Unknown'
                } for t in test_results[:50]]  # Limit to 50 test results
            }
        }
        
    finally:
        db.close()


def create_styles():
    """Create custom styles for the PDF"""
    styles = getSampleStyleSheet()
    
    styles.add(ParagraphStyle(
        name='ReportTitle',
        parent=styles['Heading1'],
        fontSize=22,
        spaceAfter=20,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1e293b')
    ))
    
    styles.add(ParagraphStyle(
        name='TicketId',
        parent=styles['Heading1'],
        fontSize=32,
        spaceAfter=10,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#3b82f6')
    ))
    
    styles.add(ParagraphStyle(
        name='SectionTitle',
        parent=styles['Heading2'],
        fontSize=14,
        spaceBefore=20,
        spaceAfter=10,
        textColor=colors.HexColor('#3b82f6'),
        borderPadding=5
    ))
    
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading3'],
        fontSize=11,
        spaceBefore=12,
        spaceAfter=6,
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
        fontSize=24,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1e293b'),
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        name='MetricLabel',
        parent=styles['Normal'],
        fontSize=9,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#64748b')
    ))
    
    return styles


def generate_ticket_pdf(data, output_path):
    """Generate the PDF report for a ticket"""
    styles = create_styles()
    
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
            logo = Image(LOGO_PATH, width=2*inch, height=0.5*inch)
            logo.hAlign = 'CENTER'
            elements.append(logo)
            elements.append(Spacer(1, 10))
        except Exception as e:
            print(f"Could not load logo: {e}")
    
    # Title
    elements.append(Paragraph("Ticket Report", styles['ReportTitle']))
    elements.append(Paragraph(f"#{data['ticket_id']}", styles['TicketId']))
    elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles['SmallText']))
    elements.append(Spacer(1, 15))
    
    # Divider
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#3b82f6')))
    elements.append(Spacer(1, 15))
    
    # Ticket Information Section
    elements.append(Paragraph("Ticket Information", styles['SectionTitle']))
    
    ticket = data['ticket']
    info_data = [
        ['Status', ticket['status'], 'ETA', ticket['eta']],
        ['Current Assignee', ticket['current_assignee'], 'QC Tester', ticket['qc_tester']],
        ['Last Updated', ticket['updated_on'], '', '']
    ]
    
    info_table = Table(info_data, colWidths=[1.5*inch, 2*inch, 1.5*inch, 2*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
        ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#f1f5f9')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 10))
    
    # Developers
    if ticket['developers']:
        elements.append(Paragraph("Development Team:", styles['SubSection']))
        for dev in ticket['developers']:
            elements.append(Paragraph(f"  • {dev}", styles['BodyText']))
    
    elements.append(Spacer(1, 15))
    
    # Time Tracking Section
    elements.append(Paragraph("Time Tracking", styles['SectionTitle']))
    
    dev_variance = (ticket['actual_dev_hours'] or 0) - (ticket['dev_estimate_hours'] or 0)
    qa_variance = (ticket['actual_qa_hours'] or 0) - (ticket['qa_estimate_hours'] or 0)
    
    time_data = [
        ['', 'Estimated', 'Actual', 'Variance'],
        ['Development', f"{ticket['dev_estimate_hours']}h", f"{ticket['actual_dev_hours']}h", f"{'+' if dev_variance > 0 else ''}{dev_variance}h"],
        ['QA/Testing', f"{ticket['qa_estimate_hours']}h", f"{ticket['actual_qa_hours']}h", f"{'+' if qa_variance > 0 else ''}{qa_variance}h"],
    ]
    
    time_table = Table(time_data, colWidths=[1.5*inch, 1.5*inch, 1.5*inch, 1.5*inch])
    time_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#f1f5f9')),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(time_table)
    elements.append(Spacer(1, 20))
    
    # Bug Summary Section
    elements.append(Paragraph(f"Bug Summary ({data['bugs']['total']} bugs)", styles['SectionTitle']))
    
    if data['bugs']['total'] > 0:
        # Summary metrics
        bugs = data['bugs']
        open_bugs = bugs['by_status'].get('New', 0) + bugs['by_status'].get('Open', 0) + bugs['by_status'].get('In Progress', 0)
        closed_bugs = bugs['by_status'].get('Closed', 0) + bugs['by_status'].get('Resolved', 0)
        
        bug_metrics = [
            [
                Paragraph(f"<b>{bugs['total']}</b>", styles['MetricValue']),
                Paragraph(f"<b>{open_bugs}</b>", styles['MetricValue']),
                Paragraph(f"<b>{closed_bugs}</b>", styles['MetricValue']),
            ],
            [
                Paragraph("Total Bugs", styles['MetricLabel']),
                Paragraph("Open", styles['MetricLabel']),
                Paragraph("Closed", styles['MetricLabel']),
            ]
        ]
        
        metrics_table = Table(bug_metrics, colWidths=[2*inch, 2*inch, 2*inch])
        metrics_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#fee2e2')),
            ('BACKGROUND', (1, 0), (1, 1), colors.HexColor('#fef3c7')),
            ('BACKGROUND', (2, 0), (2, 1), colors.HexColor('#dcfce7')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ]))
        elements.append(metrics_table)
        elements.append(Spacer(1, 15))
        
        # By Severity
        if bugs['by_severity']:
            elements.append(Paragraph("By Severity:", styles['SubSection']))
            severity_items = [f"{k}: {v}" for k, v in bugs['by_severity'].items()]
            elements.append(Paragraph("  " + " | ".join(severity_items), styles['BodyText']))
        
        # By Environment
        if bugs['by_environment']:
            elements.append(Paragraph("By Environment:", styles['SubSection']))
            env_items = [f"{k}: {v}" for k, v in bugs['by_environment'].items()]
            elements.append(Paragraph("  " + " | ".join(env_items), styles['BodyText']))
        
        elements.append(Spacer(1, 15))
        
        # Bug List Table
        elements.append(Paragraph("Bug Details:", styles['SubSection']))
        
        bug_header = ['ID', 'Subject', 'Status', 'Severity', 'Assignee']
        bug_data = [bug_header]
        
        for bug in bugs['list'][:20]:  # Limit to 20 bugs
            bug_data.append([
                str(bug['id']),
                bug['subject'][:40] + ('...' if len(bug['subject']) > 40 else ''),
                bug['status'],
                bug['severity'],
                bug['assignee'][:15] if len(bug['assignee']) > 15 else bug['assignee']
            ])
        
        bug_table = Table(bug_data, colWidths=[0.6*inch, 2.8*inch, 0.9*inch, 0.9*inch, 1.2*inch])
        bug_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#ef4444')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fef2f2')]),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#fecaca')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#fecaca')),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(bug_table)
        
        if len(bugs['list']) > 20:
            elements.append(Paragraph(f"... and {len(bugs['list']) - 20} more bugs", styles['SmallText']))
    else:
        elements.append(Paragraph("No bugs reported for this ticket.", styles['BodyText']))
    
    # Page break before test results
    elements.append(PageBreak())
    
    # Test Results Section
    elements.append(Paragraph(f"Test Results ({data['tests']['total']} tests)", styles['SectionTitle']))
    
    if data['tests']['total'] > 0:
        tests = data['tests']
        
        # Test metrics
        test_metrics = [
            [
                Paragraph(f"<b>{tests['total']}</b>", styles['MetricValue']),
                Paragraph(f"<b>{tests['passed']}</b>", styles['MetricValue']),
                Paragraph(f"<b>{tests['failed']}</b>", styles['MetricValue']),
                Paragraph(f"<b>{tests['pass_rate']}%</b>", styles['MetricValue']),
            ],
            [
                Paragraph("Total Tests", styles['MetricLabel']),
                Paragraph("Passed", styles['MetricLabel']),
                Paragraph("Failed", styles['MetricLabel']),
                Paragraph("Pass Rate", styles['MetricLabel']),
            ]
        ]
        
        test_metrics_table = Table(test_metrics, colWidths=[1.5*inch, 1.5*inch, 1.5*inch, 1.5*inch])
        test_metrics_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#e0e7ff')),
            ('BACKGROUND', (1, 0), (1, 1), colors.HexColor('#dcfce7')),
            ('BACKGROUND', (2, 0), (2, 1), colors.HexColor('#fee2e2')),
            ('BACKGROUND', (3, 0), (3, 1), colors.HexColor('#dbeafe')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ]))
        elements.append(test_metrics_table)
        elements.append(Spacer(1, 15))
        
        # Test Results Table
        if tests['list']:
            elements.append(Paragraph("Test Case Details:", styles['SubSection']))
            
            test_header = ['Case ID', 'Title', 'Status', 'Assigned To']
            test_data = [test_header]
            
            for test in tests['list']:
                test_data.append([
                    str(test['case_id']),
                    test['title'][:50] + ('...' if len(test['title']) > 50 else ''),
                    test['status'],
                    test['assigned_to'][:15] if len(test['assigned_to']) > 15 else test['assigned_to']
                ])
            
            test_table = Table(test_data, colWidths=[0.8*inch, 3.5*inch, 0.9*inch, 1.2*inch])
            test_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#eff6ff')]),
                ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#bfdbfe')),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#bfdbfe')),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ]))
            elements.append(test_table)
            
            if data['tests']['total'] > 50:
                elements.append(Paragraph(f"... and {data['tests']['total'] - 50} more test cases", styles['SmallText']))
    else:
        elements.append(Paragraph("No test results found for this ticket.", styles['BodyText']))
    
    # Build PDF
    doc.build(elements)
    return output_path


def generate_ticket_report(ticket_id):
    """Main function to generate a ticket report"""
    print(f"Generating report for ticket #{ticket_id}...")
    
    # Fetch data
    data = get_ticket_data(ticket_id)
    
    if not data:
        print(f"Ticket #{ticket_id} not found")
        return None
    
    # Create reports folder
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    
    # Generate output path
    output_path = os.path.join(
        REPORTS_FOLDER,
        f"Ticket_Report_{ticket_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    )
    
    # Generate PDF
    generate_ticket_pdf(data, output_path)
    
    print(f"Report generated: {output_path}")
    return output_path


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate Ticket Report PDF")
    parser.add_argument('ticket_id', type=int, help="Ticket ID to generate report for")
    
    args = parser.parse_args()
    generate_ticket_report(args.ticket_id)
