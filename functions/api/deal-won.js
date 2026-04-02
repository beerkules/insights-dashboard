/**
 * Deal Won Webhook — Cloudflare Function
 * Replaces the Zapier "Deal Won → Status Kunde & Telegram Notification" Zap.
 *
 * Flow:
 *   1. Close CRM fires webhook when Opportunity status → "Won - Angebot angenommen"
 *   2. This function updates the Lead status to "Kunde" via Close API
 *   3. Sends a Telegram notification via Bot API
 *
 * Required env vars (Cloudflare dashboard → Settings → Environment Variables):
 *   - CLOSE_API_KEY
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_CHAT_ID
 *
 * Close CRM Webhook Setup:
 *   URL:  https://hashtaghamburg.de/api/deal-won   (or your domain)
 *   Event: opportunity.status_change  (filter: new_status = "Won - Angebot angenommen")
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// ─── Close API Helper ───────────────────────────────────────

async function closeAPI(method, endpoint, apiKey, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${btoa(apiKey + ':')}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`https://api.close.com/api/v1/${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Close API ${method} /${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Telegram Helper ────────────────────────────────────────

async function sendTelegram(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
  return res.json();
}

// ─── Main Handler ───────────────────────────────────────────

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const { CLOSE_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = env;

    if (!CLOSE_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return new Response(JSON.stringify({
        error: 'Missing env vars. Need: CLOSE_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID',
      }), { status: 500, headers: corsHeaders });
    }

    const payload = await context.request.json();

    // ── Extract opportunity data from Close webhook ──
    // Close sends: { event: { ... }, data: { ... } }
    const event = payload.event || {};
    const data = payload.data || payload;

    // Support both Close webhook formats
    const opportunityId = data.id || data.opportunity_id || event.data?.id || '';
    const leadId = data.lead_id || event.data?.lead_id || '';
    const opportunityValue = data.value || data.annualized_value || event.data?.value || 0;
    const opportunityNote = data.note || event.data?.note || '';
    const contactName = data.contact_name || data.lead_name || '';
    const statusLabel = data.status_label || data.new_status_label || 'Won';

    if (!leadId) {
      // Try to get lead_id from the opportunity if not in payload
      if (opportunityId) {
        const opp = await closeAPI('GET', `opportunity/${opportunityId}`, CLOSE_API_KEY);
        var resolvedLeadId = opp.lead_id;
        var resolvedValue = opp.value || opp.annualized_value || opportunityValue;
        var resolvedNote = opp.note || opportunityNote;
      } else {
        return new Response(JSON.stringify({
          error: 'No lead_id or opportunity_id in webhook payload',
          received: Object.keys(data),
        }), { status: 400, headers: corsHeaders });
      }
    }

    const finalLeadId = leadId || resolvedLeadId;
    const finalValue = opportunityValue || resolvedValue || 0;
    const finalNote = opportunityNote || resolvedNote || '';

    // ── 1. Update Lead status to "Kunde" ──
    // Find the "Kunde" status ID. Close uses status IDs, not labels.
    // We'll search for it, or update by label.
    let leadInfo;
    try {
      leadInfo = await closeAPI('GET', `lead/${finalLeadId}`, CLOSE_API_KEY);
    } catch (e) {
      return new Response(JSON.stringify({
        error: `Failed to fetch lead: ${e.message}`,
      }), { status: 500, headers: corsHeaders });
    }

    const leadName = leadInfo.display_name || contactName || 'Unbekannt';

    // Get all lead statuses to find "Kunde"
    const statuses = await closeAPI('GET', 'status/lead/', CLOSE_API_KEY);
    const kundeStatus = (statuses.data || []).find(
      s => s.label.toLowerCase() === 'kunde'
    );

    if (kundeStatus) {
      await closeAPI('PUT', `lead/${finalLeadId}`, CLOSE_API_KEY, {
        status_id: kundeStatus.id,
      });
    } else {
      // Fallback: log warning but continue
      console.warn('Lead status "Kunde" not found in Close. Skipping status update.');
    }

    // ── 2. Send Telegram notification ──
    const valueFormatted = typeof finalValue === 'number'
      ? (finalValue / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
      : finalValue;

    const message = [
      `🎉 <b>Neuer Abschluss!</b>`,
      ``,
      `<b>Kunde:</b> ${leadName}`,
      finalValue ? `<b>Wert:</b> ${valueFormatted}` : null,
      finalNote ? `<b>Notiz:</b> ${finalNote}` : null,
      `<b>Status:</b> ${statusLabel} → Kunde`,
      ``,
      `<a href="https://app.close.com/lead/${finalLeadId}/">In Close öffnen</a>`,
    ].filter(Boolean).join('\n');

    await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, message);

    return new Response(JSON.stringify({
      success: true,
      leadId: finalLeadId,
      leadName,
      statusUpdated: !!kundeStatus,
      telegramSent: true,
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    // On error, still try to send Telegram alert
    try {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        await sendTelegram(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          `⚠️ Deal-Won Webhook Fehler:\n${err.message}`
        );
      }
    } catch (_) { /* ignore */ }

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
