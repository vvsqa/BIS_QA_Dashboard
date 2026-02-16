"""
Diagnostic script for TestRail sync on live.
Run from backend dir: python check_testrail_live.py

Checks:
- Env vars (TESTRAIL_*)
- TestRail API connection
- Sample plan names and whether ticket_id would be extracted
- DB counts (test_plans, test_cases, test_results) and sample ticket_ids
"""
import os
import re

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

# Same logic as sync script
TESTRAIL_URL = os.getenv("TESTRAIL_URL", "https://bistrainer.testrail.io")
TESTRAIL_EMAIL = os.getenv("TESTRAIL_EMAIL", "")
TESTRAIL_API_KEY = os.getenv("TESTRAIL_API_KEY", "")
TESTRAIL_PROJECT_ID = int(os.getenv("TESTRAIL_PROJECT_ID", "14"))

API_BASE = f"{TESTRAIL_URL}/index.php?/api/v2"
import base64
import requests

credentials = f"{TESTRAIL_EMAIL}:{TESTRAIL_API_KEY}"
encoded = base64.b64encode(credentials.encode()).decode()
headers = {"Authorization": f"Basic {encoded}", "Content-Type": "application/json"}


def extract_ticket_id_from_text(text):
    if not text:
        return None
    match = re.match(r'^(\d+)_', text)
    if match:
        try:
            tid = int(match.group(1))
            if tid > 100:
                return tid
        except Exception:
            pass
    for pattern in [r'Ticket\s*#?\s*(\d+)', r'Ticket\s+(\d+)', r'#(\d+)']:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                tid = int(match.group(1))
                if tid > 100:
                    return tid
            except Exception:
                continue
    return None


def main():
    print("=" * 60)
    print("TestRail live diagnostic")
    print("=" * 60)

    # 1. Env
    print("\n1. Environment")
    print(f"   TESTRAIL_URL: {TESTRAIL_URL}")
    print(f"   TESTRAIL_PROJECT_ID: {TESTRAIL_PROJECT_ID}")
    print(f"   TESTRAIL_EMAIL: {'(set)' if TESTRAIL_EMAIL else '(MISSING)'}")
    print(f"   TESTRAIL_API_KEY: {'(set)' if TESTRAIL_API_KEY else '(MISSING)'}")
    if not TESTRAIL_EMAIL or not TESTRAIL_API_KEY:
        print("\n   Fix: Set TESTRAIL_EMAIL and TESTRAIL_API_KEY in .env on the server.")
        return

    # 2. API
    print("\n2. TestRail API")
    try:
        r = requests.get(
            f"{API_BASE}/get_plans/{TESTRAIL_PROJECT_ID}",
            headers=headers,
            params={"limit": 50},
            timeout=30,
        )
        if r.status_code != 200:
            print(f"   FAIL: API returned {r.status_code}")
            print(f"   {r.text[:300]}")
            return
        data = r.json()
        plans = data.get("plans", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        print(f"   OK: Fetched {len(plans)} plans (first 50)")
    except Exception as e:
        print(f"   FAIL: {e}")
        return

    # 3. Plan names and ticket extraction
    print("\n3. Plan names and ticket ID extraction")
    with_id = 0
    without_id = 0
    for i, p in enumerate(plans[:15]):
        name = (p.get("name") or "")[:70]
        tid = extract_ticket_id_from_text(name)
        if tid:
            with_id += 1
            print(f"   [OK]   Ticket {tid}: {name}...")
        else:
            without_id += 1
            print(f"   [SKIP] No ticket ID: {name}...")
    for p in plans[15:]:
        tid = extract_ticket_id_from_text(p.get("name") or "")
        if tid:
            with_id += 1
        else:
            without_id += 1
    print(f"   Summary (this batch): {with_id} with ticket ID, {without_id} without (skipped by sync)")

    # 4. DB
    print("\n4. Database (current sync state)")
    try:
        from database import SessionLocal
        from models import TestPlan, TestCase, TestResult

        db = SessionLocal()
        try:
            plan_count = db.query(TestPlan).count()
            case_count = db.query(TestCase).count()
            result_count = db.query(TestResult).count()
            print(f"   test_plans: {plan_count}")
            print(f"   test_cases: {case_count}")
            print(f"   test_results: {result_count}")

            # Sample ticket_ids that have data
            ticket_ids = [r[0] for r in db.query(TestResult.ticket_id).distinct().all() if r[0] is not None][:10]
            if ticket_ids:
                print(f"   Sample ticket_ids with results: {ticket_ids}")
            else:
                print("   No ticket_ids in test_results (sync may not have run or no plans matched).")
        finally:
            db.close()
    except Exception as e:
        print(f"   DB check failed: {e}")
        print("   Ensure DB_* env vars are set and migrations are applied.")

    print("\n" + "=" * 60)
    print("If test case data is wrong on live:")
    print("  - Ensure sync runs regularly (cron every 15 min): sync_testrail_to_db.py")
    print("  - Plan names must start with ticket ID (e.g. 18400_Regression) or set custom field.")
    print("  - See TESTRAIL_DEVOPS.md and optional TESTRAIL_TICKET_FIELD_NAMES in .env")
    print("=" * 60)


if __name__ == "__main__":
    main()
