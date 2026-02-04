"""
PM Tracker API Sync Module

Handles synchronization with PM Tracker REST API for ticket data.
Supports authentication via API key, JSON parsing, and error handling.
"""

import requests
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timedelta
import time
from config.pm_tracker_config import (
    PM_API_URL, PM_API_KEY, PM_API_TIMEOUT, PM_API_MAX_RETRIES, PM_API_RETRY_DELAY
)

logger = logging.getLogger("pm_api_sync")


class PMApiClient:
    """Client for PM Tracker REST API"""
    
    def __init__(self, api_url: str = PM_API_URL, api_key: str = PM_API_KEY):
        """
        Initialize PM API client
        
        Args:
            api_url: Base URL for PM API
            api_key: API key for authentication
        """
        self.api_url = api_url
        self.api_key = api_key
        self.timeout = PM_API_TIMEOUT
        self.max_retries = PM_API_MAX_RETRIES
        self.retry_delay = PM_API_RETRY_DELAY
        
    def fetch_tickets(self, **kwargs) -> Tuple[bool, Optional[List[Dict]], str]:
        """
        Fetch ticket data from PM API
        
        Args:
            **kwargs: Additional query parameters to pass to API
            
        Returns:
            Tuple of (success: bool, data: List[Dict] or None, message: str)
        """
        if not self.api_key:
            error_msg = "PM_API_KEY not configured"
            logger.error(error_msg)
            return False, None, error_msg
        
        # API key must be sent as header (authID); not as query param
        headers = {
            "authID": self.api_key,
            "Accept": "application/json",
        }
        
        last_error = None
        for attempt in range(1, self.max_retries + 1):
            try:
                logger.info(f"Fetching PM tickets from API (attempt {attempt}/{self.max_retries})")
                response = requests.get(
                    self.api_url,
                    params=kwargs,
                    timeout=self.timeout,
                    headers=headers
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Handle different response formats
                    tickets = self._parse_response(data)
                    
                    if tickets is not None:
                        logger.info(f"Successfully fetched {len(tickets)} tickets from API")
                        return True, tickets, f"Fetched {len(tickets)} tickets"
                    else:
                        error_msg = "API returned invalid format"
                        logger.error(error_msg)
                        last_error = error_msg
                
                elif response.status_code == 401:
                    error_msg = "API authentication failed (401: Unauthorized). Check API key."
                    logger.error(error_msg)
                    return False, None, error_msg
                
                elif response.status_code == 403:
                    error_msg = "API access denied (403: Forbidden)"
                    logger.error(error_msg)
                    return False, None, error_msg
                
                elif response.status_code == 404:
                    error_msg = "API endpoint not found (404)"
                    logger.error(error_msg)
                    return False, None, error_msg
                
                elif response.status_code >= 500:
                    error_msg = f"API server error ({response.status_code})"
                    logger.warning(error_msg)
                    last_error = error_msg
                    if attempt < self.max_retries:
                        logger.info(f"Retrying in {self.retry_delay} seconds...")
                        time.sleep(self.retry_delay)
                        continue
                    return False, None, error_msg
                
                else:
                    error_msg = f"API returned status {response.status_code}"
                    logger.error(error_msg)
                    last_error = error_msg
                    
            except requests.exceptions.Timeout as e:
                error_msg = f"API request timeout ({self.timeout}s)"
                logger.warning(error_msg)
                last_error = error_msg
                if attempt < self.max_retries:
                    logger.info(f"Retrying in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                    continue
                return False, None, error_msg
                
            except requests.exceptions.ConnectionError as e:
                error_msg = f"Connection error: {str(e)}"
                logger.warning(error_msg)
                last_error = error_msg
                if attempt < self.max_retries:
                    logger.info(f"Retrying in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                    continue
                return False, None, error_msg
                
            except requests.exceptions.RequestException as e:
                error_msg = f"Request error: {str(e)}"
                logger.error(error_msg)
                last_error = error_msg
                if attempt < self.max_retries:
                    logger.info(f"Retrying in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                    continue
                return False, None, error_msg
                
            except Exception as e:
                error_msg = f"Unexpected error: {str(e)}"
                logger.error(error_msg)
                last_error = error_msg
                if attempt < self.max_retries:
                    logger.info(f"Retrying in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                    continue
                return False, None, error_msg
        
        return False, None, last_error or "Failed to fetch tickets after all retries"
    
    def _parse_response(self, data: Any) -> Optional[List[Dict]]:
        """
        Parse API response to extract ticket list
        
        Handles multiple possible response formats:
        - Direct list of tickets: [{"id": ..., "status": ...}, ...]
        - Object with data key: {"data": [...], "count": ...}
        - Object with tickets key: {"tickets": [...]}
        - Object with results key: {"results": [...]}
        
        Args:
            data: Raw API response data
            
        Returns:
            List of ticket dictionaries or None if format is invalid
        """
        if isinstance(data, list):
            # Direct list format
            return data if len(data) == 0 or isinstance(data[0], dict) else None
        
        elif isinstance(data, dict):
            # Check for common response wrapper keys
            for key in ["data", "tickets", "results", "items", "records"]:
                if key in data and isinstance(data[key], list):
                    return data[key]
            
            # If dict has keys that look like ticket IDs/numbers, treat it as a single record
            if "ticket_id" in data or "id" in data:
                return [data]
            
            # Otherwise, unknown format
            return None
        
        return None
    
    def map_api_fields(self, tickets: List[Dict]) -> List[Dict]:
        """
        Map API response fields to TicketTracking database fields
        
        Handles flexible field naming from API and converts to database schema.
        
        Args:
            tickets: List of ticket dictionaries from API
            
        Returns:
            List of mapped ticket dictionaries ready for database insert/update
        """
        mapped_tickets = []
        
        # Field mapping from API to database (case-insensitive, flexible)
        # API uses PascalCase (e.g. TicketNumber, BackendDeveloper, ActualQAQCHours)
        field_map = {
            # ticket_id: API uses "TicketNumber" (PascalCase)
            'ticket_id': ['ticketnumber', 'ticket_id', 'id', 'ticket_number', 'ticket_num', 'number'],
            'title': ['tickettitle', 'title', 'ticket_title', 'subject'],
            'status': ['status', 'ticket_status', 'state'],
            'priority': ['priority', 'ticket_priority'],
            'backend_developer': ['backenddeveloper', 'backend_developer', 'backend', 'backend_dev', 'backend_assigned'],
            'frontend_developer': ['frontenddeveloper', 'frontend_developer', 'frontend', 'frontend_dev', 'frontend_assigned'],
            'qc_tester': ['qctester', 'qc_tester', 'qc', 'tester', 'qa', 'qa_tester'],
            'eta': ['eta', 'due_date', 'deadline', 'expected_completion'],
            'current_assignee': ['currentassignee', 'current_assignee', 'assignee', 'assigned_to', 'owner'],
            'dev_estimate_hours': ['devestimatedhours', 'dev_estimate_hours', 'dev_estimate', 'development_estimate', 'estimate_hours', 'dev_estimate_time'],
            'actual_dev_hours': ['actualdevhours', 'actual_dev_hours', 'actual_development', 'dev_actual', 'development_spent', 'actual_hours'],
            'qa_estimate_hours': ['otherestimatedhours', 'otherestimated', 'other_estimated_hours', 'qaestimatehours', 'qaestimatedhours', 'qatestimatehours', 'qa_estimate_hours', 'qa_estimate', 'qc_estimate', 'qa_estimate_time', 'qc_estimate_hours', 'timeestimatedforqa', 'time_estimated_for_qa', 'qaestimate', 'qatestimate'],
            'actual_qa_hours': ['actualqaqchours', 'actual_qa_hours', 'actual_qa', 'actual_qc', 'qa_spent', 'qa_actual_hours'],
            'developer_assigned': ['developer_assigned', 'developer', 'assigned_developer', 'dev_assigned'],
            'subdepartment': ['subdepartment', 'sub_department', 'sub-department', 'platform', 'type'],
            'updated_on': ['updated_on', 'updated_at', 'last_updated', 'modified_date', 'last_modified'],
            'created_on': ['ticketcreateddate', 'created_on', 'created_at', 'created_date'],
            'closed_on': ['ticketcloseddate', 'closed_on', 'closed_at', 'closed_date'],
        }
        
        # Log first ticket keys for debugging field mapping issues
        if tickets:
            first_keys = list(tickets[0].keys())
            logger.info(f"API response field names (first ticket): {first_keys}")
        
        for ticket in tickets:
            mapped = {}
            
            # Case-insensitive field matching
            ticket_lower = {k.lower(): (k, v) for k, v in ticket.items()}
            
            for db_field, api_variations in field_map.items():
                for api_field in api_variations:
                    api_field_lower = api_field.lower()
                    if api_field_lower in ticket_lower:
                        original_key, value = ticket_lower[api_field_lower]
                        mapped[db_field] = value
                        break
            
            # Fallback: API often uses PascalCase (e.g. "Priority") – ensure we capture it
            if 'priority' not in mapped and 'Priority' in ticket:
                val = ticket.get('Priority')
                if val is not None and str(val).strip():
                    mapped['priority'] = str(val).strip()
            
            if mapped:
                mapped_tickets.append(mapped)
            else:
                # Keep original data if no fields matched
                logger.warning(f"Could not map fields for ticket: {ticket}")
                mapped_tickets.append(ticket)
        
        return mapped_tickets
    
    def test_connection(self) -> Tuple[bool, str]:
        """
        Test API connection and authentication
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        success, data, message = self.fetch_tickets()
        if success:
            count = len(data) if data else 0
            return True, f"Connection successful. Retrieved {count} tickets."
        else:
            return False, message
