import requests
import base64
import json
import os
from sqlalchemy.orm import Session
from database import SessionLocal
from models import TestPlan, TestRun, TestCase, TestResult
from datetime import datetime
import re
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import html

# TestRail Configuration
TESTRAIL_URL = os.getenv("TESTRAIL_URL", "https://bistrainer.testrail.io")
TESTRAIL_EMAIL = os.getenv("TESTRAIL_EMAIL", "vishnu.vs@techversantinfotech.com")
TESTRAIL_API_KEY = os.getenv("TESTRAIL_API_KEY", "heGAzVp/ZXwf0T7qKnK6-gmJ9gfZaEs3FdSht/yy9")
TESTRAIL_PROJECT_ID = int(os.getenv("TESTRAIL_PROJECT_ID", "14"))

# Email Configuration
# For Gmail/Google Workspace:
# 1. Enable 2-Step Verification in your Google Account
# 2. Generate an App Password: https://myaccount.google.com/apppasswords
# 3. Use the App Password as SMTP_PASSWORD (not your regular password)
# 4. Set SMTP_PASSWORD environment variable before running the script
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "vishnu.vs@techversantinfotech.com")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
NOTIFICATION_EMAIL = os.getenv("NOTIFICATION_EMAIL", "vishnu.vs@techversantinfotech.com")

# TestRail API Base URL
API_BASE = f"{TESTRAIL_URL}/index.php?/api/v2"

# Basic Authentication
credentials = f"{TESTRAIL_EMAIL}:{TESTRAIL_API_KEY}"
encoded_credentials = base64.b64encode(credentials.encode()).decode()

headers = {
    "Authorization": f"Basic {encoded_credentials}",
    "Content-Type": "application/json"
}

# TestRail Status IDs
STATUS_IDS = {
    1: "Passed",
    2: "Blocked",
    3: "Untested",
    4: "Retest",
    5: "Failed"
}


def parse_datetime(value):
    """Parse TestRail datetime string"""
    if not value:
        return None
    try:
        # TestRail uses format: "2024-01-15T10:30:00" or with timezone
        if "T" in value:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return datetime.fromisoformat(value)
    except:
        return None


def send_email_notification(subject, body, is_success=True):
    """Send email notification about sync completion"""
    if not SMTP_PASSWORD:
        print("\n⚠️  Email notification skipped: SMTP_PASSWORD not configured")
        print("   Set SMTP_PASSWORD environment variable to enable email notifications")
        return False
    
    try:
        # Create message
        msg = MIMEMultipart()
        msg['From'] = SMTP_USERNAME
        msg['To'] = NOTIFICATION_EMAIL
        msg['Subject'] = subject
        
        # Create HTML body
        html_body = f"""
        <html>
          <head>
            <style>
              body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
              .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
              .header {{ background: {'#22c55e' if is_success else '#ef4444'}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
              .content {{ background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }}
              .stats {{ background: white; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid {'#22c55e' if is_success else '#ef4444'}; }}
              .stat-item {{ margin: 8px 0; }}
              .stat-label {{ font-weight: 600; color: #475569; }}
              .stat-value {{ color: #1e293b; font-size: 18px; }}
              .footer {{ text-align: center; padding: 15px; color: #64748b; font-size: 12px; }}
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>{'✅ TestRail Sync Completed Successfully' if is_success else '❌ TestRail Sync Failed'}</h2>
              </div>
              <div class="content">
                {body}
                <div class="footer">
                  <p>This is an automated notification from the QA Dashboard TestRail Sync Script.</p>
                  <p>Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                </div>
              </div>
            </div>
          </body>
        </html>
        """
        
        msg.attach(MIMEText(html_body, 'html'))
        
        # Send email
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        text = msg.as_string()
        server.sendmail(SMTP_USERNAME, NOTIFICATION_EMAIL, text)
        server.quit()
        
        print(f"\n✅ Email notification sent successfully to {NOTIFICATION_EMAIL}")
        return True
        
    except Exception as e:
        print(f"\n⚠️  Failed to send email notification: {e}")
        return False


