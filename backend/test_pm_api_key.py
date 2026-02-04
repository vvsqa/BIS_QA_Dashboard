#!/usr/bin/env python3
"""
Test PM Tracker API with the correct key from PM team
"""
import requests
import json
from pprint import pprint
import sys

def test_pm_api():
    url = 'https://www.bissafety.app/rest/v.01/pm/ticket-export'
    api_key = 'Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7'  # From PM team
    
    print("\n" + "=" * 100)
    print("PM TRACKER API TEST - Using key from PM team")
    print("=" * 100)
    print(f"URL: {url}")
    print(f"API Key: {api_key[:10]}...{api_key[-5:]}")
    print()
    
    # Test 1: Query parameter as "key"
    print(f"\n{'-' * 100}")
    print(f"Attempt 1: Query parameter 'key'")
    print(f"{'-' * 100}")
    try:
        response = requests.get(url, params={"key": api_key}, timeout=10)
        print(f'Status Code: {response.status_code}')
        print(f'Content-Type: {response.headers.get("content-type")}')
        
        data = response.json()
        
        if response.status_code == 200:
            print(f'✓ SUCCESS!')
            show_data(data)
            return True
        else:
            print(f'Error: {data}')
    except Exception as e:
        print(f'✗ Error: {e}')
    
    # Test 2: Query parameter as "apiKey"
    print(f"\n{'-' * 100}")
    print(f"Attempt 2: Query parameter 'apiKey'")
    print(f"{'-' * 100}")
    try:
        response = requests.get(url, params={"apiKey": api_key}, timeout=10)
        print(f'Status Code: {response.status_code}')
        print(f'Content-Type: {response.headers.get("content-type")}')
        
        data = response.json()
        
        if response.status_code == 200:
            print(f'✓ SUCCESS!')
            show_data(data)
            return True
        else:
            print(f'Error: {data}')
    except Exception as e:
        print(f'✗ Error: {e}')
    
    # Test 3: Header "X-API-Key"
    print(f"\n{'-' * 100}")
    print(f"Attempt 3: Header 'X-API-Key'")
    print(f"{'-' * 100}")
    try:
        response = requests.get(url, headers={"X-API-Key": api_key}, timeout=10)
        print(f'Status Code: {response.status_code}')
        print(f'Content-Type: {response.headers.get("content-type")}')
        
        data = response.json()
        
        if response.status_code == 200:
            print(f'✓ SUCCESS!')
            show_data(data)
            return True
        else:
            print(f'Error: {data}')
    except Exception as e:
        print(f'✗ Error: {e}')
    
    # Test 4: Header "Authorization: Bearer"
    print(f"\n{'-' * 100}")
    print(f"Attempt 4: Header 'Authorization: Bearer'")
    print(f"{'-' * 100}")
    try:
        response = requests.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
        print(f'Status Code: {response.status_code}')
        print(f'Content-Type: {response.headers.get("content-type")}')
        
        data = response.json()
        
        if response.status_code == 200:
            print(f'✓ SUCCESS!')
            show_data(data)
            return True
        else:
            print(f'Error: {data}')
    except Exception as e:
        print(f'✗ Error: {e}')
    
    print(f"\n{'=' * 100}")
    print("❌ All authentication methods failed")
    print("=" * 100)
    return False

def show_data(data):
    """Display the API response data"""
    print()
    print("=" * 100)
    print("API RESPONSE SUMMARY:")
    print("=" * 100)
    
    # Check if it's a list or dict
    if isinstance(data, list):
        print(f'Response Format: LIST')
        print(f'Total Records: {len(data)}')
        
        if len(data) > 0:
            print(f'\nFirst Record Keys: {list(data[0].keys())}')
            print(f'\nFirst Record:')
            pprint(data[0], width=120)
            
            print(f'\nSample of next 2 records:')
            for idx, record in enumerate(data[1:3], 2):
                print(f'\nRecord {idx}:')
                if isinstance(record, dict):
                    ticket_id = record.get('ticket_id') or record.get('id')
                    status = record.get('status')
                    assignee = record.get('current_assignee') or record.get('assignee')
                    print(f'  ID: {ticket_id}, Status: {status}, Assignee: {assignee}')
    
    elif isinstance(data, dict):
        print(f'Response Format: DICT')
        print(f'Keys: {list(data.keys())}')
        pprint(data, width=120)

if __name__ == '__main__':
    success = test_pm_api()
    sys.exit(0 if success else 1)
