"""
Google Sheets Export Module
Exports PM Tool data and TestRail data to Google Sheets.

This syncs data FROM your database TO Google Sheets (opposite of the import in google_sheets_sync.py).

Setup Instructions:
==================
1. Go to Google Cloud Console: https://console.cloud.google.com/

2. Create a new project (or use existing):
   - Click on project dropdown at top
   - Click "New Project"
   - Name it (e.g., "QA Dashboard")
   - Click "Create"

3. Enable the Google Sheets API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click on it and click "Enable"

4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Name: "qa-dashboard-export" (or any name)
   - Click "Create and Continue"
   - Role: Skip (click "Continue")
   - Click "Done"

5. Create a JSON key for the service account:
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the JSON file

6. Save the JSON file:
   - Create folder: backend/credentials/
   - Save the JSON as: backend/credentials/sheets_export_credentials.json

7. Share your Google Sheet with the service account:
   - Open your Google Sheet: https://docs.google.com/spreadsheets/d/1syijUiNk3yfDgdVnZcr2eWJ4RfSghae1zLT741AaTA0
   - Click "Share" button
   - Paste the service account email (found in the JSON file as "client_email")
     It looks like: qa-dashboard-export@your-project.iam.gserviceaccount.com
   - Give it "Editor" access
   - Click "Send" (uncheck "Notify people" if you want)

8. Add these to your .env file:
   SHEETS_EXPORT_CREDENTIALS_FILE=credentials/sheets_export_credentials.json
   SHEETS_EXPORT_SPREADSHEET_ID=1syijUiNk3yfDgdVnZcr2eWJ4RfSghae1zLT741AaTA0
   SHEETS_EXPORT_AUTO_SYNC=true

9. Install required packages (if not already):
   pip install google-auth google-auth-oauthlib google-api-python-client

Sheets Created:
==============
- PM_Tickets: All ticket tracking data from PM Tool
- PM_Status_History: Ticket status change history  
- TestRail_Runs: Test runs from TestRail
- TestRail_Cases: Test cases with automation status
- TestRail_Bugs: Bug tracking data
- TestRail_Results: Test execution results
- _Sync_Info: Sync metadata and timestamps
"""

import os
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Check for Google API availability
try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_EXPORT_AVAILABLE = True
except ImportError:
    GOOGLE_EXPORT_AVAILABLE = False
    logger.warning("Google API not installed. Run: pip install google-auth google-api-python-client")

from sqlalchemy.orm import Session
from models import (
    TicketTracking, TicketStatusHistory,
    AutomationTestCase, AutomationTestRun,
    Bug, TestResult
)

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']


