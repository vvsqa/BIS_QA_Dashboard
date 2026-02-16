# Automatic Monthly Database Backup Plan

This document outlines the strategy for setting up automatic monthly database backups for the QA Dashboard application in production.

---

## 1. Backup Script

Create a backup script (`backup_database.py` or `backup_database.sh`) that:

- Creates a timestamped PostgreSQL dump using `pg_dump`
- Compresses the dump file (gzip)
- Stores backups in a designated folder
- Optionally uploads to cloud storage (AWS S3, Google Cloud Storage, etc.)
- Cleans up old backups based on retention policy

---

## 2. Configuration Options

| Setting | Description | Recommended Value |
|---------|-------------|-------------------|
| `BACKUP_DIR` | Local backup storage path | `/var/backups/qa-dashboard/` |
| `RETENTION_DAYS` | Days to keep local backups | 90 (3 months) |
| `CLOUD_UPLOAD` | Enable cloud backup | `true` for production |
| `CLOUD_BUCKET` | S3/GCS bucket name | `qa-dashboard-backups` |
| `NOTIFY_EMAIL` | Email for backup alerts | Admin email |

Add these to your `.env` file:

```env
# Database Backup Configuration
BACKUP_DIR=/var/backups/qa-dashboard/
BACKUP_RETENTION_DAYS=90
BACKUP_CLOUD_UPLOAD=false
BACKUP_CLOUD_BUCKET=qa-dashboard-backups
BACKUP_NOTIFY_EMAIL=admin@example.com
```

---

## 3. Scheduling Options

### Option A: Linux Cron Job (Recommended for Linux servers)

```bash
# Edit crontab
crontab -e

# Add this line to run on 1st of every month at 2 AM
0 2 1 * * /path/to/backend/backup_database.sh >> /var/log/qa-backup.log 2>&1
```

### Option B: Windows Task Scheduler

1. Open **Task Scheduler**
2. Click **Create Basic Task**
3. Name: `QA Dashboard Monthly Backup`
4. Trigger: **Monthly**, Day **1**, Time **2:00 AM**
5. Action: **Start a program**
   - Program: `python`
   - Arguments: `backup_database.py`
   - Start in: `D:\path\to\qa-dashboard-app\backend`
6. Click **Finish**

### Option C: APScheduler Integration (Built into the app)

Add to `main.py` or a separate scheduler module:

```python
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = BackgroundScheduler()

# Run on the 1st of every month at 2 AM
scheduler.add_job(
    run_database_backup,
    CronTrigger(day=1, hour=2, minute=0),
    id='monthly_db_backup',
    name='Monthly Database Backup'
)

scheduler.start()
```

---

## 4. Backup Script Example

### Python Version (`backup_database.py`)

```python
import os
import subprocess
import gzip
import shutil
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# Configuration
DB_NAME = os.getenv("DB_NAME", "qa_dashboard")
DB_USER = os.getenv("DB_USER", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

BACKUP_DIR = os.getenv("BACKUP_DIR", "./backups")
RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "90"))

def create_backup():
    """Create a compressed database backup."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"qa_dashboard_backup_{timestamp}.sql")
    compressed_file = f"{backup_file}.gz"
    
    # Set password environment variable
    env = os.environ.copy()
    env["PGPASSWORD"] = DB_PASSWORD
    
    # Run pg_dump
    cmd = [
        "pg_dump",
        "-h", DB_HOST,
        "-p", DB_PORT,
        "-U", DB_USER,
        "-d", DB_NAME,
        "-f", backup_file
    ]
    
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"Backup failed: {result.stderr}")
        return None
    
    # Compress the backup
    with open(backup_file, 'rb') as f_in:
        with gzip.open(compressed_file, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    
    # Remove uncompressed file
    os.remove(backup_file)
    
    print(f"Backup created: {compressed_file}")
    return compressed_file

def cleanup_old_backups():
    """Remove backups older than RETENTION_DAYS."""
    cutoff_date = datetime.now() - timedelta(days=RETENTION_DAYS)
    
    for filename in os.listdir(BACKUP_DIR):
        if filename.startswith("qa_dashboard_backup_") and filename.endswith(".sql.gz"):
            filepath = os.path.join(BACKUP_DIR, filename)
            file_time = datetime.fromtimestamp(os.path.getmtime(filepath))
            
            if file_time < cutoff_date:
                os.remove(filepath)
                print(f"Deleted old backup: {filename}")

def main():
    print(f"Starting backup at {datetime.now()}")
    backup_file = create_backup()
    
    if backup_file:
        cleanup_old_backups()
        print("Backup completed successfully")
    else:
        print("Backup failed")

if __name__ == "__main__":
    main()
```

