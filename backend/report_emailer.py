"""
Email helper for the Monthly Team Report PDF.

Configured via environment variables (see backend/.env.example). Email
sending is OFF by default - set MONTHLY_REPORT_EMAIL_ENABLED=true to
turn it on.

Required env vars when enabled:
    SMTP_HOST                  - e.g. smtp.gmail.com
    SMTP_PORT                  - e.g. 587 (default)
    SMTP_USERNAME              - SMTP login
    SMTP_PASSWORD              - SMTP password / app password
    MONTHLY_REPORT_RECIPIENTS  - comma-separated To: list

Optional:
    SMTP_USE_TLS               - true/false (default: true)
    SMTP_FROM                  - From address (default: SMTP_USERNAME)
    SMTP_FROM_NAME             - Display name on the From header
    MONTHLY_REPORT_CC          - comma-separated Cc: list
"""

import logging
import mimetypes
import os
import smtplib
from email.message import EmailMessage
from typing import Iterable, List, Optional

logger = logging.getLogger(__name__)


def _split_recipients(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [x.strip() for x in value.split(",") if x.strip()]


def email_enabled() -> bool:
    return os.getenv("MONTHLY_REPORT_EMAIL_ENABLED", "false").lower() in (
        "true",
        "1",
        "yes",
        "on",
    )


def send_pdf_report(
    pdf_path,
    subject: str,
    body_text: str,
    recipients: Optional[Iterable[str]] = None,
    cc: Optional[Iterable[str]] = None,
) -> dict:
    """Send one or more PDF reports via SMTP in a single email.

    pdf_path may be a single string or an iterable of strings. Returns a
    dict describing the result; never raises so callers can keep going
    on email failure.
    """
    if not email_enabled():
        return {"sent": False, "skipped": True, "reason": "MONTHLY_REPORT_EMAIL_ENABLED is false"}

    if isinstance(pdf_path, (str, os.PathLike)):
        attachments = [str(pdf_path)]
    else:
        attachments = [str(p) for p in pdf_path]

    missing = [p for p in attachments if not os.path.exists(p)]
    if missing:
        return {"sent": False, "error": f"Attachment(s) not found: {missing}"}

    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes", "on")

    if not smtp_host or not smtp_user or not smtp_pass:
        return {
            "sent": False,
            "error": "SMTP_HOST, SMTP_USERNAME and SMTP_PASSWORD must all be set",
        }

    to_addrs = list(recipients) if recipients else _split_recipients(
        os.getenv("MONTHLY_REPORT_RECIPIENTS")
    )
    cc_addrs = list(cc) if cc else _split_recipients(os.getenv("MONTHLY_REPORT_CC"))
    if not to_addrs:
        return {
            "sent": False,
            "error": "No recipients (set MONTHLY_REPORT_RECIPIENTS or pass recipients=)",
        }

    from_addr = os.getenv("SMTP_FROM") or smtp_user
    from_name = os.getenv("SMTP_FROM_NAME")
    from_header = f"{from_name} <{from_addr}>" if from_name else from_addr

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_header
    msg["To"] = ", ".join(to_addrs)
    if cc_addrs:
        msg["Cc"] = ", ".join(cc_addrs)
    msg.set_content(body_text)

    for path in attachments:
        ctype, _ = mimetypes.guess_type(path)
        maintype, subtype = (ctype or "application/pdf").split("/", 1)
        with open(path, "rb") as fh:
            msg.add_attachment(
                fh.read(),
                maintype=maintype,
                subtype=subtype,
                filename=os.path.basename(path),
            )

    all_recipients = to_addrs + cc_addrs
    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30) as smtp:
                smtp.login(smtp_user, smtp_pass)
                smtp.send_message(msg, to_addrs=all_recipients)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
                smtp.ehlo()
                if use_tls:
                    smtp.starttls()
                    smtp.ehlo()
                smtp.login(smtp_user, smtp_pass)
                smtp.send_message(msg, to_addrs=all_recipients)
        logger.info(
            f"Monthly report emailed to {len(all_recipients)} recipient(s) "
            f"with {len(attachments)} attachment(s)"
        )
        return {
            "sent": True,
            "recipients": all_recipients,
            "attachments": attachments,
        }
    except Exception as e:
        logger.error(f"Failed to email monthly report: {e}", exc_info=True)
        return {"sent": False, "error": str(e), "attachments": attachments}
