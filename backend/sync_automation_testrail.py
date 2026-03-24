"""
Sync script for TestRail Project 18 (Automation Coverage Tracking).
Fetches test runs and cases with automation-specific custom fields.
Ticket ID is extracted from test run names (starts with ticket_id_).
"""
import requests
import base64
import os
from sqlalchemy.orm import Session
from database import SessionLocal
from models import AutomationTestRun, AutomationTestCase
from datetime import datetime
import re
import html

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

# TestRail Configuration
TESTRAIL_URL = os.getenv("TESTRAIL_URL", "https://bistrainer.testrail.io")
TESTRAIL_EMAIL = os.getenv("TESTRAIL_EMAIL", "")
TESTRAIL_API_KEY = os.getenv("TESTRAIL_API_KEY", "")
TESTRAIL_AUTOMATION_PROJECT_ID = int(os.getenv("TESTRAIL_AUTOMATION_PROJECT_ID", "18"))

# TestRail API Base URL
API_BASE = "{}/index.php?/api/v2".format(TESTRAIL_URL)

# Basic Authentication
credentials = "{}:{}".format(TESTRAIL_EMAIL, TESTRAIL_API_KEY)
encoded_credentials = base64.b64encode(credentials.encode()).decode()

headers = {
    "Authorization": "Basic {}".format(encoded_credentials),
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
    """Parse TestRail datetime - handles both timestamp and ISO format"""
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value)
        if isinstance(value, str):
            if "T" in value:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            return datetime.fromisoformat(value)
    except Exception:
        pass
    return None


