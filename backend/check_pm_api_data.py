#!/usr/bin/env python3
"""
Check PM Tracker data coming via the new API.
Uses same URL and auth (authID header) as pm_api_sync.PMApiClient.
"""
import os
import json
import requests
from pprint import pprint

# Same as pm_api_sync / PM_TRACKER_QUICK_START
PM_API_URL = os.environ.get(
    "PM_API_URL",
    "https://www.bissafety.app/rest/v.01/pm/ticket-export"
)
PM_API_KEY = os.environ.get("PM_API_KEY", "Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7")


def main():
    print("\n" + "=" * 80)
    print("PM TRACKER API – Data check (new API)")
    print("=" * 80)
    print(f"URL: {PM_API_URL}")
    print(f"Auth: authID header ({PM_API_KEY[:10]}...{PM_API_KEY[-4:]})")
    print()

    headers = {"authID": PM_API_KEY, "Accept": "application/json"}
    try:
        r = requests.get(PM_API_URL, headers=headers, timeout=30)
        print(f"Status: {r.status_code}")
        print(f"Content-Type: {r.headers.get('content-type', '')}")
        print()

        if r.status_code != 200:
            try:
                err = r.json()
                print("Error response:", json.dumps(err, indent=2))
            except Exception:
                print("Body:", r.text[:500])
            return

        data = r.json()

        # Response shape
        if isinstance(data, list):
            count = len(data)
            print(f"Response: list of {count} records")
            if count > 0:
                print(f"\nKeys in first record: {list(data[0].keys())}")
                print("\n--- First record (sample) ---")
                pprint(data[0], width=100)
                if count > 1:
                    print("\n--- Second record (sample) ---")
                    pprint(data[1], width=100)
                print(f"\n--- Total: {count} tickets ---")
        elif isinstance(data, dict):
            print(f"Response: dict with keys: {list(data.keys())}")
            if data.get("error"):
                print("  error:", data["error"])
            if data.get("metadata"):
                print("  metadata:", json.dumps(data["metadata"], indent=2))
            for key in ["data", "tickets", "results", "items", "records"]:
                if key in data and isinstance(data[key], list):
                    arr = data[key]
                    print(f"\n  '{key}' has {len(arr)} items")
                    if arr:
                        print(f"  First item keys: {list(arr[0].keys())}")
                        print("\n  First item:")
                        pprint(arr[0], width=100)
                        if len(arr) > 1:
                            print("\n  Second item:")
                            pprint(arr[1], width=100)
                    break
            else:
                pprint(data, width=100)
        else:
            print("Unexpected type:", type(data))
            print(data)

    except requests.exceptions.Timeout:
        print("Request timed out.")
    except requests.exceptions.ConnectionError as e:
        print("Connection error:", e)
    except Exception as e:
        print("Error:", type(e).__name__, e)

    print("\n" + "=" * 80)


if __name__ == "__main__":
    main()
