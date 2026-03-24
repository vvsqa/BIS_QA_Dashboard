"""
Standalone script to generate QA Metrics Excel with 4 key metrics.
Run directly to generate the Excel file.

Supports time period filtering:
- past_week: Last 7 days
- past_month: Last 30 days  
- past_quarter: Last 90 days
- past_year: Last 365 days
- overall: All data (default)
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from qa_metrics_excel import generate_qa_metrics_excel_with_periods

def main():
    # Find the latest PM Activity Export file
    reports_dir = Path("reports")
    export_files = list(reports_dir.glob("PM_Activity_Export_*.csv"))
    
    if not export_files:
        print("ERROR: No PM Activity Export file found in reports directory.")
        print("Please run the PM activity fetch script first.")
        return
    
    latest_export = max(export_files, key=lambda f: f.stat().st_mtime)
    print(f"Loading data from: {latest_export}")
    
    # Load JSON data
    try:
        with open(latest_export, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
        print(f"Loaded {len(raw_data)} status change records")
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse file: {e}")
        return
    
    # Group by ticket
    ticket_history = defaultdict(list)
    for record in raw_data:
        ticket_id = record.get('ticketId')
        if ticket_id:
            try:
                ticket_id = int(ticket_id)
            except (ValueError, TypeError):
                pass
            
            change_date = datetime.strptime(record['statusChangeDate'], '%Y-%m-%d %H:%M:%S')
            ticket_history[ticket_id].append({
                'date': change_date,
                'old_status': record.get('oldStatus'),
                'new_status': record.get('newStatus'),
            })
    
    print(f"Found {len(ticket_history)} unique tickets")
    
    # Sort each ticket's history
    for tid in ticket_history:
        ticket_history[tid].sort(key=lambda x: x['date'])
    
    # Generate Excel with all time periods
    output_path = reports_dir / f"QA_Metrics_AllPeriods_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    print(f"Generating Excel file with time period analysis...")
    generated_path = generate_qa_metrics_excel_with_periods(
        ticket_history=ticket_history,
        ticket_lookup={},  # Empty lookup for standalone
        output_path=output_path
    )
    
    print(f"\n{'='*60}")
    print(f"SUCCESS! Excel file generated:")
    print(f"  {generated_path}")
    print(f"{'='*60}")
    print(f"\nThe Excel file contains multiple sheets:")
    print("  1. Summary - All time periods comparison")
    print("  2. Past Week - Tickets list for last 7 days")
    print("  3. Past Month - Tickets list for last 30 days")
    print("  4. Past Quarter - Tickets list for last 90 days")
    print("  5. Past Year - Tickets list for last 365 days")
    print("  6. Overall - All tickets list")
    print("  7. Methodology - Definitions and formula explanations")
    print(f"\nCalculated columns are highlighted in YELLOW.")

if __name__ == "__main__":
    main()