class GoogleSheetsExporter:
    """Exports data from database to Google Sheets."""
    
    def __init__(self, credentials_file: str, spreadsheet_id: str):
        self.credentials_file = credentials_file
        self.spreadsheet_id = spreadsheet_id
        self.service = None
        self._initialize_service()
    
    def _initialize_service(self):
        """Initialize the Google Sheets API service."""
        if not GOOGLE_EXPORT_AVAILABLE:
            logger.error("Google Sheets API libraries not available")
            return
        
        try:
            creds = Credentials.from_service_account_file(
                self.credentials_file,
                scopes=SCOPES
            )
            self.service = build('sheets', 'v4', credentials=creds)
            logger.info("Google Sheets Export service initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Google Sheets service: {e}")
            self.service = None
    
    def _ensure_sheet_exists(self, sheet_name: str) -> bool:
        """Create sheet if it doesn't exist."""
        if not self.service:
            return False
        
        try:
            # Get existing sheets
            spreadsheet = self.service.spreadsheets().get(
                spreadsheetId=self.spreadsheet_id
            ).execute()
            
            existing_sheets = [s['properties']['title'] for s in spreadsheet.get('sheets', [])]
            
            if sheet_name not in existing_sheets:
                # Create new sheet
                request = {
                    'requests': [{
                        'addSheet': {
                            'properties': {'title': sheet_name}
                        }
                    }]
                }
                self.service.spreadsheets().batchUpdate(
                    spreadsheetId=self.spreadsheet_id,
                    body=request
                ).execute()
                logger.info(f"Created sheet: {sheet_name}")
            
            return True
        except HttpError as e:
            logger.error(f"Error ensuring sheet exists: {e}")
            return False
    
    def _clear_sheet(self, sheet_name: str) -> bool:
        """Clear all data from a sheet."""
        if not self.service:
            return False
        
        try:
            self.service.spreadsheets().values().clear(
                spreadsheetId=self.spreadsheet_id,
                range=f"'{sheet_name}'!A:ZZ"
            ).execute()
            return True
        except HttpError as e:
            logger.error(f"Error clearing sheet {sheet_name}: {e}")
            return False
    
    def _sheet_exists(self, sheet_name: str) -> bool:
        """Check if a sheet exists."""
        if not self.service:
            return False
        
        try:
            spreadsheet = self.service.spreadsheets().get(
                spreadsheetId=self.spreadsheet_id
            ).execute()
            existing_sheets = [s['properties']['title'] for s in spreadsheet.get('sheets', [])]
            return sheet_name in existing_sheets
        except HttpError:
            return False
    
    def _create_dashboard_instructions(self):
        """Create dashboard setup instructions sheet if dashboard doesn't exist."""
        # Check if QA_Metrics_Dashboard already exists
        if self._sheet_exists('QA_Metrics_Dashboard'):
            logger.info("Dashboard already exists, skipping instructions")
            return
        
        # Check if instructions sheet already exists
        if self._sheet_exists('_Dashboard_Setup'):
            logger.info("Dashboard setup instructions already exist")
            return
        
        instructions = [
            ["QA Metrics Dashboard - Setup Instructions"],
            [""],
            ["Follow these steps to enable the interactive QA Metrics Dashboard:"],
            [""],
            ["STEP 1: Open Apps Script"],
            ["  - Go to Extensions > Apps Script in the menu bar"],
            [""],
            ["STEP 2: Copy the Script"],
            ["  - Delete any existing code in the script editor"],
            ["  - Copy the entire contents from: backend/google_sheets_apps_script.js"],
            ["  - Paste it into the Apps Script editor"],
            [""],
            ["STEP 3: Save and Run"],
            ["  - Click the Save button (Ctrl+S)"],
            ["  - Select 'setupDashboard' from the function dropdown"],
            ["  - Click the Run button"],
            ["  - Grant permissions when prompted"],
            [""],
            ["STEP 4: Use the Dashboard"],
            ["  - A new 'QA_Metrics_Dashboard' tab will be created"],
            ["  - Use the time period dropdown to filter data"],
            ["  - The dashboard auto-updates when you change filters"],
            [""],
            ["FEATURES:"],
            ["  - 4 Key QA Metrics: QC Cycle Time, Test Cycle Time, Testing Cycles, Waiting Time"],
            ["  - Time Periods: Past Week, Month, Quarter, Year, All Time, or Custom Range"],
            ["  - Ticket List: Shows all tickets in the selected period with individual metrics"],
            ["  - Auto-refresh: Metrics update when data is synced or filters change"],
            [""],
            ["NOTE: After setup, you can delete this '_Dashboard_Setup' sheet."],
            [""],
            ["For the Apps Script code, see:"],
            ["https://github.com/vvsqa/BIS_QA_Dashboard/blob/main/backend/google_sheets_apps_script.js"],
        ]
        
        try:
            self._write_data("_Dashboard_Setup", instructions)
            logger.info("Created dashboard setup instructions sheet")
        except Exception as e:
            logger.warning(f"Could not create dashboard instructions: {e}")
    
    def _write_data(self, sheet_name: str, data: List[List[Any]]) -> bool:
        """Write data to a sheet (first row = headers)."""
        if not self.service:
            logger.error("Google Sheets service not initialized")
            return False
        
        if not data:
            logger.warning(f"No data to write to {sheet_name}")
            return True
        
        try:
            self._ensure_sheet_exists(sheet_name)
            self._clear_sheet(sheet_name)
            
            body = {'values': data}
            result = self.service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"'{sheet_name}'!A1",
                valueInputOption='USER_ENTERED',
                body=body
            ).execute()
            
            logger.info(f"Wrote {len(data)} rows to {sheet_name}")
            return True
            
        except HttpError as e:
            logger.error(f"Error writing to {sheet_name}: {e}")
            return False
    
    def _fmt_dt(self, dt) -> str:
        """Format datetime for sheets."""
        if dt is None:
            return ""
        if hasattr(dt, 'strftime'):
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        return str(dt)
    
    def _fmt_date(self, dt) -> str:
        """Format date for sheets."""
        if dt is None:
            return ""
        if hasattr(dt, 'strftime'):
            return dt.strftime("%Y-%m-%d")
        return str(dt)
    
    def export_pm_tickets(self, db: Session) -> Dict[str, Any]:
        """Export all PM tickets to sheet."""
        try:
            tickets = db.query(TicketTracking).order_by(
                TicketTracking.ticket_id.desc()
            ).all()
            
            headers = [
                "Ticket ID", "Title", "Status", "Priority", "Subdepartment",
                "Backend Developer", "Frontend Developer", "QC Tester",
                "Current Assignee", "ETA", "Dev Estimate (hrs)", "Actual Dev (hrs)",
                "QA Estimate (hrs)", "Actual QA (hrs)", "Created On", "Updated On",
                "Closed On", "In PM Tracker", "Last PM Sync"
            ]
            
            rows = [headers]
            for t in tickets:
                rows.append([
                    t.ticket_id,
                    t.title or "",
                    t.status or "",
                    t.priority or "",
                    t.subdepartment or "",
                    t.backend_developer or "",
                    t.frontend_developer or "",
                    t.qc_tester or "",
                    t.current_assignee or "",
                    self._fmt_dt(t.eta),
                    t.dev_estimate_hours or "",
                    t.actual_dev_hours or "",
                    t.qa_estimate_hours or "",
                    t.actual_qa_hours or "",
                    self._fmt_dt(t.created_on),
                    self._fmt_dt(t.updated_on),
                    self._fmt_dt(t.closed_on),
                    "Yes" if t.in_pm_tracker else "No",
                    self._fmt_dt(t.last_pm_sync)
                ])
            
            success = self._write_data("PM_Tickets", rows)
            return {"success": success, "rows": len(tickets)}
            
        except Exception as e:
            logger.error(f"Error exporting PM tickets: {e}")
            return {"success": False, "error": str(e)}
    
    def export_pm_status_history(self, db: Session) -> Dict[str, Any]:
        """Export ticket status history to sheet.
        
        Uses PM Activity Export file (same source as web app QA Metrics dashboard)
        for consistency. Falls back to database if file not found.
        """
        try:
            from pathlib import Path
            import json
            
            # Try to use PM Activity Export file first (same as web app)
            reports_dir = Path("reports")
            export_files = list(reports_dir.glob("PM_Activity_Export_*.csv"))
            
            if export_files:
                # Use the latest PM Activity Export file
                latest_export = max(export_files, key=lambda f: f.stat().st_mtime)
                logger.info(f"Using PM Activity Export file: {latest_export}")
                
                with open(latest_export, 'r', encoding='utf-8') as f:
                    raw_data = json.load(f)
                
                headers = [
                    "Ticket ID", "Previous Status", "New Status", "Changed On",
                    "Current Assignee", "QC Tester", "Duration in Previous (hrs)", "Source"
                ]
                
                rows = [headers]
                for record in raw_data:
                    rows.append([
                        record.get('ticketId', ''),
                        record.get('oldStatus', ''),
                        record.get('newStatus', ''),
                        record.get('statusChangeDate', ''),
                        record.get('currentAssignee', ''),
                        record.get('qcTester', ''),
                        '',  # Duration not in this format
                        'PM Activity Export'
                    ])
                
                success = self._write_data("PM_Status_History", rows)
                return {"success": success, "rows": len(raw_data), "source": "PM_Activity_Export"}
            
            else:
                # Fallback to database
                logger.warning("No PM Activity Export file found, using database")
                history = db.query(TicketStatusHistory).order_by(
                    TicketStatusHistory.changed_on.desc()
                ).limit(50000).all()
                
                headers = [
                    "Ticket ID", "Previous Status", "New Status", "Changed On",
                    "Current Assignee", "QC Tester", "Duration in Previous (hrs)", "Source"
                ]
                
                rows = [headers]
                for h in history:
                    rows.append([
                        h.ticket_id,
                        h.previous_status or "",
                        h.new_status or "",
                        self._fmt_dt(h.changed_on),
                        h.current_assignee or "",
                        h.qc_tester or "",
                        h.duration_in_previous_status or "",
                        h.source or ""
                    ])
                
                success = self._write_data("PM_Status_History", rows)
                return {"success": success, "rows": len(history), "source": "database"}
            
        except Exception as e:
            logger.error(f"Error exporting status history: {e}")
            return {"success": False, "error": str(e)}
    
    def export_testrail_runs(self, db: Session) -> Dict[str, Any]:
        """Export TestRail runs to sheet."""
        try:
            runs = db.query(AutomationTestRun).order_by(
                AutomationTestRun.created_on.desc()
            ).all()
            
            headers = [
                "Run ID", "Plan ID", "Ticket ID", "Name", "Description",
                "Status", "Created On", "Updated On"
            ]
            
            rows = [headers]
            for r in runs:
                rows.append([
                    r.run_id,
                    r.plan_id or "",
                    r.ticket_id or "",
                    r.name or "",
                    (r.description or "")[:500],
                    r.status or "",
                    self._fmt_dt(r.created_on),
                    self._fmt_dt(r.updated_on)
                ])
            
            success = self._write_data("TestRail_Runs", rows)
            return {"success": success, "rows": len(runs)}
            
        except Exception as e:
            logger.error(f"Error exporting TestRail runs: {e}")
            return {"success": False, "error": str(e)}
    
    def export_testrail_cases(self, db: Session) -> Dict[str, Any]:
        """Export TestRail test cases to sheet."""
        try:
            cases = db.query(AutomationTestCase).order_by(
                AutomationTestCase.ticket_id.desc(),
                AutomationTestCase.case_id.asc()
            ).all()
            
            headers = [
                "Case ID", "Test ID", "Run ID", "Ticket ID", "Title", "Section",
                "Priority", "Automation Status", "Automation Candidate", "Execution Method",
                "Reusability", "Maintenance", "Status", "Business Criticality",
                "Functionality", "Sub-Functionality", "Life Cycle Status",
                "Est. Hours", "Actual Hours", "Planned On", "Automated On",
                "Created On", "Updated On"
            ]
            
            rows = [headers]
            for c in cases:
                rows.append([
                    c.case_id,
                    c.test_id,
                    c.run_id or "",
                    c.ticket_id or "",
                    c.title or "",
                    c.section or "",
                    c.priority or "",
                    c.automation_status or "",
                    c.automation_candidate or "",
                    c.execution_method or "",
                    c.reusability_frequency or "",
                    c.automation_maintenance or "",
                    c.status_name or "",
                    c.business_criticality or "",
                    c.functionality or "",
                    c.sub_functionality or "",
                    c.life_cycle_status or "",
                    c.automation_estimated_hours or "",
                    c.automation_actual_hours or "",
                    self._fmt_dt(c.planned_on),
                    self._fmt_dt(c.automated_on),
                    self._fmt_dt(c.created_on),
                    self._fmt_dt(c.updated_on)
                ])
            
            success = self._write_data("TestRail_Cases", rows)
            return {"success": success, "rows": len(cases)}
            
        except Exception as e:
            logger.error(f"Error exporting TestRail cases: {e}")
            return {"success": False, "error": str(e)}
    
    def export_bugs(self, db: Session) -> Dict[str, Any]:
        """Export bugs to sheet."""
        try:
            bugs = db.query(Bug).order_by(Bug.created_on.desc()).all()
            
            headers = [
                "Bug ID", "Ticket ID", "Subject", "Status", "Priority", "Severity",
                "Environment", "Assignee", "Author", "Module", "Feature",
                "Platform", "Browser", "OS", "Project",
                "Created On", "Updated On", "Closed On"
            ]
            
            rows = [headers]
            for b in bugs:
                rows.append([
                    b.bug_id,
                    b.ticket_id or "",
                    b.subject or "",
                    b.status or "",
                    b.priority or "",
                    b.severity or "",
                    b.environment or "",
                    b.assignee or "",
                    b.author or "",
                    b.module or "",
                    b.feature or "",
                    b.platform or "",
                    b.browser or "",
                    b.os or "",
                    b.project or "",
                    self._fmt_dt(b.created_on),
                    self._fmt_dt(b.updated_on),
                    self._fmt_dt(b.closed_on)
                ])
            
            success = self._write_data("TestRail_Bugs", rows)
            return {"success": success, "rows": len(bugs)}
            
        except Exception as e:
            logger.error(f"Error exporting bugs: {e}")
            return {"success": False, "error": str(e)}
    
    def export_test_results(self, db: Session) -> Dict[str, Any]:
        """Export test results to sheet."""
        try:
            results = db.query(TestResult).order_by(
                TestResult.created_on.desc()
            ).limit(15000).all()
            
            headers = [
                "Test ID", "Run ID", "Case ID", "Ticket ID",
                "Status ID", "Status Name", "Assigned To", "Created On"
            ]
            
            rows = [headers]
            for r in results:
                rows.append([
                    r.test_id,
                    r.run_id or "",
                    r.case_id or "",
                    r.ticket_id or "",
                    r.status_id or "",
                    r.status_name or "",
                    r.assigned_to or "",
                    self._fmt_dt(r.created_on)
                ])
            
            success = self._write_data("TestRail_Results", rows)
            return {"success": success, "rows": len(results)}
            
        except Exception as e:
            logger.error(f"Error exporting test results: {e}")
            return {"success": False, "error": str(e)}
    
    def export_all(self, db: Session) -> Dict[str, Any]:
        """Export all data to Google Sheets."""
        results = {
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "sheets": {},
            "errors": []
        }
        
        if not self.service:
            results["success"] = False
            results["errors"].append("Google Sheets service not initialized. Check credentials.")
            return results
        
        # Write sync info
        try:
            export_interval = int(os.getenv("SHEETS_EXPORT_INTERVAL_MINUTES", "30"))
            sync_info = [
                ["QA Dashboard - Data Export"],
                [""],
                ["Last Sync", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
                ["Sync Frequency", f"Every {export_interval} minutes"],
                ["Next Sync", f"~{datetime.now().strftime('%H:%M')} + {export_interval} min"],
                [""],
                ["Sheet", "Description", "Data Source"],
                ["PM_Tickets", "All tickets from PM Tool", "PM Tracker API"],
                ["PM_Status_History", "Ticket status change history", "PM Tracker API"],
                ["QC_With_QA", "Tickets currently with QA team, by module", "PM Tracker API (live)"],
                ["QC_With_Dev", "Tickets currently with Dev team (upcoming for QA), by module", "PM Tracker API (live)"],
                ["TestRail_Runs", "Test runs", "TestRail Project 18"],
                ["TestRail_Cases", "Test cases with automation status", "TestRail Project 18"],
                ["TestRail_Bugs", "Bug tracking data", "Redmine"],
            ]
            self._write_data("_Sync_Info", sync_info)
        except Exception as e:
            logger.warning(f"Could not update sync info: {e}")
        
        # Export PM data
        logger.info("Exporting PM Tickets...")
        pm_result = self.export_pm_tickets(db)
        results["sheets"]["PM_Tickets"] = pm_result
        if not pm_result.get("success"):
            results["errors"].append(f"PM_Tickets: {pm_result.get('error', 'Unknown error')}")
        
        logger.info("Exporting PM Status History...")
        history_result = self.export_pm_status_history(db)
        results["sheets"]["PM_Status_History"] = history_result
        if not history_result.get("success"):
            results["errors"].append(f"PM_Status_History: {history_result.get('error', 'Unknown error')}")
        
        # Export TestRail data
        logger.info("Exporting TestRail Runs...")
        runs_result = self.export_testrail_runs(db)
        results["sheets"]["TestRail_Runs"] = runs_result
        if not runs_result.get("success"):
            results["errors"].append(f"TestRail_Runs: {runs_result.get('error', 'Unknown error')}")
        
        logger.info("Exporting TestRail Cases...")
        cases_result = self.export_testrail_cases(db)
        results["sheets"]["TestRail_Cases"] = cases_result
        if not cases_result.get("success"):
            results["errors"].append(f"TestRail_Cases: {cases_result.get('error', 'Unknown error')}")
        
        logger.info("Exporting Bugs...")
        bugs_result = self.export_bugs(db)
        results["sheets"]["TestRail_Bugs"] = bugs_result
        if not bugs_result.get("success"):
            results["errors"].append(f"TestRail_Bugs: {bugs_result.get('error', 'Unknown error')}")

        # Export QC pipeline (live PM API view by module)
        logger.info("Exporting QC Pipeline (with-QA / with-Dev) by module...")
        try:
            from push_qc_pipeline_to_sheets import export_qc_pipeline
            qc_result = export_qc_pipeline(self)
            for tab, info in (qc_result.get("tabs") or {}).items():
                results["sheets"][tab] = info
                if not info.get("success"):
                    results["errors"].append(f"{tab}: failed to write")
            if not qc_result.get("success") and qc_result.get("error"):
                results["errors"].append(f"QC Pipeline: {qc_result['error']}")
        except Exception as e:
            logger.error(f"QC Pipeline export failed: {e}")
            results["errors"].append(f"QC Pipeline: {e}")

        # Create dashboard setup instructions (only if not exists)
        logger.info("Checking dashboard setup...")
        self._create_dashboard_instructions()
        
        results["success"] = len(results["errors"]) == 0
        
        total_rows = sum(s.get("rows", 0) for s in results["sheets"].values())
        logger.info(f"Export completed. Total rows: {total_rows}. Errors: {len(results['errors'])}")
        
        return results


def get_sheets_exporter() -> Optional[GoogleSheetsExporter]:
    """Get exporter instance from environment variables."""
    credentials_file = os.getenv("SHEETS_EXPORT_CREDENTIALS_FILE")
    spreadsheet_id = os.getenv("SHEETS_EXPORT_SPREADSHEET_ID")
    
    if not credentials_file or not spreadsheet_id:
        logger.info("Sheets export not configured (missing SHEETS_EXPORT_CREDENTIALS_FILE or SHEETS_EXPORT_SPREADSHEET_ID)")
        return None
    
    # Normalize path separators for Windows
    credentials_file = credentials_file.replace("/", os.sep).replace("\\", os.sep)
    
    # Handle relative path
    if not os.path.isabs(credentials_file):
        credentials_file = os.path.join(os.path.dirname(__file__), credentials_file)
    
    # Normalize the final path
    credentials_file = os.path.normpath(credentials_file)
    
    if not os.path.exists(credentials_file):
        logger.error(f"Credentials file not found: {credentials_file}")
        return None
    
    return GoogleSheetsExporter(credentials_file, spreadsheet_id)


# Scheduler for hourly export
_export_scheduler = None
_exporter_instance = None


def _run_export_job():
    """Execute the export job."""
    global _exporter_instance
    
    if not _exporter_instance:
        logger.warning("Exporter not initialized")
        return
    
    logger.info(f"[Sheets Export] Starting scheduled export at {datetime.now()}")
    
    try:
        from database import SessionLocal
        db = SessionLocal()
        try:
            result = _exporter_instance.export_all(db)
            if result["success"]:
                logger.info(f"[Sheets Export] Completed successfully")
            else:
                logger.error(f"[Sheets Export] Errors: {result['errors']}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[Sheets Export] Error: {e}")


def start_sheets_export_scheduler() -> bool:
    """Start periodic export scheduler (default: every 30 minutes)."""
    global _export_scheduler, _exporter_instance
    
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    
    auto_sync = os.getenv("SHEETS_EXPORT_AUTO_SYNC", "false").lower() == "true"
    
    if not auto_sync:
        logger.info("[Sheets Export] Auto-export disabled (set SHEETS_EXPORT_AUTO_SYNC=true)")
        return False
    
    if not GOOGLE_EXPORT_AVAILABLE:
        logger.warning("[Sheets Export] Google API not available")
        return False
    
    _exporter_instance = get_sheets_exporter()
    if not _exporter_instance:
        logger.warning("[Sheets Export] Could not initialize exporter")
        return False
    
    # Get export interval from env (default 30 minutes)
    export_interval_minutes = int(os.getenv("SHEETS_EXPORT_INTERVAL_MINUTES", "30"))
    export_interval_minutes = max(5, min(export_interval_minutes, 1440))  # Between 5 mins and 24 hours
    
    _export_scheduler = BackgroundScheduler()
    _export_scheduler.add_job(
        _run_export_job,
        trigger=IntervalTrigger(minutes=export_interval_minutes),
        id="sheets_export",
        name="Google Sheets Export",
        replace_existing=True
    )
    _export_scheduler.start()
    
    logger.info(f"[Sheets Export] Scheduler started (every {export_interval_minutes} minutes)")
    
    # Run initial export
    logger.info("[Sheets Export] Running initial export...")
    _run_export_job()
    
    return True


def stop_sheets_export_scheduler():
    """Stop the export scheduler."""
    global _export_scheduler
    if _export_scheduler:
        _export_scheduler.shutdown(wait=False)
        _export_scheduler = None
        logger.info("[Sheets Export] Scheduler stopped")


def trigger_manual_export() -> Dict[str, Any]:
    """Manually trigger an export."""
    exporter = get_sheets_exporter()
    if not exporter:
        return {"success": False, "error": "Exporter not configured"}
    
    from database import SessionLocal
    db = SessionLocal()
    try:
        return exporter.export_all(db)
    finally:
        db.close()
