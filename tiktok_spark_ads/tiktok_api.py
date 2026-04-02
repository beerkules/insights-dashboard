"""
TikTok Marketing API Client
Handles all API communication.
"""

import json
import logging
import requests
from datetime import datetime, timedelta
from config import (
    BASE_URL, API_VERSION, ACCESS_TOKEN, ADVERTISER_ID,
    DAILY_BUDGET, CAMPAIGN_DURATION_DAYS, OBJECTIVE,
    PLACEMENTS, TARGET_LOCATIONS,
)

logger = logging.getLogger(__name__)


class TikTokAPI:
    """Wrapper for TikTok Marketing API v1.3"""

    def __init__(self, access_token: str = ACCESS_TOKEN, advertiser_id: str = ADVERTISER_ID):
        self.access_token = access_token
        self.advertiser_id = advertiser_id
        self.headers = {
            "Access-Token": self.access_token,
            "Content-Type": "application/json",
        }

    def _url(self, endpoint: str) -> str:
        return f"{BASE_URL}/{API_VERSION}/{endpoint}"

    def _get(self, endpoint: str, params: dict = None) -> dict:
        url = self._url(endpoint)
        params = params or {}
        params["advertiser_id"] = self.advertiser_id
        resp = requests.get(url, headers=self.headers, params=params)
        data = resp.json()
        if data.get("code") != 0:
            logger.error(f"GET {endpoint} failed: {data.get('message')} (code={data.get('code')})")
        return data

    def _post(self, endpoint: str, payload: dict) -> dict:
        url = self._url(endpoint)
        payload["advertiser_id"] = self.advertiser_id
        resp = requests.post(url, headers=self.headers, json=payload)
        data = resp.json()
        if data.get("code") != 0:
            logger.error(f"POST {endpoint} failed: {data.get('message')} (code={data.get('code')})")
        return data

    # ─── Video / Post Detection ───────────────────────────────

    def get_videos(self, page: int = 1, page_size: int = 20) -> dict:
        """Fetch videos from the linked TikTok business account."""
        return self._get("video/list/", {
            "page": page,
            "page_size": page_size,
        })

    def get_tiktok_account_videos(self, bc_id: str = None) -> list:
        """
        Fetch recent videos. Returns list of video dicts.
        Each video has: video_id, create_time, item_id, etc.
        """
        result = self.get_videos(page=1, page_size=50)
        if result.get("code") == 0:
            return result.get("data", {}).get("videos", [])
        return []

    # ─── Campaign Creation ────────────────────────────────────

    def create_campaign(self, name: str) -> str | None:
        """
        Create a campaign optimized for video views.
        Returns campaign_id or None on failure.
        """
        payload = {
            "campaign_name": name,
            "objective_type": OBJECTIVE,
            "budget_mode": "BUDGET_MODE_DAY",
            "budget": DAILY_BUDGET,
        }
        result = self._post("campaign/create/", payload)
        if result.get("code") == 0:
            campaign_id = result["data"]["campaign_id"]
            logger.info(f"Campaign created: {campaign_id}")
            return str(campaign_id)
        return None

    # ─── Ad Group Creation ────────────────────────────────────

    def create_ad_group(self, campaign_id: str, name: str) -> str | None:
        """
        Create an ad group with daily budget, running for CAMPAIGN_DURATION_DAYS.
        Returns adgroup_id or None on failure.
        """
        start = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        end = (datetime.utcnow() + timedelta(days=CAMPAIGN_DURATION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")

        payload = {
            "campaign_id": campaign_id,
            "adgroup_name": name,
            "placement_type": "PLACEMENT_TYPE_NORMAL",
            "placements": PLACEMENTS,
            "location_ids": TARGET_LOCATIONS,
            "budget_mode": "BUDGET_MODE_DAY",
            "budget": DAILY_BUDGET,
            "schedule_type": "SCHEDULE_START_END",
            "schedule_start_time": start,
            "schedule_end_time": end,
            "optimization_goal": "VIDEO_VIEW",
            "pacing": "PACING_MODE_SMOOTH",
            "billing_event": "CPV",
            "bid_type": "BID_TYPE_NO_BID",
        }
        result = self._post("adgroup/create/", payload)
        if result.get("code") == 0:
            adgroup_id = result["data"]["adgroup_id"]
            logger.info(f"Ad group created: {adgroup_id}")
            return str(adgroup_id)
        return None

    # ─── Spark Ad Creation ────────────────────────────────────

    def create_spark_ad(
        self,
        adgroup_id: str,
        name: str,
        tiktok_item_id: str,
        identity_id: str,
        identity_type: str = "TT_USER",
    ) -> str | None:
        """
        Create a Spark Ad using an organic TikTok post.

        Args:
            adgroup_id: Ad group to place the ad in
            name: Display name for the ad
            tiktok_item_id: The organic post/video ID
            identity_id: TikTok identity (user) ID
            identity_type: "TT_USER" or "BC_AUTH_TT"

        Returns ad_id or None on failure.
        """
        payload = {
            "adgroup_id": adgroup_id,
            "ad_name": name,
            "ad_format": "SINGLE_VIDEO",
            "tiktok_item_id": tiktok_item_id,
            "identity_id": identity_id,
            "identity_type": identity_type,
        }
        result = self._post("ad/create/", payload)
        if result.get("code") == 0:
            ad_id = result["data"]["ad_id"]
            logger.info(f"Spark Ad created: {ad_id}")
            return str(ad_id)
        return None

    # ─── Identity (for Spark Ads) ─────────────────────────────

    def get_identity(self) -> dict | None:
        """
        Get the TikTok identity linked to the ad account.
        Needed for Spark Ads identity_id parameter.
        """
        result = self._get("identity/get/", {
            "identity_type": "TT_USER",
        })
        if result.get("code") == 0:
            identities = result.get("data", {}).get("identity_list", [])
            if identities:
                return identities[0]
        return None

    # ─── Spark Ad Authorization ───────────────────────────────

    def authorize_spark_ad(self, tiktok_item_id: str) -> str | None:
        """
        Authorize an organic post for Spark Ads usage.
        Note: This works when you OWN the TikTok account (via Business Center).
        Returns auth_code or None.
        """
        result = self._post("tt_video/authorize/", {
            "tiktok_item_id": tiktok_item_id,
        })
        if result.get("code") == 0:
            return result.get("data", {}).get("auth_code")
        return None

    # ─── Full Pipeline ────────────────────────────────────────

    def promote_post(self, video_id: str, post_title: str = "") -> bool:
        """
        Full pipeline: Create campaign → ad group → spark ad for a single post.
        Returns True on success.
        """
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M")
        label = post_title[:30] if post_title else video_id[:10]

        # 1. Get identity
        identity = self.get_identity()
        if not identity:
            logger.error("Could not retrieve TikTok identity. Aborting.")
            return False
        identity_id = identity.get("identity_id")

        # 2. Create campaign
        campaign_name = f"Spark_{label}_{timestamp}"
        campaign_id = self.create_campaign(campaign_name)
        if not campaign_id:
            return False

        # 3. Create ad group
        adgroup_name = f"AG_{label}_{timestamp}"
        adgroup_id = self.create_ad_group(campaign_id, adgroup_name)
        if not adgroup_id:
            return False

        # 4. Create Spark Ad
        ad_name = f"Ad_{label}_{timestamp}"
        ad_id = self.create_spark_ad(
            adgroup_id=adgroup_id,
            name=ad_name,
            tiktok_item_id=video_id,
            identity_id=identity_id,
        )
        if not ad_id:
            return False

        logger.info(
            f"Post promoted successfully: video={video_id} "
            f"campaign={campaign_id} adgroup={adgroup_id} ad={ad_id}"
        )
        return True

    def promote_post_with_details(self, video_id: str, post_title: str = "") -> dict:
        """
        Same as promote_post but returns a dict with all IDs (for webhook + email).
        """
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M")
        label = post_title[:30] if post_title else video_id[:10]
        fail = lambda msg: {"success": False, "error": msg}

        # 1. Get identity
        identity = self.get_identity()
        if not identity:
            return fail("Could not retrieve TikTok identity")
        identity_id = identity.get("identity_id")

        # 2. Create campaign
        campaign_name = f"Spark_{label}_{timestamp}"
        campaign_id = self.create_campaign(campaign_name)
        if not campaign_id:
            return fail("Campaign creation failed")

        # 3. Create ad group
        adgroup_name = f"AG_{label}_{timestamp}"
        adgroup_id = self.create_ad_group(campaign_id, adgroup_name)
        if not adgroup_id:
            return fail("Ad group creation failed")

        # 4. Create Spark Ad
        ad_name = f"Ad_{label}_{timestamp}"
        ad_id = self.create_spark_ad(
            adgroup_id=adgroup_id,
            name=ad_name,
            tiktok_item_id=video_id,
            identity_id=identity_id,
        )
        if not ad_id:
            return fail("Spark Ad creation failed")

        logger.info(
            f"Post promoted: video={video_id} "
            f"campaign={campaign_id} adgroup={adgroup_id} ad={ad_id}"
        )
        return {
            "success": True,
            "campaign_id": campaign_id,
            "adgroup_id": adgroup_id,
            "ad_id": ad_id,
        }
