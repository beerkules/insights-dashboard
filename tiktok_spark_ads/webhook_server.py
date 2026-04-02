#!/usr/bin/env python3
"""
TikTok Webhook Server
Listens for TikTok content events and triggers Spark Ad creation in real-time.

Run with: python webhook_server.py
Or behind nginx/apache as reverse proxy.
"""

import hashlib
import hmac
import json
import logging
import sys
from datetime import datetime

from flask import Flask, request, jsonify

from config import (
    ACCESS_TOKEN, ADVERTISER_ID, APP_SECRET,
    PROMOTED_POSTS_FILE, LOG_FILE, WEBHOOK_PORT, WEBHOOK_VERIFY_TOKEN,
)
from tiktok_api import TikTokAPI
from notifier import send_ad_notification, send_error_notification

# ─── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
api = TikTokAPI()


# ─── Promoted Posts Tracker ───────────────────────────────────

def load_promoted() -> dict:
    import os
    if os.path.exists(PROMOTED_POSTS_FILE):
        with open(PROMOTED_POSTS_FILE, "r") as f:
            return json.load(f)
    return {}


def save_promoted(posts: dict):
    with open(PROMOTED_POSTS_FILE, "w") as f:
        json.dump(posts, f, indent=2)


# ─── Webhook Verification ────────────────────────────────────

@app.route("/webhook/tiktok", methods=["GET"])
def verify_webhook():
    """
    TikTok sends a GET request to verify the webhook URL.
    Must return the challenge value.
    """
    challenge = request.args.get("challenge", "")
    verify_token = request.args.get("verify_token", "")

    if verify_token == WEBHOOK_VERIFY_TOKEN:
        logger.info(f"Webhook verified with challenge: {challenge}")
        return challenge, 200
    else:
        logger.warning("Webhook verification failed - wrong verify_token")
        return "Forbidden", 403


# ─── Webhook Event Handler ───────────────────────────────────

@app.route("/webhook/tiktok", methods=["POST"])
def handle_webhook():
    """
    Handle incoming TikTok webhook events.
    Triggered when new content is published on the linked account.
    """
    # Verify signature (optional but recommended)
    signature = request.headers.get("X-TikTok-Signature", "")
    if APP_SECRET and signature:
        body = request.get_data()
        expected = hmac.new(
            APP_SECRET.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            logger.warning("Invalid webhook signature")
            return jsonify({"error": "Invalid signature"}), 401

    data = request.get_json(silent=True) or {}
    event_type = data.get("event", "")
    logger.info(f"Webhook received: event={event_type}")
    logger.info(f"Payload: {json.dumps(data, indent=2)[:500]}")

    # Handle video publish events
    if event_type in ("video.publish", "video.created", "content.publish"):
        handle_new_video(data)
    else:
        logger.info(f"Ignoring event type: {event_type}")

    return jsonify({"status": "ok"}), 200


def handle_new_video(data: dict):
    """Process a new video event and create Spark Ad."""
    video_data = data.get("data", {})
    video_id = (
        video_data.get("video_id")
        or video_data.get("item_id")
        or video_data.get("tiktok_item_id")
        or ""
    )
    title = video_data.get("title", video_data.get("caption", ""))

    if not video_id:
        logger.warning("No video_id in webhook payload, attempting to extract...")
        # Try nested structures
        for key in ("video", "content", "item"):
            nested = video_data.get(key, {})
            if isinstance(nested, dict):
                video_id = nested.get("id", nested.get("video_id", ""))
                title = nested.get("title", nested.get("caption", title))
                if video_id:
                    break

    if not video_id:
        logger.error(f"Could not extract video_id from webhook payload: {data}")
        return

    # Check if already promoted
    promoted = load_promoted()
    if video_id in promoted:
        logger.info(f"Video {video_id} already promoted, skipping")
        return

    logger.info(f"New video detected via webhook: {video_id} - {title[:50]}")

    # Create Spark Ad campaign
    result = api.promote_post_with_details(video_id=video_id, post_title=title or "")

    if result["success"]:
        # Track as promoted
        promoted[video_id] = {
            "promoted_at": datetime.utcnow().isoformat(),
            "title": (title or "")[:100],
            "trigger": "webhook",
        }
        save_promoted(promoted)

        # Send email notification
        send_ad_notification(
            video_id=video_id,
            title=title or "",
            campaign_id=result["campaign_id"],
            adgroup_id=result["adgroup_id"],
            ad_id=result["ad_id"],
        )
        logger.info(f"Video {video_id} promoted + notification sent")
    else:
        send_error_notification(video_id, result.get("error", "Unknown error"))
        logger.error(f"Failed to promote video {video_id}")


# ─── Health Check ─────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint for monitoring."""
    return jsonify({
        "status": "ok",
        "service": "tiktok-spark-ads-automation",
        "timestamp": datetime.utcnow().isoformat(),
    }), 200


# ─── Run Server ───────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"Starting webhook server on port {WEBHOOK_PORT}")
    logger.info(f"Webhook URL: https://hashtaghamburg.de/webhook/tiktok")
    app.run(host="0.0.0.0", port=WEBHOOK_PORT, debug=False)
