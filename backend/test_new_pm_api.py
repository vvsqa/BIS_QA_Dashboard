"""
Test the new PM API endpoint and compare with the old one.

New endpoint: https://www.bissafety.app/rest/mcp.v1/pm/ticketlist
Auth: Authorization: Bearer <token>

Usage:
    python test_new_pm_api.py <bearer_token>
    python test_new_pm_api.py <bearer_token> --compare  # Also fetch from old endpoint and compare

Example:
    python test_new_pm_api.py _9202ECFD4F8AF33D...
"""
import os
import sys
import json
import requests
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

# New endpoint
NEW_API_URL = "https://www.bissafety.app/rest/mcp.v1/pm/ticketlist"

# Old endpoint (for comparison)
OLD_API_URL = os.getenv("PM_API_URL", "https://www.bissafety.app/rest/v.01/pm/ticket-export")
OLD_API_KEY = os.getenv("PM_API_KEY", "")


def fetch_new_api(bearer_token: str):
    """Fetch tickets from the new endpoint using Bearer auth."""
    headers = {
        "Authorization": f"Bearer {bearer_token}",
        "Accept": "application/json",
    }
    print(f"Fetching from NEW endpoint: {NEW_API_URL}")
    print(f"Auth: Bearer {bearer_token[:20]}...{bearer_token[-8:]}")
    
    try:
        response = requests.get(NEW_API_URL, headers=headers, timeout=60)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"Error: {response.text[:500]}")
            return None
        
        data = response.json()
        return data
    except Exception as e:
        print(f"Error: {e}")
        return None


def fetch_old_api():
    """Fetch tickets from the old endpoint using authID header."""
    if not OLD_API_KEY:
        print("OLD_API_KEY not set in .env - skipping old endpoint comparison")
        return None
    
    headers = {
        "authID": OLD_API_KEY,
        "Accept": "application/json",
    }
    print(f"\nFetching from OLD endpoint: {OLD_API_URL}")
    print(f"Auth: authID {OLD_API_KEY[:10]}...{OLD_API_KEY[-4:]}")
    
    try:
        response = requests.get(OLD_API_URL, headers=headers, timeout=60)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"Error: {response.text[:500]}")
            return None
        
        data = response.json()
        return data
    except Exception as e:
        print(f"Error: {e}")
        return None


def extract_tickets(data):
    """Extract ticket list from API response (handles different formats)."""
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Try common keys
        for key in ["tickets", "data", "items", "result", "results"]:
            if key in data and isinstance(data[key], list):
                return data[key]
        # If dict has ticket-like keys, it might be a single ticket or nested
        if "TicketNumber" in data or "ticket_id" in data:
            return [data]
    return []


def show_sample_tickets(tickets, label="", count=3):
    """Print sample ticket data."""
    print(f"\n{'='*60}")
    print(f"{label} - Total tickets: {len(tickets)}")
    print(f"{'='*60}")
    
    if not tickets:
        print("No tickets found.")
        return
    
    # Show field names from first ticket
    first = tickets[0]
    print(f"\nFields in response ({len(first)} fields):")
    print(", ".join(sorted(first.keys())[:20]))
    if len(first.keys()) > 20:
        print(f"  ... and {len(first.keys()) - 20} more")
    
    # Show sample tickets
    print(f"\nSample tickets (first {min(count, len(tickets))}):")
    for i, t in enumerate(tickets[:count]):
        ticket_id = t.get("TicketNumber") or t.get("ticket_id") or t.get("id") or "?"
        title = t.get("Title") or t.get("title") or t.get("subject") or "?"
        status = t.get("Status") or t.get("status") or "?"
        priority = t.get("Priority") or t.get("priority") or "?"
        print(f"\n  [{i+1}] Ticket #{ticket_id}")
        print(f"      Title: {str(title)[:60]}...")
        print(f"      Status: {status}")
        print(f"      Priority: {priority}")


def compare_tickets(old_tickets, new_tickets):
    """Compare tickets from both endpoints."""
    print(f"\n{'='*60}")
    print("COMPARISON")
    print(f"{'='*60}")
    
    # Get ticket IDs
    def get_id(t):
        return str(t.get("TicketNumber") or t.get("ticket_id") or t.get("id") or "")
    
    old_ids = set(get_id(t) for t in old_tickets if get_id(t))
    new_ids = set(get_id(t) for t in new_tickets if get_id(t))
    
    print(f"\nOld endpoint: {len(old_tickets)} tickets ({len(old_ids)} unique IDs)")
    print(f"New endpoint: {len(new_tickets)} tickets ({len(new_ids)} unique IDs)")
    
    common = old_ids & new_ids
    only_old = old_ids - new_ids
    only_new = new_ids - old_ids
    
    print(f"\nCommon tickets: {len(common)}")
    print(f"Only in old: {len(only_old)}")
    print(f"Only in new: {len(only_new)}")
    
    if only_old and len(only_old) <= 10:
        print(f"  Missing from new: {sorted(only_old)}")
    if only_new and len(only_new) <= 10:
        print(f"  New tickets: {sorted(only_new)}")
    
    # Compare field structure
    if old_tickets and new_tickets:
        old_fields = set(old_tickets[0].keys())
        new_fields = set(new_tickets[0].keys())
        
        if old_fields != new_fields:
            print(f"\nField differences:")
            only_in_old = old_fields - new_fields
            only_in_new = new_fields - old_fields
            if only_in_old:
                print(f"  Fields only in old: {sorted(only_in_old)}")
            if only_in_new:
                print(f"  Fields only in new: {sorted(only_in_new)}")
        else:
            print(f"\nField structure: IDENTICAL ({len(old_fields)} fields)")


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_new_pm_api.py <bearer_token> [--compare]")
        print("\nExample:")
        print("  python test_new_pm_api.py _9202ECFD4F8AF33D...")
        print("  python test_new_pm_api.py _9202ECFD4F8AF33D... --compare")
        sys.exit(1)
    
    bearer_token = sys.argv[1]
    do_compare = "--compare" in sys.argv
    
    print(f"\nPM API Test - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Fetch from new endpoint
    new_data = fetch_new_api(bearer_token)
    new_tickets = extract_tickets(new_data)
    show_sample_tickets(new_tickets, "NEW ENDPOINT")
    
    if not new_tickets:
        print("\n[FAIL] New endpoint returned no tickets or failed.")
        sys.exit(1)
    
    print(f"\n[OK] New endpoint returned {len(new_tickets)} tickets.")
    
    # Optionally compare with old endpoint
    if do_compare:
        old_data = fetch_old_api()
        old_tickets = extract_tickets(old_data)
        show_sample_tickets(old_tickets, "OLD ENDPOINT")
        
        if old_tickets:
            compare_tickets(old_tickets, new_tickets)
    
    print("\n" + "=" * 60)
    print("Test complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
