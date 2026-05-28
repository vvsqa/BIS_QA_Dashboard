"""
Monthly Team Report Scheduler.

Runs `monthly_team_report.generate_report()` on the LAST DAY of every
month using APScheduler's CronTrigger (`day='last'`), producing a PDF
under backend/reports/Monthly_Team_Report_<YYYY-MM>.pdf.

Environment variables:
    MONTHLY_REPORT_AUTO   - "true"/"false" (default: true) toggle
    MONTHLY_REPORT_HOUR   - hour (0-23, default: 18)
    MONTHLY_REPORT_MINUTE - minute (0-59, default: 0)
"""

import logging
import os
from datetime import datetime
from typing import Optional

from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from monthly_team_report import generate_report, get_month_range
from report_emailer import email_enabled, send_pdf_report

logger = logging.getLogger(__name__)

JOB_ID = "monthly_team_report"
RUN_HOUR = int(os.getenv("MONTHLY_REPORT_HOUR", "18"))
RUN_MINUTE = int(os.getenv("MONTHLY_REPORT_MINUTE", "0"))


class MonthlyReportScheduler:
    def __init__(self):
        self.scheduler: Optional[BackgroundScheduler] = None
        self.last_run_time: Optional[datetime] = None
        self.last_run_status: Optional[dict] = None
        self.is_running = False

    def start(self) -> None:
        if self.is_running:
            logger.warning("Monthly report scheduler is already running")
            return
        self.scheduler = BackgroundScheduler()
        self.scheduler.start()
        # `day='last'` fires on the last calendar day of every month.
        trigger = CronTrigger(day="last", hour=RUN_HOUR, minute=RUN_MINUTE)
        self.scheduler.add_job(
            func=self._run_job,
            trigger=trigger,
            id=JOB_ID,
            name="Monthly Team Report (last day of month)",
            replace_existing=True,
            max_instances=1,
        )
        self.scheduler.add_listener(
            self._on_job_executed, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR
        )
        self.is_running = True
        logger.info(
            "Monthly team report scheduler started. Fires on last day of every month "
            f"at {RUN_HOUR:02d}:{RUN_MINUTE:02d}."
        )

    def stop(self) -> None:
        if self.scheduler and self.is_running:
            self.scheduler.shutdown(wait=True)
            self.is_running = False
            logger.info("Monthly team report scheduler stopped")

    def _run_job(self) -> None:
        try:
            logger.info("Running scheduled monthly team reports (one PDF per team)")
            outputs = generate_report()  # current month, both teams
            email_result = self._maybe_email(outputs, month_str=None)
            self.last_run_time = datetime.utcnow()
            self.last_run_status = {
                "success": True,
                "reports": outputs,
                "email": email_result,
                "ran_at": self.last_run_time.isoformat(),
            }
            for item in outputs:
                logger.info(f"Monthly {item['team']} report saved to {item['path']}")
        except Exception as e:
            logger.error(f"Monthly report generation failed: {e}", exc_info=True)
            self.last_run_time = datetime.utcnow()
            self.last_run_status = {
                "success": False,
                "error": str(e),
                "ran_at": self.last_run_time.isoformat(),
            }

    @staticmethod
    def _maybe_email(outputs, month_str=None) -> dict:
        if not email_enabled():
            return {"sent": False, "skipped": True, "reason": "email disabled"}
        year, mon, _, _ = get_month_range(month_str)
        period_label = datetime(year, mon, 1).strftime("%B %Y")
        team_list = ", ".join(item["label"] for item in outputs) or "Team"
        subject = f"Monthly Team Reports - {period_label}"
        body = (
            f"Hi,\n\nAttached are the Monthly Team Reports for {period_label}:\n"
            + "\n".join(f"  - {item['label']} ({os.path.basename(item['path'])})" for item in outputs)
            + "\n\nGenerated automatically by the QA Dashboard.\n"
        )
        return send_pdf_report(
            [item["path"] for item in outputs],
            subject=subject,
            body_text=body,
        )

    def _on_job_executed(self, event) -> None:
        if event.exception:
            logger.error(f"Monthly report job raised an exception: {event.exception}")
        else:
            logger.debug("Monthly report job executed successfully")

    def trigger_manual(
        self,
        month: Optional[str] = None,
        send_email: Optional[bool] = None,
        teams: Optional[list] = None,
    ) -> dict:
        try:
            outputs = generate_report(month, teams=teams)
            email_result: Optional[dict] = None
            if send_email is False:
                email_result = {"sent": False, "skipped": True, "reason": "send_email=False"}
            elif send_email or email_enabled():
                email_result = self._maybe_email(outputs, month_str=month)
            self.last_run_time = datetime.utcnow()
            self.last_run_status = {
                "success": True,
                "reports": outputs,
                "email": email_result,
                "ran_at": self.last_run_time.isoformat(),
            }
            return self.last_run_status
        except Exception as e:
            logger.error(f"Manual monthly report run failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def get_status(self) -> dict:
        if not self.scheduler:
            return {"running": False, "last_run": None, "next_run": None}
        job = self.scheduler.get_job(JOB_ID)
        next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
        return {
            "running": self.is_running,
            "schedule": f"day='last' {RUN_HOUR:02d}:{RUN_MINUTE:02d}",
            "last_run": self.last_run_time.isoformat() if self.last_run_time else None,
            "last_run_status": self.last_run_status,
            "next_run": next_run,
        }


_instance: Optional[MonthlyReportScheduler] = None


def get_monthly_report_scheduler() -> MonthlyReportScheduler:
    global _instance
    if _instance is None:
        _instance = MonthlyReportScheduler()
    return _instance


def start_monthly_report_scheduler() -> bool:
    enabled = os.getenv("MONTHLY_REPORT_AUTO", "true").lower() in (
        "true",
        "1",
        "yes",
        "on",
    )
    if not enabled:
        return False
    scheduler = get_monthly_report_scheduler()
    scheduler.start()
    return True


def stop_monthly_report_scheduler() -> None:
    scheduler = get_monthly_report_scheduler()
    scheduler.stop()


def get_monthly_report_status() -> dict:
    return get_monthly_report_scheduler().get_status()
