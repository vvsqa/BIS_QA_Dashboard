#!/usr/bin/env python3
"""
Export PM Tracker tickets to Excel file
"""
import sys
import requests
import json
from datetime import datetime

def fetch_tickets(url, api_key):
    """Fetch tickets from PM Tracker API"""
    print(f"Fetching tickets from API...")
    headers = {"authID": api_key}
    response = requests.get(url, headers=headers, timeout=60)
    response.raise_for_status()
    return response.json()

def export_to_excel(data, output_file):
    """Export ticket data to Excel"""
    try:
        import pandas as pd
    except ImportError:
        print("Installing pandas for Excel export...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "openpyxl", "-q"])
        import pandas as pd
    
    print(f"Exporting {len(data)} tickets to Excel...")
    
    # Convert to DataFrame
    df = pd.DataFrame(data)
    
    # Write to Excel with formatting
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='Tickets', index=False)
        
        # Auto-adjust column widths
        workbook = writer.book
        worksheet = writer.sheets['Tickets']
        
        for column in worksheet.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)  # Cap at 50 chars
            worksheet.column_dimensions[column_letter].width = adjusted_width
    
    print(f"✓ Successfully exported to {output_file}")
    print(f"  Total records: {len(data)}")
    print(f"  Total fields: {len(df.columns)}")
    print(f"  Columns: {', '.join(df.columns.tolist())}")

def main():
    url = "https://www.bissafety.app/rest/v.01/pm/ticket-export"
    api_key = "Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7"
    output_file = "PM_Tracker_Tickets.xlsx"
    
    try:
        # Fetch data
        data = fetch_tickets(url, api_key)
        
        # Handle different response formats
        if isinstance(data, list):
            tickets = data
        elif isinstance(data, dict) and 'tickets' in data:
            tickets = data['tickets']
        elif isinstance(data, dict) and 'data' in data:
            tickets = data['data']
        else:
            print(f"Error: Unexpected response format")
            return 1
        
        # Export to Excel
        export_to_excel(tickets, output_file)
        return 0
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching from API: {e}")
        return 1
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
