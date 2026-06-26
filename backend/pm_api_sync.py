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
    PM_API_URL,
    PM_API_KEY,
    PM_API_V2,
    PM_API_URL_V2,
    PM_API_KEY_V2,
    PM_API_TIMEOUT,
    PM_API_MAX_RETRIES,
    PM_API_RETRY_DELAY,
)

logger = logging.getLogger("pm_api_sync")


class PMApiClient:
    """Client for PM Tracker REST API"""
    
    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        use_v2: bool = PM_API_V2,
    ):
        """
        Initialize PM API client
        
        Args:
            api_url: Override URL for PM API
            api_key: Override key/token for PM API
            use_v2: If true, use v2 endpoint + Bearer token auth
        """
        self.use_v2 = use_v2
        self.api_url = api_url if api_url is not None else (PM_API_URL_V2 if use_v2 else PM_API_URL)
        self.api_key = api_key if api_key is not None else (PM_API_KEY_V2 if use_v2 else PM_API_KEY)
        self.timeout = PM_API_TIMEOUT
        self.max_retries = PM_API_MAX_RETRIES
        self.retry_delay = PM_API_RETRY_DELAY
        
    def fetch_tickets(self, ticket_id: Optional[int] = None, **kwargs) -> Tuple[bool, Optional[List[Dict]], str]:
        """
        Fetch ticket data from PM API.
        If ticket_id is provided, pass it as a query param so the API may return only that ticket (faster).
        Response is always filtered to that ticket when ticket_id is set.
        
        Args:
            ticket_id: Optional single ticket to fetch (sends TicketNumber/ticketId query param if supported).
            **kwargs: Additional query parameters to pass to API
            
        Returns:
            Tuple of (success: bool, data: List[Dict] or None, message: str)
        """
        if not self.api_key:
            error_msg = "PM_API_KEY_V2 not configured" if self.use_v2 else "PM_API_KEY not configured"
            logger.error(error_msg)
            return False, None, error_msg
        
        headers = {"Accept": "application/json"}
        # v1 expects authID header; v2 expects Bearer token
        if self.use_v2:
            headers["Authorization"] = f"Bearer {self.api_key}"
        else:
            headers["authID"] = self.api_key
        params = dict(kwargs)
        if ticket_id is not None:
            # Many PM APIs support filtering by ticket; try common param names
            if "TicketNumber" not in params and "ticketId" not in params and "ticket_id" not in params:
                params["TicketNumber"] = ticket_id

        last_error = None
        for attempt in range(1, self.max_retries + 1):
            # Exponential backoff: 0s, 5s, 15s (base_delay * 3^(attempt-2))
            if attempt > 1:
                backoff_delay = self.retry_delay * (3 ** (attempt - 2))
                backoff_delay = min(backoff_delay, 60)  # cap at 60s
                logger.info(f"Retrying in {backoff_delay} seconds (exponential backoff)...")
                time.sleep(backoff_delay)

            # Increase timeout on retries: 30s, 45s, 60s
            attempt_timeout = self.timeout + ((attempt - 1) * 15)

            try:
                logger.info(
                    f"Fetching PM tickets from API (v{'2' if self.use_v2 else '1'}, attempt {attempt}/{self.max_retries}, timeout={attempt_timeout}s)"
                    + (f" ticket_id={ticket_id}" if ticket_id else "")
                )
                response = requests.get(
                    self.api_url,
                    params=params,
                    timeout=attempt_timeout,
                    headers=headers
                )

                if response.status_code == 200:
                    data = response.json()

                    # Handle different response formats
                    tickets = self._parse_response(data)

                    if tickets is not None:
                        if ticket_id is not None:
                            # Keep only the requested ticket (API may still return all)
                            def _tid(t):
                                v = t.get("ticket_id") or t.get("id") or t.get("TicketNumber") or t.get("ticket_number")
                                try:
                                    return int(v) == int(ticket_id)
                                except (TypeError, ValueError):
                                    return v == ticket_id
                            tickets = [t for t in tickets if _tid(t)]
                        logger.info(f"Successfully fetched {len(tickets)} tickets from API")
                        return True, tickets, f"Fetched {len(tickets)} tickets"
                    else:
                        error_msg = "API returned invalid format"
                        logger.error(error_msg)
                        last_error = error_msg

                elif response.status_code in (401, 403):
                    # Auth failures: do NOT retry — fail immediately so health tracker
                    # can escalate and prompt re-authentication
                    error_msg = (
                        f"API authentication failed ({response.status_code}). "
                        + ("Check PM_API_KEY_V2 Bearer token." if self.use_v2 else "Check PM_API_KEY or re-run MFA login.")
                        + " Re-authentication may be required."
                    )
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
                    if attempt >= self.max_retries:
                        return False, None, error_msg
                    continue

                else:
                    error_msg = f"API returned status {response.status_code}"
                    logger.error(error_msg)
                    last_error = error_msg

            except requests.exceptions.Timeout:
                error_msg = f"API request timeout ({attempt_timeout}s)"
                logger.warning(error_msg)
                last_error = error_msg
                if attempt >= self.max_retries:
                    return False, None, error_msg
                continue

            except requests.exceptions.ConnectionError as e:
                error_msg = f"Connection error: {str(e)}"
                logger.warning(error_msg)
                last_error = error_msg
                if attempt >= self.max_retries:
                    return False, None, error_msg
                continue

            except requests.exceptions.RequestException as e:
                error_msg = f"Request error: {str(e)}"
                logger.error(error_msg)
                last_error = error_msg
                if attempt >= self.max_retries:
                    return False, None, error_msg
                continue

            except Exception as e:
                error_msg = f"Unexpected error: {str(e)}"
                logger.error(error_msg)
                last_error = error_msg
                if attempt >= self.max_retries:
                    return False, None, error_msg
                continue

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
            'eta': ['eta', 'due_date', 'deadline', 'expected_completion', 'expectedcompletiondate', 'expected_completion_date', 'targetdate', 'target_date', 'completiondate', 'completion_date', 'targetcompletiondate'],
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
            
            # Fallback: API often uses PascalCase – ensure we capture common fields
            if 'priority' not in mapped and 'Priority' in ticket:
                val = ticket.get('Priority')
                if val is not None and str(val).strip():
                    mapped['priority'] = str(val).strip()
            if 'eta' not in mapped:
                for pascal in ('ETA', 'ExpectedCompletionDate', 'TargetDate', 'DueDate', 'CompletionDate', 'ExpectedCompletion'):
                    val = ticket.get(pascal)
                    if val is not None and (isinstance(val, (str, datetime)) or (isinstance(val, (int, float)) and val)):
                        mapped['eta'] = val
                        break
            
            # v2 returns developer fields as numeric user IDs — resolve to names.
            try:
                import pm_user_map
                for _df in ('backend_developer', 'frontend_developer'):
                    if mapped.get(_df) not in (None, ''):
                        mapped[_df] = pm_user_map.resolve(mapped[_df])
            except Exception:
                pass

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