def extract_ticket_id_from_text(text):
    """Extract ticket ID from plan name or description
    Format: ticket_id_plan_title (e.g., "18400_Guru Training Center...")
    """
    if not text:
        return None
    # Primary pattern: Ticket ID at the start followed by underscore
    # This is the standard format: "18400_Guru Training Center..."
    match = re.match(r'^(\d+)_', text)
    if match:
        try:
            ticket_id = int(match.group(1))
            # Skip very small numbers that are likely not ticket IDs
            if ticket_id > 100:
                return ticket_id
        except:
            pass
    
    # Fallback patterns for other formats
    patterns = [
        r'Ticket\s*#?\s*(\d+)',
        r'Ticket\s+(\d+)',
        r'T(\d+)',
        r'#(\d+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                ticket_id = int(match.group(1))
                if ticket_id > 100:
                    return ticket_id
            except:
                continue
    return None


def get_custom_field(item, field_name):
    """Extract custom field value from TestRail item"""
    if not item or "custom_" not in str(item):
        return None
    # TestRail custom fields are prefixed with custom_
    # We'll store all custom fields in JSON, so this is a helper for specific lookups
    return None  # Will be handled in custom_fields JSON


def fetch_test_plans(project_id):
    """Fetch all test plans for a project with pagination"""
    all_plans = []
    offset = 0
    limit = 250  # TestRail API limit
    
    try:
        while True:
            response = requests.get(
                f"{API_BASE}/get_plans/{project_id}",
                headers=headers,
                params={"offset": offset, "limit": limit},
                timeout=30
            )
            response.raise_for_status()
            plans = response.json()
            
            # Handle different response formats
            if isinstance(plans, dict):
                plans = plans.get("plans", [])
            elif not isinstance(plans, list):
                plans = []
            
            if not plans:
                break
                
            all_plans.extend(plans)
            
            # If we got fewer than limit, we've reached the end
            if len(plans) < limit:
                break
                
            offset += limit
            print(f"  Fetched {len(all_plans)} plans so far...")
            
        return all_plans
    except Exception as e:
        print(f"Error fetching test plans: {e}")
        return all_plans


def fetch_plan_details(plan_id):
    """Fetch detailed information about a test plan"""
    try:
        response = requests.get(
            f"{API_BASE}/get_plan/{plan_id}",
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching plan {plan_id} details: {e}")
        return None


def fetch_test_runs(plan_id):
    """Fetch all test runs in a plan"""
    # Note: TestRail get_runs endpoint may not support pagination
    # It returns all runs for a plan
    try:
        response = requests.get(
            f"{API_BASE}/get_runs/{plan_id}",
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        runs = response.json()
        
        # Handle different response formats
        if isinstance(runs, dict):
            runs = runs.get("runs", [])
        elif not isinstance(runs, list):
            runs = []
            
        return runs
    except Exception as e:
        # Some plans may not have runs yet, which is okay
        if "400" in str(e) or "404" in str(e):
            return []
        print(f"Error fetching test runs for plan {plan_id}: {e}")
        return []


def fetch_tests_in_run(run_id):
    """Fetch all tests (test cases with results) in a test run with pagination"""
    all_tests = []
    offset = 0
    limit = 250  # TestRail API limit
    
    try:
        while True:
            # TestRail API uses query parameters in URL
            url = f"{API_BASE}/get_tests/{run_id}"
            params = {"offset": offset, "limit": limit}
            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()
            tests = response.json()
            
            # Handle different response formats
            if isinstance(tests, dict):
                tests = tests.get("tests", [])
            elif not isinstance(tests, list):
                tests = []
            
            if not tests:
                break
                
            all_tests.extend(tests)
            
            # If we got fewer than limit, we've reached the end
            if len(tests) < limit:
                break
                
            offset += limit
            
        return all_tests
    except Exception as e:
        print(f"Error fetching tests for run {run_id}: {e}")
        return all_tests


def fetch_case_details(case_id):
    """Fetch detailed information about a test case"""
    try:
        response = requests.get(
            f"{API_BASE}/get_case/{case_id}",
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching case {case_id} details: {e}")
        return None


def extract_custom_fields(item):
    """Extract all custom fields from a TestRail item and return as dict"""
    custom_fields = {}
    if not item:
        return custom_fields
    
    # TestRail custom fields have keys like "custom_preconds", "custom_steps", etc.
    for key, value in item.items():
        if key.startswith("custom_"):
            field_name = key.replace("custom_", "")
            custom_fields[field_name] = value
    
    return custom_fields


print("Starting TestRail -> PostgreSQL sync...")
print(f"TestRail URL: {TESTRAIL_URL}")
print(f"Project ID: {TESTRAIL_PROJECT_ID} (BIS Web and Mobile)")
print("Fetching test plans and cases ONLY from Project 14 (BIS Web and Mobile)...")
print("-" * 60)

if not TESTRAIL_EMAIL:
    print("WARNING: TESTRAIL_EMAIL not set. Please set it in environment variables.")

db: Session = SessionLocal()
total_plans = 0
total_runs = 0
total_cases = 0
total_results = 0
plans_with_ticket_id = 0
plans_without_ticket_id = 0

try:
    # Fetch all test plans from Project 14 only
    print("\nFetching test plans from Project 14 (BIS Web and Mobile)...")
    plans = fetch_test_plans(TESTRAIL_PROJECT_ID)
    print(f"Found {len(plans)} test plans from Project 14")

    for plan_data in plans:
        if not isinstance(plan_data, dict):
            print(f"Skipping invalid plan data: {plan_data}")
            continue
            
        plan_id = plan_data.get("id")
        plan_name = plan_data.get("name", "")
        
        # Extract ticket_id from plan name (format: ticket_id_plan_title)
        ticket_id = extract_ticket_id_from_text(plan_name)
        
        # Skip plans without ticket ID (as per user requirement)
        if not ticket_id:
            plans_without_ticket_id += 1
            # Only print every 10th skipped plan to reduce output
            if plans_without_ticket_id % 10 == 0:
                print(f"Skipped {plans_without_ticket_id} plans without ticket ID so far...")
            continue
        
        plans_with_ticket_id += 1

        # Get or create TestPlan
        existing_plan = db.query(TestPlan).filter(TestPlan.plan_id == plan_id).first()
        custom_fields = extract_custom_fields(plan_data)
        
        plan_obj = existing_plan or TestPlan()
        plan_obj.plan_id = plan_id
        plan_obj.ticket_id = ticket_id
        plan_obj.name = plan_name
        plan_obj.description = plan_data.get("description")
        plan_obj.created_on = parse_datetime(plan_data.get("created_on"))
        plan_obj.updated_on = parse_datetime(plan_data.get("updated_on"))
        plan_obj.custom_fields = custom_fields if custom_fields else None
        
        if not existing_plan:
            db.add(plan_obj)
        db.flush()  # Get the plan ID
        
        total_plans += 1
        print(f"[{total_plans}/{plans_with_ticket_id}] Processing plan {plan_id} (Ticket: {ticket_id}): {plan_name[:60]}...")

        # Fetch test runs for this plan
        # Note: In TestRail, plans can have entries (sub-plans) that contain runs
        runs = []
        try:
            plan_details = fetch_plan_details(plan_id)
            if plan_details and plan_details.get("entries"):
                # Plan has entries (sub-plans), fetch runs from each entry
                for entry in plan_details.get("entries", []):
                    entry_runs = entry.get("runs", [])
                    runs.extend(entry_runs)
            else:
                # Direct runs in the plan
                runs = fetch_test_runs(plan_id)
        except Exception as e:
            # Fallback to direct runs fetch
            runs = fetch_test_runs(plan_id)
        
        if len(runs) > 0:
            print(f"  Found {len(runs)} test runs")

        for run_data in runs:
            run_id = run_data.get("id")
            
            # Get or create TestRun (same run can appear in multiple plan entries)
            existing_run = db.query(TestRun).filter(TestRun.run_id == run_id).first()
            
            if not existing_run:
                run_custom_fields = extract_custom_fields(run_data)
                
                run_obj = TestRun()
                run_obj.run_id = run_id
                run_obj.plan_id = plan_id
                run_obj.ticket_id = ticket_id
                run_obj.name = run_data.get("name", "")
                run_obj.description = run_data.get("description")
                run_obj.created_on = parse_datetime(run_data.get("created_on"))
                run_obj.updated_on = parse_datetime(run_data.get("updated_on"))
                run_obj.status = run_data.get("status_text")
                run_obj.custom_fields = run_custom_fields if run_custom_fields else None
                
                db.add(run_obj)
                total_runs += 1
            
            db.flush()

            # Fetch tests (test cases with results) in this run
            tests = fetch_tests_in_run(run_id)
            if len(tests) > 0:
                print(f"    Found {len(tests)} tests in run {run_id}")

            for test_data in tests:
                case_id = test_data.get("case_id")
                test_id = test_data.get("id")
                status_id = test_data.get("status_id", 3)  # Default to Untested
                status_name = STATUS_IDS.get(status_id, "Untested")
                
                # Only fetch case details if we don't have the case yet (to avoid duplicate fetches)
                case_details = None
                if case_id:
                    existing_case = db.query(TestCase).filter(TestCase.case_id == case_id).first()
                    if not existing_case:
                        # Only fetch if we need to create a new case record
                        case_details = fetch_case_details(case_id)
                
                if case_id:
                    # Get or create TestCase (same case can appear in multiple runs)
                    existing_case = db.query(TestCase).filter(TestCase.case_id == case_id).first()
                    
                    if not existing_case:
                        # Only fetch case details if we need to create a new case
                        if not case_details:
                            case_details = fetch_case_details(case_id)
                        
                        case_custom_fields = extract_custom_fields(case_details) if case_details else {}
                        
                        case_obj = TestCase()
                        case_obj.case_id = case_id
                        case_obj.run_id = run_id  # Store the first run_id we see
                        case_obj.ticket_id = ticket_id
                        case_obj.title = case_details.get("title") if case_details else test_data.get("title", "")
                        case_obj.section = case_details.get("section_id") if case_details else None
                        case_obj.priority = case_details.get("priority_id") if case_details else None
                        case_obj.type = case_details.get("type_id") if case_details else None
                        case_obj.custom_fields = case_custom_fields if case_custom_fields else None
                        
                        db.add(case_obj)
                        total_cases += 1

                # Create TestResult
                existing_result = db.query(TestResult).filter(
                    TestResult.test_id == test_id
                ).first()
                
                result_custom_fields = extract_custom_fields(test_data)
                
                result_obj = existing_result or TestResult()
                result_obj.test_id = test_id
                result_obj.run_id = run_id
                result_obj.case_id = case_id
                result_obj.ticket_id = ticket_id
                result_obj.status_id = status_id
                result_obj.status_name = status_name
                result_obj.assigned_to = test_data.get("assignedto_id")
                result_obj.created_on = parse_datetime(test_data.get("created_on"))
                result_obj.custom_fields = result_custom_fields if result_custom_fields else None
                
                if not existing_result:
                    db.add(result_obj)
                
                total_results += 1

        # Commit after each plan to avoid large transactions
        db.commit()
        if len(runs) > 0 or total_cases > 0:
            print(f"  Completed plan {plan_id} ({total_cases} cases, {total_results} results so far)")

    print(f"\n" + "=" * 60)
    print(f"SYNC COMPLETED FOR PROJECT 14 (BIS Web and Mobile):")
    print(f"  Plans with Ticket ID (processed): {plans_with_ticket_id}")
    print(f"  Plans without Ticket ID (skipped): {plans_without_ticket_id}")
    print(f"  Test Plans stored: {total_plans}")
    print(f"  Test Runs: {total_runs}")
    print(f"  Test Cases: {total_cases}")
    print(f"  Test Results: {total_results}")
    print("=" * 60)
    
    # Send success email notification
    email_body = f"""
    <div class="stats">
      <h3>Sync Summary</h3>
      <div class="stat-item">
        <span class="stat-label">Test Plans Processed:</span>
        <div class="stat-value">{plans_with_ticket_id}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Test Plans Skipped (no ticket ID):</span>
        <div class="stat-value">{plans_without_ticket_id}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Test Plans Stored:</span>
        <div class="stat-value">{total_plans}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Test Runs:</span>
        <div class="stat-value">{total_runs}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Test Cases:</span>
        <div class="stat-value">{total_cases}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Test Results:</span>
        <div class="stat-value">{total_results}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Project ID:</span>
        <div class="stat-value">{TESTRAIL_PROJECT_ID} (BIS Web and Mobile)</div>
      </div>
    </div>
    <p style="margin-top: 20px; color: #64748b;">
      The TestRail sync has completed successfully. All data has been synchronized to the database.
    </p>
    """
    
    send_email_notification(
        subject="✅ TestRail Sync Completed Successfully",
        body=email_body,
        is_success=True
    )

except Exception as e:
    db.rollback()
    error_message = str(e)
    print(f"\nERROR during sync: {error_message}")
    import traceback
    error_traceback = traceback.format_exc()
    traceback.print_exc()
    
    # Send error email notification
    # Escape HTML to prevent injection
    safe_error_message = html.escape(error_message)
    safe_traceback = html.escape(error_traceback)
    
    email_body = f"""
    <div class="stats">
      <h3>Error Details</h3>
      <div class="stat-item">
        <span class="stat-label">Error Message:</span>
        <div class="stat-value" style="color: #ef4444; font-size: 14px;">{safe_error_message}</div>
      </div>
      <div class="stat-item">
        <span class="stat-label">Project ID:</span>
        <div class="stat-value">{TESTRAIL_PROJECT_ID} (BIS Web and Mobile)</div>
      </div>
    </div>
    <div style="background: #fee2e2; padding: 15px; border-radius: 6px; margin-top: 15px;">
      <h4 style="margin-top: 0; color: #991b1b;">Traceback:</h4>
      <pre style="background: white; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; color: #1e293b; white-space: pre-wrap; word-wrap: break-word;">{safe_traceback}</pre>
    </div>
    <p style="margin-top: 20px; color: #64748b;">
      The TestRail sync encountered an error. Please check the logs and try again.
    </p>
    """
    
    send_email_notification(
        subject="❌ TestRail Sync Failed",
        body=email_body,
        is_success=False
    )

finally:
    db.close()
