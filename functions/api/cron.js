/**
 * Cron Worker â Post Detection + Auto-Report + Email Notification
 *
 * Called periodically (via scheduled task or manual trigger).
 * 1. Fetches latest Instagram posts
 * 2. Detects new posts not yet seen
 * 3. Auto-creates a report with magic link
 * 4. Sends notification via Telegram + email-ready info
 *
 * Env vars: META_PAGE_TOKEN, IG_ACCOUNT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * KV binding: REPORTS
 *
 * Trigger: POST /api/cron
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const BASE_URL = 'https://dashboard.hashtaghamburg.de';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function generateToken() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let token = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) token += chars[b % chars.length];
  return token;
}

async function graphGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${GRAPH_API}/${path}${sep}access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Graph API: ${data.error.message}`);
  return data;
}

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const token = env.META_PAGE_TOKEN;
    const igAccountId = env.IG_ACCOUNT_ID || '17841409607773752';
    const KV = env.REPORTS;

    if (!token || !KV) {
      return new Response(JSON.stringify({ error: 'Missing env vars or KV binding' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const results = { newPosts: [], reportsCreated: [], notificationsSent: [], errors: [] };

    // 1. Fetch latest 10 Instagram posts
    const mediaList = await graphGet(
      `${igAccountId}/media?fields=id,permalink,timestamp,caption,media_type,media_product_type&limit=10`,
      token
    );

    for (const media of mediaList.data || []) {
      const kvKey = `post:ig:${media.id}`;
      const existing = await KV.get(kvKey, 'json');

      if (existing) continue; // Already tracked

      // New post detected!
      const postType = media.media_product_type === 'REELS' ? 'Reel' :
            media.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' :
            media.media_type === 'VIDEO' ? 'Video' : 'Foto';

      const postDate = new Date(media.timestamp).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });

      // 2. Auto-create report
      const reportToken = generateToken();
      const report = {
        token: reportToken,
        clientName: `Instagram ${postType} - ${postDate}`,
        leadId: null,
        posts: [{
          url: media.permalink,
          platform: 'instagram',
          mediaId: media.id,
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        autoCreated: true,
      };

      await KV.put(`report:${reportToken}`, JSON.stringify(report));

      // 3. Store post tracking record
      const postRecord = {
        mediaId: media.id,
        platform: 'instagram',
        permalink: media.permalink,
        caption: (media.caption || '').substring(0, 200),
        type: postType,
        postedAt: media.timestamp,
        firstSeen: new Date().toISOString(),
        reportToken: reportToken,
      };

      await KV.put(kvKey, JSON.stringify(postRecord));
      results.newPosts.push({ id: media.id, type: postType, date: media.timestamp });
      results.reportsCreated.push({ token: reportToken, type: postType });

      // 4. Send Telegram notification
      const reportUrl = `${BASE_URL}/report?t=${reportToken}`;
      try {
        await sendTelegramNotification(env, postRecord, reportUrl);
        results.notificationsSent.push({ mediaId: media.id, channel: 'telegram' });
      } catch (e) {
        results.errors.push({ mediaId: media.id, error: `Telegram: ${e.message}` });
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

async function sendTelegramNotification(env, post, reportUrl) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) throw new Error('Telegram not configured');

  const postDate = new Date(post.postedAt).toLocaleDateString('de-DE');
  const caption = post.caption ? `\n\n_${post.caption.substring(0, 100)}${post.caption.length > 100 ? '...' : ''}_` : '';

  const message =
    `ð *Neuer Post erkannt!*\n\n` +
    `Typ: *${post.type}*\n` +
    `Datum: ${postDate}\n` +
    `Post: ${post.permalink}${caption}\n\n` +
    `ð *Report-Link fÃ¼r Kunden:*\n${reportUrl}\n\n` +
    `â¡ï¸ Bitte an moin@hashtaghamburg.de weiterleiten`;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram ${res.status}: ${err}`);
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
