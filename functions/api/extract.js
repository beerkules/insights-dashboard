export async function onRequestPost(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const body = await context.request.json();
    const { images } = body;

    if (!images || !images.length) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        status: 400, headers: corsHeaders,
      });
    }

    const content = [];

    images.forEach((img) => {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.media_type,
          data: img.data,
        },
      });
    });

    content.push({
      type: 'text',
      text: `Analysiere diese Instagram/TikTok Insights-Screenshots. Es können mehrere Screenshots sein die zusammen die Insights eines einzelnen Posts zeigen.

Extrahiere ALLE sichtbaren Metriken und gib sie als JSON zurück. Antworte NUR mit dem JSON, kein anderer Text:

{
  "platform": "instagram" oder "tiktok",
  "type": "Foto" oder "Story" oder "Reel",
  "date": "YYYY-MM-DD" oder null,
  "caption": "komplette Caption falls sichtbar" oder null,
  "permalink": "URL falls sichtbar" oder null,
  "insights": {
    "views": number,
    "reach": number,
    "likes": number,
    "comments": number,
    "shares": number,
    "saves": number,
    "profileVisits": number,
    "engagementRate": number,
    "tapForward": number,
    "tapBack": number,
    "tapExit": number,
    "replies": number,
    "linkClicks": number,
    "avgWatchTime": number,
    "fullVideoWatchedRate": number,
    "totalWatchTime": number
  }
}

Wichtige Regeln:
- Nur Felder inkludieren die auf den Screenshots tatsächlich sichtbar sind
- Zahlen als reine Nummern konvertieren: "48,7K" → 48700, "1,2M" → 1200000, "3.456" → 3456
- Bei deutschen Zahlenformaten: Punkt = Tausender, Komma = Dezimal
- engagementRate als Prozent-Zahl (z.B. 13.56)
- avgWatchTime in Sekunden
- fullVideoWatchedRate als Prozent-Zahl
- Falls "Impressions" statt "Views" angezeigt wird, nutze das als "views"
- Falls "Konten erreicht" oder "Erreichte Konten" angezeigt wird, nutze das als "reach"
- Falls "Geteilte Inhalte" angezeigt wird, nutze das als "shares"
- Falls "Gespeichert" angezeigt wird, nutze das als "saves"
- Falls "Profilaktivität" oder "Profilbesuche" angezeigt wird, nutze das als "profileVisits"`,
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Claude API error: ${response.status}`, details: errText }), {
        status: 502, headers: corsHeaders,
      });
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';

    let jsonStr = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to parse AI response', raw: text }), {
        status: 422, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      status: 200, headers: corsHeaders,
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
