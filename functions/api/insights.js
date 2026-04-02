/**
 * Instagram Insights API — Cloudflare Function
 *
 * Fetches Instagram post insights via the Graph API.
 *
 * Required env vars (set in Cloudflare dashboard):
 *   - META_PAGE_TOKEN: Long-lived Page Access Token for Hashtag Hamburg
 *   - IG_ACCOUNT_ID: Instagram Business Account ID (17841409607773752)
 *
 * Endpoints:
 *   POST /api/insights
 *   Body: { "url": "https://www.instagram.com/reel/..." }
 *     or: { "mediaId": "17856455493628105" }
 *     or: { "latest": 5 }  — fetch insights for the N most recent posts
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// Metrics by media type (v22.0+ compatible)
const METRICS = {
  REELS: 'reach,likes,comments,shares,saved,total_interactions,ig_reels_video_view_total_time,ig_reels_avg_watch_time',
  IMAGE: 'reach,likes,comments,shares,saved,total_interactions',
  CAROUSEL_ALBUM: 'reach,likes,comments,shares,saved,total_interactions',
  VIDEO: 'reach,likes,comments,shares,saved,total_interactions',
};

async function graphGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${GRAPH_API}/${path}${sep}access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Graph API: ${data.error.message}`);
  return data;
}

/**
 * Resolve an Instagram post URL to a Graph API media ID.
 * Uses the oEmbed endpoint to get the media ID.
 */
async function resolveUrl(permalink, token) {
  // First get the shortcode from the URL
  const match = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invalid Instagram URL format');

  // Search for this media in the account's recent media
  // We'll paginate through to find a matching permalink
  const igAccountId = null; // will be passed separately
  return match[1]; // return shortcode for now
}

/**
 * Find media ID by permalink in account's media list.
 */
async function findMediaByPermalink(igAccountId, permalink, token) {
  let url = `${igAccountId}/media?fields=id,permalink,timestamp&limit=50`;
  let pages = 0;

  while (url && pages < 10) {
    const data = await graphGet(url, token);
    for (const media of data.data || []) {
      if (media.permalink && permalink.includes(media.permalink.split('?')[0].replace(/\/$/, '').split('/').pop())) {
        return media.id;
      }
      // Also try direct permalink match
      if (media.permalink === permalink || media.permalink === permalink + '/') {
        return media.id;
      }
    }
    url = data.paging?.next?.replace(`${GRAPH_API}/`, '').replace(`access_token=${token}`, '').replace(/[&?]$/, '');
    if (data.paging?.next) {
      // Use the full next URL
      const nextRes = await fetch(data.paging.next);
      const nextData = await nextRes.json();
      if (nextData.error) break;
      for (const media of nextData.data || []) {
        if (media.permalink && permalink.includes(media.permalink.split('?')[0].replace(/\/$/, '').split('/').pop())) {
          return media.id;
        }
        if (media.permalink === permalink || media.permalink === permalink + '/') {
          return media.id;
        }
      }
      url = nextData.paging?.cursors?.after ? `${igAccountId}/media?fields=id,permalink,timestamp&limit=50&after=${nextData.paging.cursors.after}` : null;
    } else {
      break;
    }
    pages++;
  }

  throw new Error('Media not found in account. Make sure the URL belongs to the connected Instagram account.');
}

/**
 * Fetch insights for a single media item.
 */
async function getMediaInsights(mediaId, token) {
  // First get media info (type, caption, permalink, timestamp)
  const mediaInfo = await graphGet(
    `${mediaId}?fields=media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count`,
    token
  );

  const productType = mediaInfo.media_product_type || mediaInfo.media_type;
  const metricsKey = productType === 'REELS' ? 'REELS' : (mediaInfo.media_type || 'IMAGE');
  const metrics = METRICS[metricsKey] || METRICS.IMAGE;

  // Fetch insights
  let insights = {};
  try {
    const insightsData = await graphGet(
      `${mediaId}/insights?metric=${metrics}`,
      token
    );

    for (const item of insightsData.data || []) {
      const value = item.values?.[0]?.value ?? null;
      insights[item.name] = value;
    }
  } catch (e) {
    // Some media types don't support all metrics, try basic set
    try {
      const basicData = await graphGet(
        `${mediaId}/insights?metric=reach,likes,comments,shares,saved`,
        token
      );
      for (const item of basicData.data || []) {
        insights[item.name] = item.values?.[0]?.value ?? null;
      }
    } catch {
      insights = { error: e.message };
    }
  }

  // Map to our standard format
  const type = productType === 'REELS' ? 'Reel' :
               mediaInfo.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' :
               mediaInfo.media_type === 'VIDEO' ? 'Video' : 'Foto';

  return {
    platform: 'instagram',
    type,
    mediaId,
    date: mediaInfo.timestamp ? mediaInfo.timestamp.split('T')[0] : null,
    caption: mediaInfo.caption || null,
    permalink: mediaInfo.permalink || null,
    insights: {
      reach: insights.reach ?? null,
      likes: insights.likes ?? mediaInfo.like_count ?? null,
      comments: insights.comments ?? mediaInfo.comments_count ?? null,
      shares: insights.shares ?? null,
      saves: insights.saved ?? null,
      totalInteractions: insights.total_interactions ?? null,
      views: insights.ig_reels_video_view_total_time ? undefined : null,
      avgWatchTime: insights.ig_reels_avg_watch_time ?? null,
      totalWatchTime: insights.ig_reels_video_view_total_time ?? null,
    },
  };
}

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const token = env.META_PAGE_TOKEN;
    const igAccountId = env.IG_ACCOUNT_ID || '17841409607773752';

    if (!token) {
      return new Response(JSON.stringify({ error: 'META_PAGE_TOKEN not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const body = await context.request.json();
    const { url, mediaId, latest } = body;

    // Mode 1: Fetch insights for N latest posts
    if (latest) {
      const limit = Math.min(parseInt(latest) || 5, 25);
      const mediaList = await graphGet(
        `${igAccountId}/media?fields=id&limit=${limit}`,
        token
      );

      const results = [];
      for (const item of mediaList.data || []) {
        try {
          const insight = await getMediaInsights(item.id, token);
          results.push(insight);
        } catch (e) {
          results.push({ mediaId: item.id, error: e.message });
        }
      }

      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), {
        status: 200, headers: corsHeaders,
      });
    }

    // Mode 2: Fetch insights by media ID
    if (mediaId) {
      const result = await getMediaInsights(mediaId, token);
      return new Response(JSON.stringify({ success: true, data: result }), {
        status: 200, headers: corsHeaders,
      });
    }

    // Mode 3: Fetch insights by URL
    if (url) {
      const foundId = await findMediaByPermalink(igAccountId, url, token);
      const result = await getMediaInsights(foundId, token);
      return new Response(JSON.stringify({ success: true, data: result }), {
        status: 200, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ error: 'Provide "url", "mediaId", or "latest" in request body' }), {
      status: 400, headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
