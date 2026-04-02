#!/usr/bin/env python3
"""
TikTok Spark Ads Automation
Hashtag Hamburg GmbH

Monitors TikTok business account for new posts and automatically
creates Spark Ad campaigns with €100 budget over 5 days.

Usage:
    python main.py              # Run once (for cron)
    python main.py --dry-run    # Check for new posts without creating ads
"""

import json
import logging
import sys
import os
from datetime import datetime

from config import (
    ACCESS_TOKEN, ADVERTISER_ID, PROMOTED_POSTS_FILE, LOG_FILE,
    REQUIRED_HASHTAGS, REQUIRED_CAPTION_KEYWORDS,
    BUDGET_PER_POST, CAMPAIGN_DURATION_DAYS,
)
from tiktok_api import TikTokAPI
from notifier import send_ad_notification, send_error_notification

# ─── Logging Setup ────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ─── Promoted Posts Tracker ───────────────────────────────────

def load_promoted_posts() -> dict:
    """Load the dict of already-promoted post IDs."""
    if os.path.exists(PROMOTED_POSTS_FILE):
        with open(PROMOTED_POSTS_FILE, "r") as f:
            return json.load(f)
    return {}


def save_promoted_posts(posts: dict):
    """Save the dict of promoted post IDs."""
    with open(PROMOTED_POSTS_FILE, "w") as f:
        json.dump(posts, f, indent=2)


# ─── Post Filter ─────────────────────────────────────────────

def matches_schema(video: dict) -> bool:
    """
    Check if a video matches the promotion schema.
    Returns True if the post should be promoted.
    """
    caption = video.get("video_info", {}).get("caption", "") or ""
    caption = video.get("title", caption)  # fallback

    # Check hashtags
    if REQUIRED_HASHTAGS:
        caption_lower = caption.lower()
        if not any(tag.lower() in caption_lower for tag in REQUIRED_HASHTAGS):
            return False

    # Check keywords
    if REQUIRED_CAPTION_KEYWORDS:
        caption_lower = caption.lower()
        if not any(kw.lower() in caption_lower for kw in REQUIRED_CAPTION_KEYWORDS):
            return False

    return True


# ─── Main Logic ──────────────────────────────────────────────

def run(dry_run: bool = False):
    """
    Main automation loop:
    1. Fetch recent videos
    2. Filter for new, unprocessed posts matching schema
    3. Create Spark Ad campaigns for each
    """
    logger.info("=" * 60)
    logger.info("TikTok Spark Ads Automation - Starting")
    logger.info(f"Budget: €{BUDGET_PER_POST} over {CAMPAIGN_DURATION_DAYS} days per post")
    logger.info(f"Dry run: {dry_run}")
    logger.info("=" * 60)

    # Validate config
    if not ACCESS_TOKEN or not ADVERTISER_ID:
        logger.error(
            "Missing credentials. Set TIKTOK_ACCESS_TOKEN and "
            "TIKTOK_ADVERTISER_ID environment variables."
        )
        sys.exit(1)

    api = TikTokAPI()
    promoted = load_promoted_posts()

    # Fetch recent videos
    videos = api.get_tiktok_account_videos()
    logger.info(f"Found {len(videos)} videos on account")

    if not videos:
        logger.info("No videos found. Exiting.")
        return

    # Filter for new posts
    new_posts = []
    for video in videos:
        video_id = video.get("video_id") or video.get("item_id", "")
        if not video_id:
            continue
        if video_id in promoted:
            continue
        if not matches_schema(video):
            logger.info(f"Skipping {video_id} - does not match schema")
            continue
        new_posts.append(video)

    logger.info(f"New posts to promote: {len(new_posts)}")

    if not new_posts:
        logger.info("No new posts to promote. Exiting.")
        return

    # Promote each new post
    for video in new_posts:
        video_id = video.get("video_id") or video.get("item_id", "")
        title = video.get("title", video.get("video_info", {}).get("caption", ""))
        logger.info(f"Processing: {video_id} - {title[:50]}")

        if dry_run:
            logger.info(f"[DRY RUN] Would promote: {video_id}")
            continue

        result = api.promote_post_with_details(video_id=video_id, post_title=title or "")

        if result["success"]:
            promoted[video_id] = {
                "promoted_at": datetime.utcnow().isoformat(),
                "title": (title or "")[:100],
                "trigger": "cron",
            }
            save_promoted_posts(promoted)
            logger.info(f"Successfully promoted: {video_id}")

            # Send email notification
            send_ad_notification(
                video_id=video_id,
                title=title or "",
                campaign_id=result["campaign_id"],
                adgroup_id=result["adgroup_id"],
                ad_id=result["ad_id"],
            )
        else:
            logger.error(f"Failed to promote: {video_id}")
            send_error_notification(video_id, result.get("error", "Unknown"))

    logger.info("Automation run complete.")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    run(dry_run=dry)
