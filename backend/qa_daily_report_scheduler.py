"""
QA Daily Report Scheduler

Automatically generates the QA Daily Status Report Excel file every day
at a configurable time (default: 9:00 AM).

Usage:
    python qa_daily_report_scheduler.py              # run scheduler (default 9 AM)
    python qa_daily_report_scheduler.py --hour 18    # run at 6 PM daily
    python qa_daily_report_scheduler.py --now        # generate once immediately and exit

Environment variables (optional in .env):
    QA_DAILY_REPORT_HOUR=9        (0-23, default 9)
    QA_DAILY_REPORT_MINUTE=0      (0-59, default 0)
"""

import sys, os, argparse, signal
from datetime import datetime
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from qa_daily_status_report import generate_report

RUN_HOUR = int(os.getenv("QA_DAILY_REPORT_HOUR", "9"))
RUN_MINUTE = int(os.getenv("QA_DAILY_REPORT_MINUTE", "0"))


def _job():
    """Generate report with error handling."""
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Scheduled run starting...")
    try:
        path = generate_report()
        print(f"[OK] Report saved: {path}")
        # Auto-open on Windows
        if sys.platform == "win32":
            os.startfile(str(path))
    except Exception as exc:
        print(f"[ERROR] {exc}")
        import traceback
        traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="QA Daily Report Scheduler")
    parser.add_argument("--hour", type=int, default=RUN_HOUR, help="Hour to run (0-23)")
    parser.add_argument("--minute", type=int, default=RUN_MINUTE, help="Minute to run (0-59)")
    parser.add_argument("--now", action="store_true", help="Generate once immediately and exit")
    args = parser.parse_args()

    if args.now:
        _job()
        return

    scheduler = BlockingScheduler()
    trigger = CronTrigger(hour=args.hour, minute=args.minute)
    scheduler.add_job(_job, trigger=trigger, id="qa_daily_report", max_instances=1)

    print("=" * 60)
    print("  QA Daily Report Scheduler")
    print(f"  Scheduled to run daily at {args.hour:02d}:{args.minute:02d}")
    print("  Press Ctrl+C to stop")
    print("=" * 60)

    def _shutdown(signum, frame):
        print("\n  Shutting down scheduler...")
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
