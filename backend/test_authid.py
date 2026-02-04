#!/usr/bin/env python3
"""
Test PM API with authID parameter
"""
import requests
import json

url = 'https://www.bissafety.app/rest/v.01/pm/ticket-export'
api_key = 'Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7'

print("\n" + "=" * 100)
print("Testing PM Tracker API with authID parameter")
print("=" * 100)
print(f"URL: {url}")
print(f"API Key: {api_key[:10]}...{api_key[-5:]}")
print()

try:
    # The error message says "authID is missing or invalid"
    # So try using authID as the parameter name
    response = requests.get(url, params={'authID': api_key}, timeout=10)
    
    print(f'Status Code: {response.status_code}')
    print(f'Content-Type: {response.headers.get("content-type")}')
    print()
    
    data = response.json()
    
    if response.status_code == 200:
        print("=" * 100)
        print("✓ SUCCESS - API Working!")
        print("=" * 100)
        
        # Show metadata
        if 'metadata' in data:
            metadata = data['metadata']
            total = metadata.get('recordCount', 0)
            print(f'\nTotal Records: {total}')
            print(f'Generated At: {metadata.get("generatedAt")}')
        
        # Show tickets
        if 'tickets' in data:
            tickets = data['tickets']
            print(f'\nTickets Retrieved: {len(tickets)}')
            
            if len(tickets) > 0:
                print(f'\nFirst Ticket Fields: {list(tickets[0].keys())}')
                print(f'\nFirst Ticket:')
                import pprint
                pprint.pprint(tickets[0], width=120)
        
        # Show error field
        if 'error' in data:
            error = data.get('error', '')
            if error:
                print(f'\nError field: {error}')
            else:
                print(f'\nNo errors')
    else:
        print("=" * 100)
        print(f"✗ Error {response.status_code}")
        print("=" * 100)
        print(f"Error: {data.get('error')}")
        print(f"Description: {data.get('error_description')}")

except Exception as e:
    print(f'✗ Exception: {type(e).__name__}: {e}')
