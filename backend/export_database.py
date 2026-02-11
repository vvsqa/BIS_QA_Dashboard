"""
Export PostgreSQL database to SQL file for DevOps deployment.
Run from backend folder: python export_database.py

Creates: qa_dashboard_dump.sql in the project root.
"""
import os
import sys
from datetime import datetime, date
from decimal import Decimal

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import engine
from sqlalchemy import text, inspect

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "qa_dashboard_dump.sql")


def escape_value(val):
    """Escape a value for SQL INSERT."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float, Decimal)):
        return str(val)
    if isinstance(val, (datetime, date)):
        return f"'{val.isoformat()}'"
    if isinstance(val, bytes):
        return f"E'\\\\x{val.hex()}'"
    # String: escape single quotes
    s = str(val).replace("'", "''").replace("\\", "\\\\")
    return f"'{s}'"


def export_table(conn, table_name, f):
    """Export a single table's data as INSERT statements."""
    try:
        result = conn.execute(text(f'SELECT * FROM "{table_name}"'))
        rows = result.fetchall()
        if not rows:
            f.write(f"-- Table {table_name}: no data\n\n")
            return 0
        
        columns = result.keys()
        col_list = ", ".join(f'"{c}"' for c in columns)
        
        f.write(f"-- Table: {table_name} ({len(rows)} rows)\n")
        f.write(f'DELETE FROM "{table_name}";\n')
        
        for row in rows:
            values = ", ".join(escape_value(v) for v in row)
            f.write(f'INSERT INTO "{table_name}" ({col_list}) VALUES ({values});\n')
        
        f.write("\n")
        return len(rows)
    except Exception as e:
        f.write(f"-- Error exporting {table_name}: {e}\n\n")
        return 0


def main():
    print("Connecting to database...")
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    
    print(f"Found {len(tables)} tables")
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("-- QA Dashboard Database Export\n")
        f.write(f"-- Generated: {datetime.now().isoformat()}\n")
        f.write("-- This file contains data for all tables.\n")
        f.write("-- Run on target database: psql -d qa_dashboard -f qa_dashboard_dump.sql\n\n")
        f.write("SET client_encoding = 'UTF8';\n")
        f.write("SET standard_conforming_strings = on;\n\n")
        
        total_rows = 0
        with engine.connect() as conn:
            for table in tables:
                print(f"  Exporting {table}...")
                rows = export_table(conn, table, f)
                total_rows += rows
                print(f"    -> {rows} rows")
        
        f.write(f"\n-- Export complete: {total_rows} total rows from {len(tables)} tables\n")
    
    print(f"\nExport complete!")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Total: {total_rows} rows from {len(tables)} tables")
    print(f"\nShare this file with DevOps. They can restore with:")
    print(f"  psql -h <DB_HOST> -U <DB_USER> -d qa_dashboard -f qa_dashboard_dump.sql")


if __name__ == "__main__":
    main()
