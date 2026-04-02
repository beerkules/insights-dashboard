/**
 * Reports API — Cloudflare Function
 *
 * CRUD for client reports stored in KV.
 * Each report has a random token used as magic link.
 *
 * KV binding: REPORTS
 *
 * Endpoints:
 *   POST   /api/reports          — Create new report
 *   GET    /api/reports?t=TOKEN  — Get single report
 *   GET    /api/reports?list=1   — List all reports (admin)
 *   PUT    /api/reports          — Update report
 *   DELETE /api/reports?t=TOKEN  — Delete report
 */

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

// ─── GET ─────────────────────────────────────────────
export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);

  try {
    const KV = env.REPORTS;
    if (!KV) {
      return new Response(JSON.stringify({ error: 'KV not bound' }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Single report by token
    const token = url.searchParams.get('t');
    if (token) {
      const data = await KV.get(`report:${token}`, 'json');
      if (!data) {
        return new Response(JSON.stringify({ error: 'Report not found' }), {
          status: 404, headers: corsHeaders,
        });
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: corsHeaders,
      });
    }

    // List all reports (admin)
    if (url.searchParams.get('list')) {
      const list = await KV.list({ prefix: 'report:' });
      const reports = [];
      for (const key of list.keys) {
        const report = await KV.get(key.name, 'json');
        if (report) reports.push(report);
      }
      // Sort by creation date desc
      reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return new Response(JSON.stringify({ success: true, data: reports }), {
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ error: 'Provide ?t=TOKEN or ?list=1' }), {
      status: 400, headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

// ─── POST (Create) ──────────────────────────────────
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const KV = env.REPORTS;
    if (!KV) {
      return new Response(JSON.stringify({ error: 'KV not bound' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const body = await context.request.json();
    const { clientName, leadId, posts } = body;

    if (!clientName || !posts || !posts.length) {
      return new Response(JSON.stringify({
        error: 'clientName and posts[] required',
      }), { status: 400, headers: corsHeaders });
    }

    const token = generateToken();
    const report = {
      token,
      clientName,
      leadId: leadId || null,
      posts: posts.map(p => ({
        url: p.url,
        platform: p.platform || detectPlatform(p.url),
        mediaId: p.mediaId || null,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await KV.put(`report:${token}`, JSON.stringify(report));

    return new Response(JSON.stringify({ success: true, data: report }), {
      status: 201, headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

// ─── PUT (Update) ───────────────────────────────────
export async function onRequestPut(context) {
  const { env } = context;

  try {
    const KV = env.REPORTS;
    const body = await context.request.json();
    const { token, clientName, posts, leadId } = body;

    if (!token) {
      return new Response(JSON.stringify({ error: 'token required' }), {
        status: 400, headers: corsHeaders,
      });
    }

    const existing = await KV.get(`report:${token}`, 'json');
    if (!existing) {
      return new Response(JSON.stringify({ error: 'Report not found' }), {
        status: 404, headers: corsHeaders,
      });
    }

    const updated = {
      ...existing,
      clientName: clientName || existing.clientName,
      leadId: leadId !== undefined ? leadId : existing.leadId,
      posts: posts ? posts.map(p => ({
        url: p.url,
        platform: p.platform || detectPlatform(p.url),
        mediaId: p.mediaId || null,
      })) : existing.posts,
      updatedAt: new Date().toISOString(),
    };

    await KV.put(`report:${token}`, JSON.stringify(updated));

    return new Response(JSON.stringify({ success: true, data: updated }), {
      headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

// ─── DELETE ─────────────────────────────────────────
export async function onRequestDelete(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const token = url.searchParams.get('t');

  try {
    const KV = env.REPORTS;

    if (!token) {
      return new Response(JSON.stringify({ error: 'token required' }), {
        status: 400, headers: corsHeaders,
      });
    }

    await KV.delete(`report:${token}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

// ─── OPTIONS (CORS) ─────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ─── Helpers ────────────────────────────────────────
function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  return 'unknown';
}
