import requests
import json
from pprint import pprint

url = 'https://www.bissafety.app/rest/v.01/pm/ticket-export'
api_key = 'Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7'
params = {'authID': api_key}

try:
    print("=" * 80)
    print("PM TRACKER API TEST - Fetching ticket data...")
    print("=" * 80)
    print(f"URL: {url}")
    print(f"API Key: {api_key[:10]}...{api_key[-5:]}")
    print()
    
    response = requests.get(url, params=params, timeout=30)
    print(f'Status Code: {response.status_code}')
    print(f'Content-Type: {response.headers.get("content-type")}')
    print()
    
    data = response.json()
    
    # Check if it's a list or dict
    if isinstance(data, list):
        total_records = len(data)
        print(f'Response Format: LIST')
        print(f'Total Records: {total_records}')
    elif isinstance(data, dict):
        if 'error' in data:
            print(f'API Error: {data.get("error")}')
            print(f'Error Description: {data.get("error_description")}')
        else:
            # Check for common wrapper keys
            for key in ["data", "tickets", "results", "items", "records"]:
                if key in data:
                    print(f'Response Format: DICT with "{key}" key')
                    total_records = len(data[key]) if isinstance(data[key], list) else 1
                    print(f'Total Records: {total_records}')
                    break
            else:
                print(f'Response Format: DICT (Keys: {list(data.keys())})')
                total_records = len(data) if isinstance(data, dict) else 1
    else:
        print(f'Response Format: {type(data).__name__}')
        total_records = 0
    
    print()
    print("=" * 80)
    print("FIRST RECORD (Sample Data):")
    print("=" * 80)
    
    # Get first record
    first_record = None
    if isinstance(data, list) and len(data) > 0:
        first_record = data[0]
    elif isinstance(data, dict):
        # Check for wrapper keys
        for key in ["data", "tickets", "results", "items", "records"]:
            if key in data and isinstance(data[key], list) and len(data[key]) > 0:
                first_record = data[key][0]
                break
        else:
            # Single record dict
            if 'ticket_id' in data or 'id' in data:
                first_record = data
    
    if first_record:
        pprint(first_record, width=120)
    else:
        print("No records found or empty response")
    
    print()
    print("=" * 80)
    print("FIELD NAMES (Available Fields):")
    print("=" * 80)
    
    if first_record and isinstance(first_record, dict):
        fields = list(first_record.keys())
        for i, field in enumerate(fields, 1):
            value = first_record[field]
            field_type = type(value).__name__
            print(f"{i:2d}. {field:30s} ({field_type:10s}) = {str(value)[:60]}")
    
    print()
    print("=" * 80)
    print("ADDITIONAL RECORDS (First 5 samples):")
    print("=" * 80)
    
    # Show first 5 records
    records_to_show = []
    if isinstance(data, list):
        records_to_show = data[:5]
    elif isinstance(data, dict):
        for key in ["data", "tickets", "results", "items", "records"]:
            if key in data and isinstance(data[key], list):
                records_to_show = data[key][:5]
                break
    
    for idx, record in enumerate(records_to_show[1:], 2):  # Skip first, already shown
        if isinstance(record, dict):
            ticket_id = record.get('ticket_id') or record.get('id') or record.get('number')
            status = record.get('status')
            assignee = record.get('current_assignee') or record.get('assignee')
            print(f"\nRecord {idx}:")
            print(f"  ID: {ticket_id}")
            print(f"  Status: {status}")
            print(f"  Assignee: {assignee}")
            print(f"  Full Data: {json.dumps(record, default=str, indent=2)[:300]}...")
    
    print()
    print("=" * 80)
    print("FULL JSON RESPONSE (First 2000 chars):")
    print("=" * 80)
    print(json.dumps(data, default=str, indent=2)[:2000])
    
except requests.exceptions.Timeout as e:
    print(f'Error: Request timeout ({e})')
except requests.exceptions.ConnectionError as e:
    print(f'Error: Connection error ({e})')
except requests.exceptions.RequestException as e:
    print(f'Error: {type(e).__name__}: {e}')
except json.JSONDecodeError as e:
    print(f'Error: Invalid JSON response - {e}')
    print(f'Response text: {response.text[:500]}')
except Exception as e:
    print(f'Error: {type(e).__name__}: {e}')

