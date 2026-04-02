"""
Email notification module.
Sends alerts when a Spark Ad campaign is created.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from config import (
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    NOTIFICATION_EMAIL, BUDGET_PER_POST, CAMPAIGN_DURATION_DAYS, DAILY_BUDGET,
)

logger = logging.getLogger(__name__)


def send_ad_notification(
    video_id: str,
    title: str,
    campaign_id: str,
    adgroup_id: str,
    ad_id: str,
):
    """
    Send email notification that a Spark Ad was created.
    """
    timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")

    subject = f"Spark Ad geschaltet: {title[:40] or video_id}"

    html = f"""
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #1a1a1a;">
        <div style="max-width: 600px; margin: 0 auto;">
            <div style="background: #fe2c55; color: white; padding: 20px; border-radius: 12px 12px 0 0;">
                <h2 style="margin: 0;">Neue Spark Ad geschaltet</h2>
                <p style="margin: 5px 0 0; opacity: 0.9;">{timestamp}</p>
            </div>

            <div style="background: #f8f8f8; padding: 20px; border-radius: 0 0 12px 12px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Post</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;">{title or '(kein Titel)'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Video ID</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;"><code>{video_id}</code></td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Budget</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;">&euro;{BUDGET_PER_POST:.0f} gesamt (&euro;{DAILY_BUDGET:.0f}/Tag &times; {CAMPAIGN_DURATION_DAYS} Tage)</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Ziel</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;">Video Views maximieren</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Campaign ID</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;"><code>{campaign_id}</code></td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Ad Group ID</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;"><code>{adgroup_id}</code></td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; font-weight: 600;">Ad ID</td>
                        <td style="padding: 10px 0;"><code>{ad_id}</code></td>
                    </tr>
                </table>

                <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px; font-size: 14px;">
                    Die Anzeige l&auml;uft automatisch {CAMPAIGN_DURATION_DAYS} Tage und stoppt dann.
                    Pr&uuml;fe den Status im <a href="https://ads.tiktok.com" style="color: #fe2c55;">TikTok Ads Manager</a>.
                </div>
            </div>

            <p style="color: #888; font-size: 12px; text-align: center; margin-top: 15px;">
                Gesendet von Hashtag Spark Ads Automation
            </p>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = NOTIFICATION_EMAIL
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, NOTIFICATION_EMAIL, msg.as_string())
        logger.info(f"Notification email sent to {NOTIFICATION_EMAIL}")
        return True
    except Exception as e:
        logger.error(f"Failed to send notification email: {e}")
        return False


def send_error_notification(video_id: str, error_msg: str):
    """Send email when ad creation fails."""
    timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Spark Ad FEHLER: {video_id}"
    msg["From"] = SMTP_USER
    msg["To"] = NOTIFICATION_EMAIL

    html = f"""
    <html>
    <body style="font-family: sans-serif; padding: 20px;">
        <div style="background: #dc3545; color: white; padding: 15px; border-radius: 8px;">
            <h3 style="margin: 0;">Spark Ad Erstellung fehlgeschlagen</h3>
            <p>{timestamp}</p>
        </div>
        <div style="padding: 15px;">
            <p><strong>Video ID:</strong> <code>{video_id}</code></p>
            <p><strong>Fehler:</strong> {error_msg}</p>
            <p>Bitte im Log pr&uuml;fen: <code>automation.log</code></p>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, NOTIFICATION_EMAIL, msg.as_string())
    except Exception as e:
        logger.error(f"Failed to send error notification: {e}")
