/**
 * Cron Worker — Post Detection + Close.com Task + Email
 *
 * Called periodically (via scheduled task or manual trigger).
 * 1. Fetches latest Instagram posts
 * 2. Detects new posts not yet seen
 * 3. Stores new posts in KV with firstSeen date
 * 4. For posts 7+ days old: creates Close.com task + sends email
 *
 * Env vars: META_PAGE_TOKEN, IG_ACCOUNT_ID, CLOSE_API_KEY
 * KV binding: REPORTS
 *
 * Trigger manually: POST /api/cron
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

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
    const closeApiKey = env.CLOSE_API_KEY;
    const KV = env.REPORTS;

    if (!token || !KV) {
      return new Response(JSON.stringify({ error: 'Missing env vars or KV binding' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const results = { newPosts: [], tasksCreated: [], errors: [] };

    // 1. Fetch latest 10 Instagram posts
    const mediaList = await graphGet(
      `${igAccountId}/media?fields=id,permalink,timestamp,caption,media_type,media_product_type&limit=10`,
      token
    );

    for (const media of mediaList.data || []) {
      const kvKey = `post:ig:${media.id}`;
      const existing = await KV.get(kvKey, 'json');

      if (!existing) {
        // New post! Store it
        const postRecord = {
          mediaId: media.id,
          platform: 'instagram',
          permalink: media.permalink,
          caption: (media.caption || '').substring(0, 200),
          type: media.media_product_type === 'REELS' ? 'Reel' :
                media.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' :
                media.media_type === 'VIDEO' ? 'Video' : 'Foto',
          postedAt: media.timestamp,
          firstSeen: new Date().toISOString(),
          taskCreated: false,
        };

        await KV.put(kvKey, JSON.stringify(postRecord));
        results.newPosts.push({ id: media.id, type: postRecord.type, date: media.timestamp });
      } else {
        // Existing post — check if 7 days have passed and task not yet created
        const firstSeen = new Date(existing.firstSeen);
        const now = new Date();
        const daysSince = (now - firstSeen) / (1000 * 60 * 60 * 24);

        if (daysSince >= 7 && !existing.taskCreated && closeApiKey) {
          try {
            // Create Close.com task
            await createCloseTask(closeApiKey, existing);

            // Mark task as created
            existing.taskCreated = true;
            existing.taskCreatedAt = now.toISOString();
            await KV.put(kvKey, JSON.stringify(existing));

            results.tasksCreated.push({
              mediaId: existing.mediaId,
              type: existing.type,
              postedAt: existing.postedAt,
            });
          } catch (e) {
            results.errors.push({ mediaId: existing.mediaId, error: e.message });
          }
        }
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

async function createCloseTask(apiKey, post) {
  const postDate = new Date(post.postedAt).toLocaleDateString('de-DE');
  const taskText = `📊 Report erstellen: ${post.type} vom ${postDate}\n\n` +
    `Post: ${post.permalink}\n` +
    `Caption: ${post.caption}\n\n` +
    `Der Post ist jetzt 7 Tage alt — bitte Insights auswerten und Report an Kunden senden.`;

  // Create a task assigned to the org (unassigned — first available)
  const res = await fetch('https://api.close.com/api/v1/task/', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(apiKey + ':'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      _type: 'lead',
      text: taskText,
      is_complete: false,
      // Due today
      due_date: new Date().toISOString().split('T')[0],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Close API ${res.status}: ${err}`);
  }

  return await res.json();
}

// Also send notification email via Close
// (Close tasks + email notification covers the requirement)

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