### Bash Version (`backup_database.sh`)

```bash
#!/bin/bash

# Configuration
DB_NAME="${DB_NAME:-qa_dashboard}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qa-dashboard}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-90}"

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Timestamp for filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/qa_dashboard_backup_$TIMESTAMP.sql.gz"

# Create backup
echo "Starting backup at $(date)"
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "Backup created: $BACKUP_FILE"
    
    # Cleanup old backups
    find "$BACKUP_DIR" -name "qa_dashboard_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "Old backups cleaned up"
else
    echo "Backup failed!"
    exit 1
fi

echo "Backup completed at $(date)"
```

---

## 5. Backup Contents

Each backup includes all database tables:

- `ticket_tracking` - PM Tracker tickets
- `users` - User accounts
- `employees` - Employee records
- `bugs` - Redmine bugs
- `bug_status_history` - Bug status changes
- `qa_tasks` / `dev_tasks` - Task planning data
- `client_profiles` - Client information
- `testrail_*` - TestRail sync data
- All other application tables

**Filename format:** `qa_dashboard_backup_YYYYMMDD_HHMMSS.sql.gz`

---

## 6. Cloud Backup (Optional)

### AWS S3 Upload

Add to the backup script:

```python
import boto3

def upload_to_s3(file_path, bucket_name):
    s3 = boto3.client('s3')
    filename = os.path.basename(file_path)
    s3.upload_file(file_path, bucket_name, f"backups/{filename}")
    print(f"Uploaded to S3: s3://{bucket_name}/backups/{filename}")
```

### Google Cloud Storage Upload

```python
from google.cloud import storage

def upload_to_gcs(file_path, bucket_name):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    filename = os.path.basename(file_path)
    blob = bucket.blob(f"backups/{filename}")
    blob.upload_from_filename(file_path)
    print(f"Uploaded to GCS: gs://{bucket_name}/backups/{filename}")
```

---

## 7. Notification & Monitoring

### Email Notification

```python
import smtplib
from email.mime.text import MIMEText

def send_notification(subject, message):
    msg = MIMEText(message)
    msg['Subject'] = subject
    msg['From'] = os.getenv("SMTP_FROM")
    msg['To'] = os.getenv("BACKUP_NOTIFY_EMAIL")
    
    with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", 587))) as server:
        server.starttls()
        server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
        server.send_message(msg)
```

### Log File

All backups are logged to `/var/log/qa-backup.log` (or a configured path) for audit purposes.

---

## 8. Restore Process

To restore from a backup:

```bash
# Decompress and restore
gunzip -c qa_dashboard_backup_20260201_020000.sql.gz | psql -h localhost -U postgres -d qa_dashboard
```

Or with Python:

```python
import gzip
import subprocess

def restore_backup(backup_file):
    with gzip.open(backup_file, 'rb') as f:
        subprocess.run(
            ["psql", "-h", DB_HOST, "-U", DB_USER, "-d", DB_NAME],
            stdin=f,
            env={"PGPASSWORD": DB_PASSWORD}
        )
```

---

## 9. Quick Start Checklist

- [ ] Choose scheduling method (Cron/Task Scheduler/APScheduler)
- [ ] Create backup directory with appropriate permissions
- [ ] Add backup configuration to `.env`
- [ ] Deploy backup script to server
- [ ] Set up scheduled task
- [ ] Test backup creation manually
- [ ] Test restore process
- [ ] Configure cloud upload (optional)
- [ ] Set up email notifications (optional)
- [ ] Monitor first few automated backups

---

## 10. Recommended Schedule

| Backup Type | Frequency | Retention |
|-------------|-----------|-----------|
| Full Backup | Monthly (1st) | 12 months |
| Incremental | Weekly (optional) | 4 weeks |

For most use cases, monthly full backups with 90-day retention provides a good balance of storage efficiency and recovery options.
