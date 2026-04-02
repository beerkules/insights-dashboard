"""
TikTok Spark Ads Automation - Configuration
Hashtag Hamburg GmbH

Fill in your credentials after API approval.
"""

import os

# ─── TikTok API Credentials ───────────────────────────────────
# Get these from: https://business-api.tiktok.com/portal/apps
APP_ID = os.environ.get("TIKTOK_APP_ID", "")
APP_SECRET = os.environ.get("TIKTOK_APP_SECRET", "")
ACCESS_TOKEN = os.environ.get("TIKTOK_ACCESS_TOKEN", "")

# Get this from TikTok Ads Manager → Account Settings
ADVERTISER_ID = os.environ.get("TIKTOK_ADVERTISER_ID", "")

# ─── API Configuration ────────────────────────────────────────
BASE_URL = "https://business-api.tiktok.com/open_api"
API_VERSION = "v1.3"

# ─── Campaign Settings ────────────────────────────────────────
# Budget per post in EUR (will be converted to local currency by API)
BUDGET_PER_POST = 100.0  # €100 total
CAMPAIGN_DURATION_DAYS = 5  # Spread over 5 days
DAILY_BUDGET = BUDGET_PER_POST / CAMPAIGN_DURATION_DAYS  # €20/day

# Campaign objective
OBJECTIVE = "VIDEO_VIEWS"

# Placement
PLACEMENTS = ["PLACEMENT_TIKTOK"]

# Target locations (DE = Germany)
TARGET_LOCATIONS = ["DE"]

# ─── Post Detection ───────────────────────────────────────────
# File to track which posts have already been promoted
PROMOTED_POSTS_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "promoted_posts.json"
)

# ─── Post Filter Schema ──────────────────────────────────────
# Define which posts should be promoted automatically.
# Set to None to promote ALL new posts.
# Examples:
#   REQUIRED_HASHTAGS = ["#ad", "#sponsored"]
#   REQUIRED_CAPTION_KEYWORDS = ["neues video", "check out"]
REQUIRED_HASHTAGS = None  # e.g., ["#promote", "#boost"]
REQUIRED_CAPTION_KEYWORDS = None  # e.g., ["launch", "new"]

# ─── Email Notifications ─────────────────────────────────────
NOTIFICATION_EMAIL = "moin@hashtaghamburg.de"

# SMTP settings (use your mail server or a service like Gmail, Mailgun, etc.)
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")

# ─── Webhook Settings ────────────────────────────────────────
WEBHOOK_PORT = int(os.environ.get("WEBHOOK_PORT", "5050"))
WEBHOOK_VERIFY_TOKEN = os.environ.get("WEBHOOK_VERIFY_TOKEN", "hashtaghamburg_verify_2024")

# ─── Logging ──────────────────────────────────────────────────
LOG_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "automation.log"
)
