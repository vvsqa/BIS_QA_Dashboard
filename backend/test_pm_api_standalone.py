#!/usr/bin/env python3
"""
Standalone PM Tracker API Test - Try different authentication methods
"""
import requests
import json
from pprint import pprint
import sys

def test_pm_api_with_headers():
    url = 'https://www.bissafety.app/rest/v.01/pm/ticket-export'
    api_key = 'Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7'  # From PM team
    
    # Try different header formats and query params
    header_options = [
        ("Query Param: key", None, {"key": api_key}),
        ("Query Param: apiKey", None, {"apiKey": api_key}),
        ("Query Param: api_key", None, {"api_key": api_key}),
        ("Query Param: authID", None, {"authID": api_key}),
        ("Authorization: Bearer", {"Authorization": f"Bearer {api_key}"}, None),
        ("Authorization (direct)", {"Authorization": api_key}, None),
        ("X-API-Key", {"X-API-Key": api_key}, None),
        ("apiKey header", {"apiKey": api_key}, None),
        ("api_key header", {"api_key": api_key}, None),
        ("API-Key", {"API-Key": api_key}, None),
        ("Authorization: ApiKey", {"Authorization": f"ApiKey {api_key}"}, None),
        ("PM-API-Key", {"PM-API-Key": api_key}, None),
    ]
    
    print("\n" + "=" * 100)
    print("PM TRACKER API TEST - Trying different header authentication methods")
    print("=" * 100)
    print(f"URL: {url}")
    print(f"API Key: {api_key[:10]}...{api_key[-5:]}")
    print()
    
    for header_name, headers in header_options:
        print(f"\n{'-' * 100}")
        print(f"Attempt: {header_name}")
        print(f"Headers: {headers}")
        print(f"{'-' * 100}")
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            print(f'Status Code: {response.status_code}')
            print(f'Content-Type: {response.headers.get("content-type")}')
            
            try:
                data = response.json()
                
                if response.status_code == 200:
                    print(f'✓ SUCCESS with {header_name}!')
                    print(f'Response Type: {type(data).__name__}')
                    
                    # Show data summary
                    if isinstance(data, list):
                        print(f'Total Records: {len(data)}')
                        if len(data) > 0:
                            print(f'First Record Keys: {list(data[0].keys())}')
                            pprint(data[0], width=120)
                    elif isinstance(data, dict):
                        print(f'Response Keys: {list(data.keys())}')
                        if 'error' not in data:
                            pprint(data, width=120)
                    
                    return True  # Success!
                    
                elif response.status_code == 401:
                    error_detail = data.get('error_description') or data.get('detail') or str(data)
                    print(f'✗ Unauthorized: {error_detail}')
                elif response.status_code == 400:
                    print(f'✗ Bad Request: {data}')
                else:
                    print(f'✗ Error {response.status_code}: {data}')
                    
            except json.JSONDecodeError:
                print(f'✗ Non-JSON response: {response.text[:200]}')
                
        except requests.exceptions.Timeout:
            print(f'✗ Timeout')
        except requests.exceptions.ConnectionError as e:
            print(f'✗ Connection error: {e}')
        except Exception as e:
            print(f'✗ Error: {type(e).__name__}: {e}')
    
    print(f"\n{'=' * 100}")
    print("❌ All header methods failed")
    print("=" * 100)
    print("\nNext steps:")
    print("1. Ask PM team exactly how to authenticate:")
    print("   - Which HTTP header to use?")
    print("   - What's the exact format? (e.g., 'Bearer <key>' or just '<key>')")
    print("   - Is there a prefix? (e.g., 'ApiKey', 'Token', etc.)")
    print("2. Ask for a working example cURL command")
    print("3. Ask if authentication is via header or query parameter")
    
    return False

if __name__ == '__main__':
    success = test_pm_api_with_headers()
    sys.exit(0 if success else 1)

