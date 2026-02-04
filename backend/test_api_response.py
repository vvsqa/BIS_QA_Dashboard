import requests
import json

try:
    r = requests.get('http://127.0.0.1:8000/calendar/weekly?team=QA&date_str=2026-01-20', timeout=15)
    data = r.json()
    
    print(f"Status: {r.status_code}")
    print(f"Employees: {len(data.get('employees', []))}")
    
    # Find Amala A
    emp = next((e for e in data['employees'] if e['employee_name'] == 'Amala A'), None)
    
    if emp:
        print(f"\nFound Amala A")
        print(f"Total days: {len(emp['days'])}")
        
        days_with_entries = [d for d in emp['days'].values() if len(d.get('entries', [])) > 0]
        print(f"Days with entries: {len(days_with_entries)}")
        
        if days_with_entries:
            sample_day = days_with_entries[0]
            print(f"\nSample day with entries:")
            print(f"  Date: {sample_day.get('date')}")
            print(f"  Entries: {len(sample_day.get('entries', []))}")
            print(f"  Total hours: {sample_day.get('total_hours')}")
            if sample_day.get('entries'):
                print(f"  First entry: {sample_day['entries'][0]}")
        else:
            print("\nNo days with entries found")
            # Check a specific day
            day_key = '2026-01-22'
            if day_key in emp['days']:
                day_data = emp['days'][day_key]
                print(f"\nDay {day_key}:")
                print(f"  Entries: {len(day_data.get('entries', []))}")
                print(f"  Total hours: {day_data.get('total_hours')}")
                print(f"  Productive hours: {day_data.get('productive_hours')}")
    else:
        print("Amala A not found in employees")
        
except Exception as e:
    print(f"Error: {e}")