def extract_ticket_id_from_text(text):
    """Extract ticket ID from run name.
    Format: ticket_id_run_title (e.g., "18400_Forms Regression")
    """
    if not text:
        return None
    match = re.match(r'^(\d+)_', text)
    if match:
        try:
            ticket_id = int(match.group(1))
            if ticket_id > 100:
                return ticket_id
        except Exception:
            pass

    patterns = [
        r'Ticket\s*#?\s*(\d+)',
        r'Ticket\s+(\d+)',
        r'#(\d+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                ticket_id = int(match.group(1))
                if ticket_id > 100:
                    return ticket_id
            except Exception:
                continue
    return None


def extract_custom_fields(item):
    """Extract all custom fields from a TestRail item and return as dict"""
    custom_fields = {}
    if not item:
        return custom_fields
    
    for key, value in item.items():
        if key.startswith("custom_"):
            field_name = key.replace("custom_", "")
            custom_fields[field_name] = value
    
    return custom_fields


def get_custom_field_value(item, field_name):
    """Get a specific custom field value from a TestRail item.
    Handles both direct custom_ prefix and nested custom_fields dict.
    """
    if not item:
        return None
    
    key = "custom_{}".format(field_name)
    if key in item:
        return item[key]
    
    if "custom_fields" in item and isinstance(item["custom_fields"], dict):
        return item["custom_fields"].get(field_name)
    
    return None


def fetch_test_runs_for_project(project_id):
    """Fetch all active (non-completed/non-deleted) test runs for a project with pagination"""
    all_runs = []
    offset = 0
    limit = 250
    
    try:
        while True:
            response = requests.get(
                "{}/get_runs/{}".format(API_BASE, project_id),
                headers=headers,
                params={
                    "offset": offset,
                    "limit": limit,
                    "is_completed": 0  # Only fetch active runs (not completed/closed)
                },
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, dict):
                runs = data.get("runs", [])
            elif isinstance(data, list):
                runs = data
            else:
                runs = []
            
            if not runs:
                break
            
            # Filter out any runs that might still be marked as completed
            active_runs = [r for r in runs if not r.get("is_completed")]
            all_runs.extend(active_runs)
            
            if len(runs) < limit:
                break
                
            offset += limit
            print("  Fetched {} active runs so far...".format(len(all_runs)))
            
        return all_runs
    except Exception as e:
        print("Error fetching test runs: {}".format(e))
        return all_runs


def fetch_test_plans(project_id):
    """Fetch all active (non-completed/non-deleted) test plans for a project with pagination"""
    all_plans = []
    offset = 0
    limit = 250
    
    try:
        while True:
            response = requests.get(
                "{}/get_plans/{}".format(API_BASE, project_id),
                headers=headers,
                params={
                    "offset": offset,
                    "limit": limit,
                    "is_completed": 0  # Only fetch active plans (not completed/closed)
                },
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, dict):
                plans = data.get("plans", [])
            elif isinstance(data, list):
                plans = data
            else:
                plans = []
            
            if not plans:
                break
            
            # Filter out any plans that might still be marked as completed
            active_plans = [p for p in plans if not p.get("is_completed")]
            all_plans.extend(active_plans)
            
            if len(plans) < limit:
                break
                
            offset += limit
            print("  Fetched {} active plans so far...".format(len(all_plans)))
            
        return all_plans
    except Exception as e:
        print("Error fetching test plans: {}".format(e))
        return all_plans


def fetch_plan_details(plan_id):
    """Fetch detailed information about a test plan including entries"""
    try:
        response = requests.get(
            "{}/get_plan/{}".format(API_BASE, plan_id),
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print("Error fetching plan {} details: {}".format(plan_id, e))
        return None


def fetch_tests_in_run(run_id):
    """Fetch all tests in a run with pagination"""
    all_tests = []
    offset = 0
    limit = 250
    
    try:
        while True:
            response = requests.get(
                "{}/get_tests/{}".format(API_BASE, run_id),
                headers=headers,
                params={"offset": offset, "limit": limit},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, dict):
                tests = data.get("tests", [])
            elif isinstance(data, list):
                tests = data
            else:
                tests = []
            
            if not tests:
                break
                
            all_tests.extend(tests)
            
            if len(tests) < limit:
                break
                
            offset += limit
            
        return all_tests
    except Exception as e:
        print("Error fetching tests for run {}: {}".format(run_id, e))
        return all_tests


def fetch_case_details(case_id):
    """Fetch detailed information about a test case"""
    try:
        response = requests.get(
            "{}/get_case/{}".format(API_BASE, case_id),
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return None


def fetch_sections_for_suite(project_id, suite_id):
    """Fetch sections for a suite and return {section_id: section_name}."""
    section_map = {}
    offset = 0
    limit = 250

    try:
        while True:
            response = requests.get(
                "{}/get_sections/{}".format(API_BASE, project_id),
                headers=headers,
                params={"suite_id": suite_id, "offset": offset, "limit": limit},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()

            if isinstance(data, dict):
                sections = data.get("sections", [])
            elif isinstance(data, list):
                sections = data
            else:
                sections = []

            if not sections:
                break

            for section in sections:
                sid = section.get("id")
                sname = section.get("name")
                if sid and sname:
                    section_map[int(sid)] = str(sname)

            if len(sections) < limit:
                break

            offset += limit
    except Exception as e:
        print("Warning: Could not fetch sections for suite {}: {}".format(suite_id, e))

    return section_map


def fetch_suites_for_project(project_id):
    """Fetch suites for a project."""
    try:
        response = requests.get(
            "{}/get_suites/{}".format(API_BASE, project_id),
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list):
            return data
        return data.get("suites", []) if isinstance(data, dict) else []
    except Exception as e:
        print("Warning: Could not fetch suites for project {}: {}".format(project_id, e))
        return []


def fetch_cases_for_suite(project_id, suite_id):
    """Fetch all test cases for a suite with pagination."""
    all_cases = []
    offset = 0
    limit = 250

    try:
        while True:
            response = requests.get(
                "{}/get_cases/{}".format(API_BASE, project_id),
                headers=headers,
                params={"suite_id": suite_id, "offset": offset, "limit": limit},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()

            if isinstance(data, dict):
                cases = data.get("cases", [])
            elif isinstance(data, list):
                cases = data
            else:
                cases = []

            if not cases:
                break

            all_cases.extend(cases)

            if len(cases) < limit:
                break

            offset += limit
    except Exception as e:
        print("Warning: Could not fetch cases for suite {}: {}".format(suite_id, e))

    return all_cases


def parse_hours(value):
    """Parse hours value from TestRail custom field"""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            value = value.strip()
            if value:
                return float(value)
    except (ValueError, TypeError):
        pass
    return None


# TestRail dropdown field mappings (ID -> Label)
AUTOMATION_STATUS_MAP = {
    1: "Planned",
    2: "In Progress",
    3: "Automated",
    4: "Not Automatable",
    5: "Not Automated",
}

AUTOMATION_CANDIDATE_MAP = {
    1: "Yes",
    2: "No",
    3: "None",
}

EXECUTION_METHOD_MAP = {
    1: "Manual",
    2: "Automated",
}

REUSABILITY_FREQUENCY_MAP = {
    1: "Critical",
    2: "High",
    3: "Medium",
    4: "Low",
}

BUSINESS_CRITICALITY_MAP = {
    1: "Critical",
    2: "High",
    3: "Medium",
    4: "Low",
}

LIFECYCLE_STATUS_MAP = {
    1: "Draft",
    2: "Active",
    3: "Active",  # May vary
    4: "Deprecated",
}

AUTOMATION_MAINTENANCE_MAP = {
    1: "No Maintenance Required",
    2: "Maintenance Required",
    3: "Under Maintenance",
    4: "Deprecated Script",
}


def map_dropdown_value(value, mapping):
    """Convert TestRail dropdown ID to label"""
    if value is None:
        return None
    if isinstance(value, int):
        return mapping.get(value)
    if isinstance(value, str) and value.isdigit():
        return mapping.get(int(value))
    return str(value) if value else None


def parse_dropdown_items(items_text):
    """Parse TestRail dropdown items config into {id: label} mapping."""
    mapping = {}
    if not items_text:
        return mapping

    for line in str(items_text).splitlines():
        line = line.strip()
        if not line:
            continue
        # Format from TestRail typically: "1,Label"
        parts = line.split(",", 1)
        if len(parts) != 2:
            continue
        key_raw, label = parts[0].strip(), parts[1].strip()
        if key_raw.isdigit():
            mapping[int(key_raw)] = label
    return mapping


def fetch_case_field_dropdown_map(field_system_name):
    """Fetch dropdown mapping for a given TestRail case field system name."""
    try:
        response = requests.get(
            "{}/get_case_fields".format(API_BASE),
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        fields = response.json()
        if not isinstance(fields, list):
            return {}

        for field in fields:
            if field.get("system_name") != field_system_name:
                continue
            configs = field.get("configs") or []
            if not configs:
                return {}
            # Use first config by default (project-specific configs can vary)
            options = configs[0].get("options") or {}
            return parse_dropdown_items(options.get("items"))
    except Exception as e:
        print("Warning: Could not fetch dropdown map for {}: {}".format(field_system_name, e))

    return {}


def map_case_fields_to_model(case_obj, case_source, section_name, functionality_map, sub_functionality_map):
    """Map TestRail case fields to AutomationTestCase model fields."""
    case_obj.title = case_source.get("title") or case_obj.title or ""
    case_obj.section = section_name
    case_obj.priority = str(case_source.get("priority_id")) if case_source.get("priority_id") else None

    # Track previous automation_status for status change detection
    previous_status = case_obj.automation_status
    
    new_automation_status = map_dropdown_value(
        case_source.get("custom_case_automated"), AUTOMATION_STATUS_MAP
    )
    case_obj.automation_status = new_automation_status
    
    # Map automation_candidate field (Yes/No/None)
    case_obj.automation_candidate = map_dropdown_value(
        case_source.get("custom_case_automation_candidate"), AUTOMATION_CANDIDATE_MAP
    )
    
    # Track status change dates
    # Set planned_on when status changes to "Planned" (and not already set)
    if new_automation_status and new_automation_status.lower() == "planned":
        if not case_obj.planned_on:
            case_obj.planned_on = datetime.now()
    
    # Set automated_on when status changes to "Automated" (and not already set)
    if new_automation_status and new_automation_status.lower() == "automated":
        if not case_obj.automated_on:
            case_obj.automated_on = datetime.now()
    
    case_obj.execution_method = map_dropdown_value(
        case_source.get("custom_case_execution_method"), EXECUTION_METHOD_MAP
    )
    case_obj.reusability_frequency = map_dropdown_value(
        case_source.get("custom_case_reusabilityfrequency"), REUSABILITY_FREQUENCY_MAP
    )
    case_obj.automation_maintenance = map_dropdown_value(
        case_source.get("custom_case_auto_maintenance"), AUTOMATION_MAINTENANCE_MAP
    )

    case_obj.automation_estimated_hours = parse_hours(case_source.get("custom_case_automationestimate"))
    case_obj.automation_actual_hours = parse_hours(case_source.get("custom_case_automationactualhours"))
    case_obj.automation_planned_start = parse_datetime(case_source.get("custom_case_automation_plannedstart"))
    case_obj.automation_actual_start = parse_datetime(case_source.get("custom_case_automation_actualstart"))
    case_obj.automation_actual_end = parse_datetime(case_source.get("custom_case_automationactualend"))

    case_obj.business_criticality = map_dropdown_value(
        case_source.get("custom_case_business_criticality"), BUSINESS_CRITICALITY_MAP
    )
    case_obj.functionality = map_dropdown_value(
        case_source.get("custom_case_functionality"), functionality_map
    ) or (str(case_source.get("custom_case_functionality")) if case_source.get("custom_case_functionality") else None)
    case_obj.sub_functionality = map_dropdown_value(
        case_source.get("custom_case_sub_functionality"), sub_functionality_map
    ) or (str(case_source.get("custom_case_sub_functionality")) if case_source.get("custom_case_sub_functionality") else None)
    case_obj.life_cycle_status = map_dropdown_value(
        case_source.get("custom_case_lifecycle"), LIFECYCLE_STATUS_MAP
    )

    case_obj.test_case_created_ticket_ref = case_source.get("custom_case_c_createdref")
    case_obj.test_case_modified_ticket_ref = case_source.get("custom_case_ticket_modified")


def sync_automation_data():
    """Main sync function for automation coverage data"""
    print("=" * 60)
    print("Starting Automation Coverage Sync (Project {})".format(TESTRAIL_AUTOMATION_PROJECT_ID))
    print("TestRail URL: {}".format(TESTRAIL_URL))
    print("=" * 60)

    if not TESTRAIL_EMAIL or not TESTRAIL_API_KEY:
        print("ERROR: TESTRAIL_EMAIL and TESTRAIL_API_KEY must be set")
        return

    db: Session = SessionLocal()
    total_runs = 0
    total_cases = 0
    total_project_cases = 0
    runs_with_ticket = 0
    runs_without_ticket = 0

    try:
        functionality_map = fetch_case_field_dropdown_map("custom_case_functionality")
        sub_functionality_map = fetch_case_field_dropdown_map("custom_case_sub_functionality")
        if functionality_map:
            print("Loaded functionality dropdown values: {}".format(len(functionality_map)))
        if sub_functionality_map:
            print("Loaded sub-functionality dropdown values: {}".format(len(sub_functionality_map)))

        print("\nFetching test plans from Project {}...".format(TESTRAIL_AUTOMATION_PROJECT_ID))
        plans = fetch_test_plans(TESTRAIL_AUTOMATION_PROJECT_ID)
        print("Found {} test plans".format(len(plans)))

        all_runs = []
        
        for plan_data in plans:
            if not isinstance(plan_data, dict):
                continue
            
            plan_id = plan_data.get("id")
            plan_name = plan_data.get("name", "")
            
            plan_details = fetch_plan_details(plan_id)
            if plan_details and plan_details.get("entries"):
                for entry in plan_details.get("entries", []):
                    entry_runs = entry.get("runs", [])
                    for run in entry_runs:
                        run["_plan_id"] = plan_id
                        run["_plan_name"] = plan_name
                    all_runs.extend(entry_runs)

        print("\nFetching standalone test runs from Project {}...".format(TESTRAIL_AUTOMATION_PROJECT_ID))
        standalone_runs = fetch_test_runs_for_project(TESTRAIL_AUTOMATION_PROJECT_ID)
        for run in standalone_runs:
            run["_plan_id"] = None
            run["_plan_name"] = None
        all_runs.extend(standalone_runs)
        
        print("Total runs to process: {}".format(len(all_runs)))

        seen_run_ids = set()
        suite_sections_cache = {}
        for run_data in all_runs:
            run_id = run_data.get("id")
            if run_id in seen_run_ids:
                continue
            seen_run_ids.add(run_id)
            
            run_name = run_data.get("name", "")
            plan_id = run_data.get("_plan_id") or run_data.get("plan_id")
            plan_name = run_data.get("_plan_name") or ""
            suite_id = run_data.get("suite_id")
            
            # New structure: ticket ID is represented in test plan name.
            # Keep run-name fallback for backward compatibility.
            ticket_id = extract_ticket_id_from_text(plan_name) or extract_ticket_id_from_text(run_name)
            
            if not ticket_id:
                runs_without_ticket += 1
                if runs_without_ticket % 10 == 0:
                    print("  Skipped {} runs without ticket ID...".format(runs_without_ticket))
                continue
            
            runs_with_ticket += 1
            if plan_name:
                print("\n[Run {}] Processing: {} | Plan: {} (Ticket: {})".format(
                    run_id, run_name[:50], plan_name[:50], ticket_id
                ))
            else:
                print("\n[Run {}] Processing: {} (Ticket: {})".format(run_id, run_name[:50], ticket_id))

            existing_run = db.query(AutomationTestRun).filter(AutomationTestRun.run_id == run_id).first()
            run_custom_fields = extract_custom_fields(run_data)
            
            run_obj = existing_run or AutomationTestRun()
            run_obj.run_id = run_id
            run_obj.plan_id = plan_id
            run_obj.ticket_id = ticket_id
            run_obj.name = run_name
            run_obj.description = run_data.get("description")
            run_obj.created_on = parse_datetime(run_data.get("created_on"))
            run_obj.updated_on = parse_datetime(run_data.get("updated_on"))
            run_obj.status = run_data.get("status_text")
            run_obj.custom_fields = run_custom_fields if run_custom_fields else None
            
            if not existing_run:
                db.add(run_obj)
                total_runs += 1
            
            db.flush()

            tests = fetch_tests_in_run(run_id)
            if tests:
                print("  Found {} tests in run".format(len(tests)))

            section_map = {}
            if suite_id:
                suite_key = int(suite_id)
                if suite_key not in suite_sections_cache:
                    suite_sections_cache[suite_key] = fetch_sections_for_suite(
                        TESTRAIL_AUTOMATION_PROJECT_ID, suite_key
                    )
                section_map = suite_sections_cache[suite_key]

            case_details_cache = {}
            
            for test_data in tests:
                test_id = test_data.get("id")
                case_id = test_data.get("case_id")
                status_id = test_data.get("status_id", 3)
                status_name = STATUS_IDS.get(status_id, "Untested")

                if case_id and case_id not in case_details_cache:
                    case_details = fetch_case_details(case_id)
                    if case_details:
                        case_details_cache[case_id] = case_details

                case_details = case_details_cache.get(case_id, {})
                all_custom = {}
                all_custom.update(extract_custom_fields(test_data))
                all_custom.update(extract_custom_fields(case_details))

                existing_case = db.query(AutomationTestCase).filter(
                    AutomationTestCase.test_id == test_id
                ).first()

                case_obj = existing_case or AutomationTestCase()
                case_obj.test_id = test_id
                case_obj.case_id = case_id
                case_obj.run_id = run_id
                case_obj.ticket_id = ticket_id
                case_obj.title = test_data.get("title") or case_details.get("title", "")
                section_id = case_details.get("section_id")
                if section_id:
                    case_obj.section = section_map.get(int(section_id), str(section_id))
                else:
                    case_obj.section = None
                case_obj.priority = str(case_details.get("priority_id")) if case_details.get("priority_id") else None

                # Prefer test-level custom fields; fallback to case-level values
                merged_case_source = dict(case_details or {})
                merged_case_source.update(test_data or {})
                map_case_fields_to_model(
                    case_obj,
                    merged_case_source,
                    case_obj.section,
                    functionality_map,
                    sub_functionality_map
                )

                case_obj.status_id = status_id
                case_obj.status_name = status_name

                case_obj.custom_fields = all_custom if all_custom else None

                if not existing_case:
                    db.add(case_obj)
                    total_cases += 1

            db.commit()
            print("  Committed run {} with {} tests".format(run_id, len(tests)))

        print("\nSyncing all project test cases (not only run-linked cases)...")
        suites = fetch_suites_for_project(TESTRAIL_AUTOMATION_PROJECT_ID)
        print("Found {} suite(s)".format(len(suites)))
        for suite in suites:
            suite_id = suite.get("id")
            if not suite_id:
                continue

            section_map = fetch_sections_for_suite(TESTRAIL_AUTOMATION_PROJECT_ID, int(suite_id))
            suite_cases = fetch_cases_for_suite(TESTRAIL_AUTOMATION_PROJECT_ID, int(suite_id))
            print("  Suite {}: {} cases".format(suite_id, len(suite_cases)))

            for case_data in suite_cases:
                case_id = case_data.get("id")
                if not case_id:
                    continue

                synthetic_test_id = -int(case_id)
                existing_case = db.query(AutomationTestCase).filter(
                    AutomationTestCase.test_id == synthetic_test_id
                ).first()

                case_obj = existing_case or AutomationTestCase()
                case_obj.test_id = synthetic_test_id
                case_obj.case_id = case_id
                case_obj.run_id = None
                case_obj.ticket_id = None

                section_id = case_data.get("section_id")
                section_name = section_map.get(int(section_id), str(section_id)) if section_id else None
                map_case_fields_to_model(
                    case_obj,
                    case_data,
                    section_name,
                    functionality_map,
                    sub_functionality_map
                )

                case_obj.status_id = 3
                case_obj.status_name = "Untested"
                case_obj.custom_fields = extract_custom_fields(case_data) or None

                if not existing_case:
                    db.add(case_obj)
                    total_project_cases += 1

            db.commit()

        print("\n" + "=" * 60)
        print("AUTOMATION COVERAGE SYNC COMPLETED")
        print("  Runs with Ticket ID (processed): {}".format(runs_with_ticket))
        print("  Runs without Ticket ID (skipped): {}".format(runs_without_ticket))
        print("  New Test Runs stored: {}".format(total_runs))
        print("  New Test Cases stored: {}".format(total_cases))
        print("  New Project Case rows stored: {}".format(total_project_cases))
        print("=" * 60)

    except Exception as e:
        db.rollback()
        print("\nERROR during sync: {}".format(e))
        import traceback
        traceback.print_exc()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    sync_automation_data()
