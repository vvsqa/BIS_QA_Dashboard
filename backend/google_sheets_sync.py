"""
Google Sheets Sync Service

This module provides functionality to sync timesheet data from Google Sheets
to the database. It supports both QA and Dev team timesheets.

Usage:
    from google_sheets_sync import GoogleSheetsSync
    
    sync = GoogleSheetsSync()
    sync.sync_team("QA")
    sync.sync_team("DEV")
    # or sync both:
    sync.sync_all()
"""

import os
import sys
import logging
from datetime import datetime, date
from typing import Optional, List, Dict, Any
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from google.oauth2 import service_account
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False
    logger.warning("Google API libraries not installed. Run: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")

from sqlalchemy.orm import Session
from sqlalchemy import and_
from database import SessionLocal, engine
from models import EnhancedTimesheet, LeaveEntry, Employee, EmployeeNameMapping
from config.google_sheets_config import (
    GOOGLE_SHEETS_CONFIG, 
    GOOGLE_SCOPES, 
    get_sheet_id, 
    get_sheet_name,
    AUTH_METHOD,
    OAUTH2_CREDENTIALS_FILE,
    OAUTH2_TOKEN_FILE
)


class GoogleSheetsSync:
    """
    Service class for syncing Google Sheets timesheet data to the database.
    """
    
    # Leave type indicators in the data
    LEAVE_TYPES = ['leave', 'wfh', 'holiday', 'sick leave', 'half day', 'casual leave', 
                   'earned leave', 'comp off', 'work from home', 'public holiday']
    
    def __init__(self, credentials_file: Optional[str] = None, auth_method: Optional[str] = None):
        """
        Initialize the Google Sheets sync service.
        
        Args:
            credentials_file: Path to the credentials JSON file.
                            For service_account: service account JSON
                            For oauth2: OAuth2 client credentials JSON
            auth_method: 'service_account' or 'oauth2'. Defaults to config setting.
        """
        self.auth_method = auth_method or AUTH_METHOD
        self.base_path = os.path.dirname(__file__)
        
        if self.auth_method == 'oauth2':
            self.credentials_file = credentials_file or os.path.join(
                self.base_path, OAUTH2_CREDENTIALS_FILE
            )
            self.token_file = os.path.join(self.base_path, OAUTH2_TOKEN_FILE)
        else:
            self.credentials_file = credentials_file or os.path.join(
                self.base_path, GOOGLE_SHEETS_CONFIG["credentials_file"]
            )
        
        self.column_mapping = GOOGLE_SHEETS_CONFIG["column_mapping"]
        self.service = None
        self._credentials = None
    
    def _get_credentials(self):
        """Load credentials based on auth method."""
        if not GOOGLE_API_AVAILABLE:
            raise ImportError("Google API libraries not installed")
        
        if self._credentials is not None:
            return self._credentials
        
        if self.auth_method == 'oauth2':
            self._credentials = self._get_oauth2_credentials()
        else:
            self._credentials = self._get_service_account_credentials()
        
        return self._credentials
    
    def _get_service_account_credentials(self):
        """Load service account credentials."""
        if not os.path.exists(self.credentials_file):
            raise FileNotFoundError(
                f"Service account credentials file not found: {self.credentials_file}\n"
                "Run: python setup_google_credentials.py --credentials <path>"
            )
        
        return service_account.Credentials.from_service_account_file(
            self.credentials_file, 
            scopes=GOOGLE_SCOPES
        )
    
    def _get_oauth2_credentials(self):
        """Load OAuth2 credentials (for personal Google account access)."""
        creds = None
        
        # Check if we have a saved token
        if os.path.exists(self.token_file):
            creds = Credentials.from_authorized_user_file(self.token_file, GOOGLE_SCOPES)
        
        # If no valid credentials, authenticate
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(self.credentials_file):
                    raise FileNotFoundError(
                        f"OAuth2 credentials file not found: {self.credentials_file}\n"
                        "Download OAuth2 Client ID JSON from Google Cloud Console:\n"
                        "APIs & Services -> Credentials -> OAuth 2.0 Client IDs -> Download JSON"
                    )
                
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_file, GOOGLE_SCOPES
                )
                creds = flow.run_local_server(port=0)
            
            # Save the credentials for next run
            with open(self.token_file, 'w') as token:
                token.write(creds.to_json())
        
        return creds
    
    def _get_service(self):
        """Get or create the Google Sheets API service."""
        if self.service is None:
            credentials = self._get_credentials()
            self.service = build('sheets', 'v4', credentials=credentials)
        return self.service
    
    def _parse_date(self, date_value: Any) -> Optional[date]:
        """Parse various date formats from the sheet."""
        if not date_value:
            return None
        
        if isinstance(date_value, date):
            return date_value
        
        if isinstance(date_value, datetime):
            return date_value.date()
        
        # Try common date formats
        # IMPORTANT: US format (M/D/YYYY) is prioritized because Google Sheets uses this format
        date_str = str(date_value).strip()
        date_formats = [
            "%Y-%m-%d",      # ISO format: 2026-01-23
            "%m/%d/%Y",      # US format: 1/23/2026 (prioritized for Google Sheets)
            "%m-%d-%Y",      # US format with dashes: 1-23-2026
            "%d/%m/%Y",      # European format: 23/1/2026
            "%d-%m-%Y",      # European format with dashes: 23-1-2026
            "%Y/%m/%d",      # Alternative ISO: 2026/01/23
            "%d-%b-%Y",      # 23-Jan-2026
            "%d %b %Y",      # 23 Jan 2026
            "%B %d, %Y",     # January 23, 2026
        ]
        
        for fmt in date_formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        
        logger.warning(f"Could not parse date: {date_value}")
        return None
    
    def _parse_hours(self, hours_value: Any) -> float:
        """Parse hours from various formats."""
        if not hours_value:
            return 0.0
        
        if isinstance(hours_value, (int, float)):
            return float(hours_value)
        
        hours_str = str(hours_value).strip()
        
        # Handle HH:MM:SS or HH:MM format
        if ':' in hours_str:
            parts = hours_str.split(':')
            try:
                hours = int(parts[0])
                minutes = int(parts[1]) if len(parts) > 1 else 0
                seconds = int(parts[2]) if len(parts) > 2 else 0
                return hours + (minutes / 60) + (seconds / 3600)
            except (ValueError, IndexError):
                pass
        
        # Try parsing as float
        try:
            return float(hours_str.replace(',', '.'))
        except ValueError:
            logger.warning(f"Could not parse hours: {hours_value}")
            return 0.0
    
    def _is_leave_entry(self, row_data: Dict) -> Optional[str]:
        """
        Check if the row represents a leave entry.
        Returns the leave type if it is, None otherwise.
        """
        # Check dedicated leave type column
        leave_type_val = row_data.get('leave_type') or ''
        leave_type = str(leave_type_val).strip().lower()
        if leave_type and leave_type not in ['', 'none', 'na', 'n/a', '-']:
            return leave_type.title()
        
        # Check ticket_id for leave indicators
        ticket_val = row_data.get('ticket_id') or ''
        ticket_id = str(ticket_val).strip().lower()
        for lt in self.LEAVE_TYPES:
            if lt in ticket_id:
                return lt.title()
        
        # Check task description for leave indicators
        desc_val = row_data.get('task_description') or ''
        description = str(desc_val).strip().lower()
        for lt in self.LEAVE_TYPES:
            if lt in description:
                return lt.title()
        
        return None
    
    def _get_column_index(self, headers: List[str], column_name: str) -> int:
        """Find the index of a column by name (case-insensitive)."""
        column_name_lower = column_name.lower()
        for i, header in enumerate(headers):
            if header and header.lower() == column_name_lower:
                return i
        return -1
    
    def _extract_ticket_id(self, ticket_value: str) -> str:
        """Extract ticket ID from URL - gets the last numeric at the end."""
        if not ticket_value:
            return ''
        
        import re
        ticket_str = str(ticket_value).strip()
        
        # If it's already just a number, return it
        if ticket_str.isdigit():
            return ticket_str
        
        # Extract the last numeric sequence from the end of the string
        # This handles URLs like: https://www.bissafety.app/pm/tickets#!/18492
        # or any URL format where the ticket ID is the last number
        match = re.search(r'(\d+)(?!.*\d)', ticket_str)
        if match:
            return match.group(1)
        
        # Fallback: try common URL patterns
        if '#!/' in ticket_str:
            parts = ticket_str.split('#!/')
            if len(parts) > 1:
                return parts[-1].strip()
        
        if '/tickets/' in ticket_str:
            parts = ticket_str.split('/tickets/')
            if len(parts) > 1:
                return parts[-1].strip().rstrip('/')
        
        return ''
    
    def fetch_sheet_data(self, team: str, months_back: int = 6) -> List[Dict]:
        """
        Fetch data from the Google Sheet for a specific team.
        
        Args:
            team: 'QA' or 'DEV'
            months_back: Only fetch data from the last N months (default 6)
            
        Returns:
            List of dictionaries containing row data
        """
        from dateutil.relativedelta import relativedelta
        
        # Calculate cutoff date (6 months ago from today)
        cutoff_date = date.today() - relativedelta(months=months_back)
        logger.info(f"Fetching data from {cutoff_date} onwards (last {months_back} months)")
        
        service = self._get_service()
        sheet_id = get_sheet_id(team)
        sheet_name = get_sheet_name(team)
        
        if not sheet_id:
            raise ValueError(f"Sheet ID not configured for team: {team}")
        
        try:
            # Read the entire sheet
            range_name = f"'{sheet_name}'"
            result = service.spreadsheets().values().get(
                spreadsheetId=sheet_id,
                range=range_name
            ).execute()
            
            values = result.get('values', [])
            
            if not values or len(values) < 2:
                logger.warning(f"No data found in {team} sheet")
                return []
            
            # Headers are in row 2 (index 1) for this sheet structure
            header_row_idx = GOOGLE_SHEETS_CONFIG.get('header_row', 2) - 1
            if header_row_idx >= len(values):
                header_row_idx = 0
            
            headers = values[header_row_idx]
            logger.info(f"Headers found: {headers}")
            
            # Determine employee column based on team
            employee_col_name = 'Tester' if team.upper() == 'QA' else 'Developer'
            
            # Map column indices
            col_map = {
                'date': self._get_column_index(headers, 'Date'),
                'ticket_id': self._get_column_index(headers, 'Ticket'),
                'task_description': self._get_column_index(headers, 'Task'),
                'status': self._get_column_index(headers, 'Status'),
                'productive_hours': self._get_column_index(headers, 'Productive'),
                'time_spent': self._get_column_index(headers, 'Time Spent'),
                'employee_name': self._get_column_index(headers, employee_col_name),
                'comments': self._get_column_index(headers, 'Comments'),
            }
            
            logger.info(f"Column mapping for {team}: {col_map}")
            
            # Parse data rows (start after header row)
            data = []
            for row_idx, row in enumerate(values[header_row_idx + 1:], start=header_row_idx + 2):
                if not row:  # Skip empty rows
                    continue
                
                # Extract values
                def get_val(col_key):
                    idx = col_map.get(col_key, -1)
                    if idx >= 0 and idx < len(row):
                        return row[idx]
                    return None
                
                date_val = get_val('date')
                employee_name = get_val('employee_name')
                
                # Skip rows without date or employee name
                if not date_val or not employee_name:
                    continue
                
                # Parse the date to check if it's within our cutoff
                parsed_row_date = self._parse_date(date_val)
                if not parsed_row_date:
                    continue  # Skip rows with unparseable dates
                
                # Skip rows older than cutoff date (6 months)
                if parsed_row_date < cutoff_date:
                    continue
                
                # Get hours - Store both Time Spent and Productive Hours separately
                time_spent = get_val('time_spent')
                productive_hours = get_val('productive_hours')
                # Use Time Spent if available (employees), otherwise Productive Hours (leads/managers)
                hours = time_spent if time_spent else (productive_hours if productive_hours else 0)
                
                # Get task description (Column C)
                task = get_val('task_description') or ''
                
                # Determine if this is a leave entry
                task_lower = task.lower().strip()
                leave_type = None
                if any(lt in task_lower for lt in ['leave', 'half day', 'wfh', 'work from home', 'holiday', 'sick']):
                    if 'half day' in task_lower:
                        leave_type = 'Half Day Leave'
                    elif 'sick' in task_lower:
                        leave_type = 'Sick Leave'
                    elif 'wfh' in task_lower or 'work from home' in task_lower:
                        leave_type = 'WFH'
                    else:
                        leave_type = 'Leave'
                
                # Extract ticket ID from URL or use task for generic activities
                ticket_raw = get_val('ticket_id') or ''
                ticket_id = self._extract_ticket_id(ticket_raw)
                
                # If no ticket ID from URL and not a leave, it's a generic activity - use task description
                if not ticket_id and not leave_type:
                    if task:
                        ticket_id = task  # Generic activity - use task as identifier
                    else:
                        ticket_id = 'UNASSIGNED'
                
                row_data = {
                    '_row_number': row_idx,
                    'date': date_val,
                    'employee_name': str(employee_name).strip(),
                    'ticket_id': ticket_id or 'LEAVE' if leave_type else ticket_id,
                    'hours_logged': time_spent if time_spent else 0,  # Time Spent from employees
                    'productive_hours': productive_hours if productive_hours else None,  # Productive Hours from leads
                    'task_description': task,
                    'leave_type': leave_type,
                    'project_name': get_val('status') or '',
                    'comments': get_val('comments') or '',
                }
                
                data.append(row_data)
            
            logger.info(f"Fetched {len(data)} rows from {team} sheet")
            return data
            
        except HttpError as e:
            logger.error(f"Google Sheets API error: {e}")
            raise
    
    def sync_team(self, team: str, db: Optional[Session] = None, months_back: int = 6) -> Dict[str, int]:
        """
        Sync timesheet data for a specific team from Google Sheets to the database.
        
        Args:
            team: 'QA' or 'DEV'
            db: Optional database session (creates one if not provided)
            months_back: Only sync data from the last N months (default 6)
            
        Returns:
            Dictionary with sync statistics
        """
        own_session = False
        if db is None:
            db = SessionLocal()
            own_session = True
        
        stats = {
            'team': team,
            'rows_processed': 0,
            'timesheets_added': 0,
            'timesheets_updated': 0,
            'leaves_added': 0,
            'rows_skipped': 0,
            'errors': 0,
            'synced_at': datetime.utcnow().isoformat(),
            'data_from': (date.today() - __import__('dateutil.relativedelta', fromlist=['relativedelta']).relativedelta(months=months_back)).isoformat()
        }
        
        try:
            # Fetch data from Google Sheets (only last N months)
            rows = self.fetch_sheet_data(team, months_back=months_back)
            stats['rows_processed'] = len(rows)
            
            # Load name mappings for automatic name normalization
            name_mappings = {}
            try:
                mappings = db.query(EmployeeNameMapping).filter(
                    EmployeeNameMapping.is_active == True
                ).all()
                name_mappings = {m.alternate_name: (m.canonical_name, m.employee_id) for m in mappings}
                logger.info(f"Loaded {len(name_mappings)} name mappings")
            except Exception as e:
                logger.warning(f"Could not load name mappings: {e}")
            
            # Track entries seen in this batch to handle duplicates within the sheet
            seen_entries = set()
            
            for row_data in rows:
                try:
                    raw_employee_name = str(row_data.get('employee_name', '')).strip()
                    
                    # Apply name mapping if exists
                    if raw_employee_name in name_mappings:
                        employee_name, mapped_emp_id = name_mappings[raw_employee_name]
                    else:
                        employee_name = raw_employee_name
                        mapped_emp_id = None
                    
                    parsed_date = self._parse_date(row_data.get('date'))
                    
                    if not employee_name or not parsed_date:
                        continue
                    
                    ticket_id_raw = str(row_data.get('ticket_id', '') or '').strip() or 'UNASSIGNED'
                    ticket_id = ticket_id_raw[:150]  # Truncate to fit database column
                    hours_logged = self._parse_hours(row_data.get('hours_logged', 0))
                    productive_hours = self._parse_hours(row_data.get('productive_hours')) if row_data.get('productive_hours') else None
                    task_description = str(row_data.get('task_description', '') or '').strip()
                    project_name = str(row_data.get('project_name', '') or '').strip()[:150]  # Truncate
                    # Use leave_type from fetched data (already detected during fetch)
                    leave_type = row_data.get('leave_type') or self._is_leave_entry(row_data)
                    
                    # Create a unique key for this entry
                    entry_key = (employee_name, ticket_id, parsed_date, team)
                    
                    # Skip if we've already seen this entry in this batch
                    if entry_key in seen_entries:
                        # If duplicate in the sheet, just accumulate hours to the existing entry
                        stats['rows_skipped'] += 1
                        continue
                    
                    seen_entries.add(entry_key)
                    
                    # Find employee ID - use mapped ID if available, otherwise look up
                    if mapped_emp_id:
                        employee_id = mapped_emp_id
                    else:
                        employee = db.query(Employee).filter(
                            Employee.name == employee_name
                        ).first()
                        employee_id = employee.employee_id if employee else None
                    
                    # Create or update enhanced timesheet entry
                    existing = db.query(EnhancedTimesheet).filter(
                        and_(
                            EnhancedTimesheet.employee_name == employee_name,
                            EnhancedTimesheet.ticket_id == ticket_id,
                            EnhancedTimesheet.date == parsed_date,
                            EnhancedTimesheet.team == team
                        )
                    ).first()
                    
                    if existing:
                        # Update existing entry
                        existing.hours_logged = hours_logged
                        existing.productive_hours = productive_hours
                        existing.time_logged_minutes = int((hours_logged or 0) * 60)
                        existing.leave_type = leave_type
                        existing.task_description = task_description
                        existing.project_name = project_name
                        existing.synced_on = datetime.utcnow()
                        existing.employee_id = employee_id
                        stats['timesheets_updated'] += 1
                    else:
                        # Create new entry
                        new_entry = EnhancedTimesheet(
                            employee_id=employee_id,
                            employee_name=employee_name,
                            ticket_id=ticket_id,
                            date=parsed_date,
                            hours_logged=hours_logged,
                            productive_hours=productive_hours,
                            time_logged_minutes=int((hours_logged or 0) * 60),
                            leave_type=leave_type,
                            task_description=task_description,
                            project_name=project_name,
                            team=team,
                            source='google_sheets',
                            sheet_row_id=str(row_data.get('_row_number', '')),
                            synced_on=datetime.utcnow()
                        )
                        db.add(new_entry)
                        stats['timesheets_added'] += 1
                    
                    # Flush periodically to make entries visible to subsequent queries
                    if (stats['timesheets_added'] + stats['timesheets_updated']) % 500 == 0:
                        db.flush()
                    
                    # Create leave entry if this is a leave
                    if leave_type:
                        existing_leave = db.query(LeaveEntry).filter(
                            and_(
                                LeaveEntry.employee_name == employee_name,
                                LeaveEntry.date == parsed_date,
                                LeaveEntry.leave_type == leave_type
                            )
                        ).first()
                        
                        if not existing_leave:
                            leave_entry = LeaveEntry(
                                employee_id=employee_id,
                                employee_name=employee_name,
                                date=parsed_date,
                                leave_type=leave_type,
                                hours=hours if hours > 0 else 8.0,
                                team=team,
                                source='google_sheets'
                            )
                            db.add(leave_entry)
                            stats['leaves_added'] += 1
                    
                except Exception as e:
                    # Rollback the transaction to recover from errors
                    db.rollback()
                    # Only log detailed error for first few errors to avoid log spam
                    if stats['errors'] < 10:
                        logger.error(f"Error processing row {row_data.get('_row_number', '?')}: {e}")
                    stats['errors'] += 1
                    continue
            
            db.commit()
            logger.info(f"Sync completed for {team}: {stats}")
            
        except Exception as e:
            db.rollback()
            logger.error(f"Sync failed for {team}: {e}")
            raise
        
        finally:
            if own_session:
                db.close()
        
        return stats
    
    def sync_all(self, db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Sync both QA and Dev team timesheets.
        
        Returns:
            Dictionary with sync statistics for both teams
        """
        results = {
            'synced_at': datetime.utcnow().isoformat(),
            'teams': {}
        }
        
        for team in ['QA', 'DEV']:
            try:
                stats = self.sync_team(team, db)
                results['teams'][team] = stats
            except Exception as e:
                results['teams'][team] = {
                    'error': str(e),
                    'synced_at': datetime.utcnow().isoformat()
                }
        
        return results
    
    def get_calendar_data(
        self, 
        team: str, 
        start_date: date, 
        end_date: date,
        db: Optional[Session] = None
    ) -> List[Dict]:
        """
        Get calendar data for a date range.
        
        Args:
            team: 'QA' or 'DEV' or 'ALL'
            start_date: Start date of the range
            end_date: End date of the range
            db: Optional database session
            
        Returns:
            List of timesheet entries formatted for calendar display
        """
        own_session = False
        if db is None:
            db = SessionLocal()
            own_session = True
        
        try:
            query = db.query(EnhancedTimesheet).filter(
                and_(
                    EnhancedTimesheet.date >= start_date,
                    EnhancedTimesheet.date <= end_date
                )
            )
            
            if team.upper() != 'ALL':
                query = query.filter(EnhancedTimesheet.team == team.upper())
            
            entries = query.order_by(
                EnhancedTimesheet.employee_name, 
                EnhancedTimesheet.date
            ).all()
            
            # Format for calendar
            calendar_data = []
            for entry in entries:
                calendar_data.append({
                    'id': entry.id,
                    'employee_id': entry.employee_id,
                    'employee_name': entry.employee_name,
                    'date': entry.date.isoformat(),
                    'ticket_id': entry.ticket_id,
                    'hours': entry.hours_logged,
                    'leave_type': entry.leave_type,
                    'task_description': entry.task_description,
                    'project_name': entry.project_name,
                    'team': entry.team
                })
            
            return calendar_data
            
        finally:
            if own_session:
                db.close()


# Convenience functions for API endpoints
def sync_google_sheets(team: Optional[str] = None) -> Dict:
    """
    Convenience function to trigger a sync.
    
    Args:
        team: Optional team to sync ('QA' or 'DEV'). Syncs all if not provided.
    """
    sync = GoogleSheetsSync()
    if team:
        return sync.sync_team(team.upper())
    return sync.sync_all()


def get_sheets_sync_status() -> Dict:
    """Get the current status of Google Sheets sync configuration."""
    base_path = os.path.dirname(__file__)
    
    # Check for credentials based on auth method
    if AUTH_METHOD == 'oauth2':
        # For OAuth2, check for token file (already authenticated) or credentials file
        token_path = os.path.join(base_path, OAUTH2_TOKEN_FILE)
        creds_path = os.path.join(base_path, OAUTH2_CREDENTIALS_FILE)
        credentials_configured = os.path.exists(token_path) or os.path.exists(creds_path)
    else:
        # For service account
        credentials_configured = os.path.exists(
            os.path.join(base_path, GOOGLE_SHEETS_CONFIG["credentials_file"])
        )
    
    status = {
        'google_api_available': GOOGLE_API_AVAILABLE,
        'credentials_configured': credentials_configured,
        'auth_method': AUTH_METHOD,
        'qa_sheet_configured': bool(GOOGLE_SHEETS_CONFIG.get('qa_sheet_id')),
        'dev_sheet_configured': bool(GOOGLE_SHEETS_CONFIG.get('dev_sheet_id')),
        'auto_sync_enabled': GOOGLE_SHEETS_CONFIG.get('auto_sync_enabled', False),
        'sync_interval_minutes': GOOGLE_SHEETS_CONFIG.get('sync_interval_minutes', 5),
        'data_retention_months': 6  # Only sync last 6 months of data
    }
    return status


if __name__ == "__main__":
    # Test the sync
    import argparse
    
    parser = argparse.ArgumentParser(description="Google Sheets Sync")
    parser.add_argument('--team', '-t', choices=['QA', 'DEV', 'ALL'], default='ALL',
                        help="Team to sync")
    parser.add_argument('--status', '-s', action='store_true',
                        help="Show sync configuration status")
    
    args = parser.parse_args()
    
    if args.status:
        status = get_sheets_sync_status()
        print("Google Sheets Sync Status:")
        for key, value in status.items():
            print(f"  {key}: {value}")
    else:
        print(f"Syncing {args.team} team(s)...")
        result = sync_google_sheets(args.team if args.team != 'ALL' else None)
        print(f"Result: {result}")
