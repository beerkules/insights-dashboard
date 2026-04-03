/**
 * Deal Won Webhook — Cloudflare Function
 * Replaces the Zapier "Deal Won → Status Kunde & Telegram Notification" Zap.
 *
 * Flow:
 *   1. Close CRM fires webhook on any opportunity.updated event
 *   2. This function checks: is new status a Won status AND was previous status NOT Won?
 *      → Only fires on FIRST transition to Won (covers direct jumps to any Won sub-status)
 *      → Skips Won→Won transitions (e.g. Angebot angenommen → Inkasso)
 *   3. Updates Lead status to "Kunde" via Close API
 *   4. Sends a Telegram notification via Bot API
 *
 * Required env vars (Cloudflare dashboard → Settings → Environment Variables):
 *   - CLOSE_API_KEY
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_CHAT_ID
 *
 * Close CRM Webhook Setup:
 *   URL:  https://hashtaghamburg.de/api/deal-won   (or your domain)
 *   Event: opportunity.updated  (no server-side filter — filtering done in this function)
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

    // ── DEBUG MODE: Send raw payload to Telegram for testing ──
    // Activate by adding ?debug=1 to the webhook URL
    const url = new URL(context.request.url);
    if (url.searchParams.get('debug') === '1') {
      const debugMsg = `🔍 <b>Deal-Won Debug Payload:</b>\n<pre>${JSON.stringify(payload, null, 2).slice(0, 3500)}</pre>`;
      await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, debugMsg);
      return new Response(JSON.stringify({ debug: true, payload }), { status: 200, headers: corsHeaders });
    }

    // ── Extract opportunity data from Close webhook ──
    // Close sends: { subscription_id, event: { action, object_type, data: {...}, previous_data: {...}, ... } }
    const event = payload.event || {};
    const data = event.data || payload.data || payload;
    const previousData = event.previous_data || {};

    // ── FILTER: Only fire on FIRST transition to a Won status ──
    // Fire:   non-won → any Won status (Angebot angenommen, Rechnung teilweise bezahlt, Rechnung bezahlt)
    // Skip:   Won → Won transitions (e.g. Angebot angenommen → Inkasso/Rechnung bezahlt)
    // Skip:   Transitions to non-won statuses

    const opportunityId = data.id || event.object_id || '';
    const statusLabel = data.status_label || '';
    const statusType = data.status_type || '';
    const prevStatusLabel = previousData.status_label || '';
    const prevStatusType = previousData.status_type || '';

    // Fetch the opportunity if we don't have status info in payload
    let opp = null;
    if (opportunityId && !statusLabel) {
      opp = await closeAPI('GET', `opportunity/${opportunityId}`, CLOSE_API_KEY);
    }

    const resolvedStatusLabel = statusLabel || (opp && opp.status_label) || '';
    const resolvedStatusType = statusType || (opp && opp.status_type) || '';

    // Won statuses that should trigger (on first entry)
    const wonLabels = [
      'won - angebot angenommen',
      'won - rechnung teilweise bezahlt',
      'won - rechnung bezahlt',
    ];

    const isNewStatusWon = resolvedStatusType === 'won'
      && wonLabels.includes(resolvedStatusLabel.toLowerCase());

    // Check if previous status was already a won-type (= Won→Won transition, skip)
    const wasPreviouslyWon = prevStatusType === 'won'
      || prevStatusLabel.toLowerCase().startsWith('won')
      || prevStatusLabel.toLowerCase() === 'inkasso';

    if (!isNewStatusWon || wasPreviouslyWon) {
      return new Response(JSON.stringify({
        skipped: true,
        reason: !isNewStatusWon
          ? `New status "${resolvedStatusLabel}" is not a target Won status`
          : `Previous status "${prevStatusLabel}" was already Won — skipping Won→Won transition`,
      }), { status: 200, headers: corsHeaders });
    }

    const leadId = data.lead_id || event.lead_id || (opp && opp.lead_id) || '';
    const opportunityValue = data.value || data.annualized_value || (opp && opp.value) || 0;
    const opportunityNote = data.note || (opp && opp.note) || '';
    const contactName = data.contact_name || data.lead_name || '';

    if (!leadId) {
      if (opportunityId && !opp) {
        opp = await closeAPI('GET', `opportunity/${opportunityId}`, CLOSE_API_KEY);
        var resolvedLeadId = opp.lead_id;
        var resolvedValue = opp.value || opp.annualized_value || opportunityValue;
        var resolvedNote = opp.note || opportunityNote;
      } else if (opp) {
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
    let leadInfo;
    try {
      leadInfo = await closeAPI('GET', `lead/${finalLeadId}`, CLOSE_API_KEY);
    } catch (e) {
      return new Response(JSON.stringify({
        error: `Failed to fetch lead: ${e.message}`,
      }), { status: 500, headers: corsHeaders });
    }

    const leadName = leadInfo.display_name || contactName || 'Unbekannt';
    const leadSource = leadInfo['custom.cf_V6HRCPxKnerOXkYojfnQ23DBFN0HVC9eisclazlw2OL'] || '';

    const statuses = await closeAPI('GET', 'status/lead/', CLOSE_API_KEY);
    const kundeStatus = (statuses.data || []).find(
      s => s.label.toLowerCase() === 'kunde'
    );

    if (kundeStatus) {
      await closeAPI('PUT', `lead/${finalLeadId}`, CLOSE_API_KEY, {
        status_id: kundeStatus.id,
      });
    } else {
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
      finalValue ? `<b>Preis:</b> ${valueFormatted}` : null,
      leadSource ? `<b>Quelle:</b> ${leadSource}` : null,
      ``,
      `<a href="https://app.close.com/lead/${finalLeadId}/">→ In Close öffnen</a>`,
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
