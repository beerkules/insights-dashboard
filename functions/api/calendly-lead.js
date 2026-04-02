/**
 * Calendly → Close Lead Creation — Cloudflare Function
 * Replaces 7+ Calendly Zaps + 2 SubZaps (Create A Lead, Neuer Termin Kennenlerngespräch)
 *
 * Flow:
 *   1. Calendly fires webhook on new booking
 *   2. Normalize phone number
 *   3. Extract first name from full name (simple JS, replaces GPT-4o-mini call)
 *   4. Search for existing lead in Close by email/phone
 *   5. Create lead if not found, or use existing
 *   6. Create opportunity on the lead (assigned to Petro)
 *
 * Required env vars (Cloudflare Dashboard → Settings → Environment Variables):
 *   - CLOSE_API_KEY
 *
 * Calendly Webhook Setup:
 *   URL:  https://hashtaghamburg.de/api/calendly-lead
 *   Events: invitee.created
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// ─── Close User-ID ──────────────────────────────────────────
// Alle Calendly-Leads gehen an Petro
const ASSIGNED_USER = 'user_Iitd0EwzvBbThx5GFfUYT7N6upX7PZPyiaofwvcFPbg';

// ─── Close Opportunity Status-IDs ───────────────────────────
const TERMIN_STATUS  = 'stat_ZbQmKr3SEkz360PuDtjKHKBrj3Sy66YaVxbiOA5vB9n';
const ANFRAGE_STATUS = 'stat_m5ncxf213kocQZ2ESSyJOm9atSpDygUpw14cROYohEC';

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

// ─── Phone Normalization ────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return '';
  // Remove all non-digit chars except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  // German numbers: convert 0 prefix to +49
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
    cleaned = '+49' + cleaned.slice(1);
  }
  // 00 prefix → +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }
  // Ensure + prefix
  if (!cleaned.startsWith('+') && cleaned.length > 6) {
    cleaned = '+49' + cleaned;
  }
  return cleaned;
}

// ─── Extract First Name ─────────────────────────────────────
// Replaces the GPT-4o-mini AI step — simple string operation
function extractFirstName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  // First part is usually the first name
  const firstName = parts[0] || '';
  // Basic validation: must start with uppercase, be at least 2 chars
  if (firstName.length >= 2 && /^[A-ZÄÖÜ]/i.test(firstName)) {
    return firstName;
  }
  return '';
}

// ─── Determine Opportunity Status ───────────────────────────
function getOpportunityStatus(eventType, actionId) {
  // "Kontakt form" or similar web form → ANFRAGE_STATUS
  // Calendly bookings → TERMIN_STATUS
  const id = (actionId || '').toLowerCase();
  if (id.includes('kontakt') || id.includes('formular') || id.includes('anfrage')) {
    return ANFRAGE_STATUS;
  }
  return TERMIN_STATUS;
}

// ─── Parse Calendly Webhook Payload ─────────────────────────
function parseCalendlyPayload(payload) {
  // Calendly v2 webhook format
  const invitee = payload.payload?.invitee || payload.payload || {};
  const event = payload.payload?.event || {};
  const questions = payload.payload?.questions_and_answers || invitee.questions_and_answers || [];
  const tracking = invitee.tracking || {};
  const scheduledEvent = payload.payload?.scheduled_event || event;

  // Extract name
  const fullName = invitee.name || invitee.first_name || '';
  const email = invitee.email || '';

  // Extract phone and custom answers from questions
  let phone = '';
  let firmenname = '';
  let freitext = '';
  let branche = '';
  let wannStarten = '';
  let mitarbeiterAnzahl = '';
  let zielBranding = '';
  let zielNeueMitarbeiter = '';
  let zielNeukunden = '';
  let zielEtwasAnderes = '';

  for (const q of questions) {
    const question = (q.question || '').toLowerCase();
    const answer = q.answer || '';

    if (question.includes('telefon') || question.includes('phone') || question.includes('tel')) {
      phone = answer;
    } else if (question.includes('firma') || question.includes('unternehmen') || question.includes('company')) {
      firmenname = answer;
    } else if (question.includes('branche') || question.includes('industry')) {
      branche = answer;
    } else if (question.includes('mitarbeiter') || question.includes('employees')) {
      mitarbeiterAnzahl = answer;
    } else if (question.includes('wann') || question.includes('start')) {
      wannStarten = answer;
    } else if (question.includes('branding')) {
      zielBranding = answer;
    } else if (question.includes('neukunden') || question.includes('new customers')) {
      zielNeukunden = answer;
    } else if (question.includes('neue mitarbeiter') || question.includes('recruiting')) {
      zielNeueMitarbeiter = answer;
    } else if (question.includes('sonstiges') || question.includes('anderes') || question.includes('other')) {
      zielEtwasAnderes = answer;
    } else if (question.includes('nachricht') || question.includes('message') || question.includes('freitext')) {
      freitext = answer;
    }
  }

  // UTM tracking
  const utmSource = tracking.utm_source || '';
  const utmMedium = tracking.utm_medium || '';
  const utmCampaign = tracking.utm_campaign || '';
  const utmTerm = tracking.utm_term || '';
  const utmContent = tracking.utm_content || '';

  // Event type from event name or URI
  const eventName = scheduledEvent.name || scheduledEvent.event_type?.name || '';

  return {
    fullName,
    email,
    phone,
    firmenname,
    freitext,
    branche,
    wannStarten,
    mitarbeiterAnzahl,
    zielBranding,
    zielNeueMitarbeiter,
    zielNeukunden,
    zielEtwasAnderes,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    eventName,
  };
}

// ─── Main Handler ───────────────────────────────────────────

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const CLOSE_API_KEY = env.CLOSE_API_KEY;

    if (!CLOSE_API_KEY) {
      return new Response(JSON.stringify({ error: 'CLOSE_API_KEY not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const payload = await context.request.json();

    // ── Parse Calendly data ──
    const data = parseCalendlyPayload(payload);

    if (!data.email && !data.phone) {
      return new Response(JSON.stringify({
        error: 'No email or phone in webhook payload',
      }), { status: 400, headers: corsHeaders });
    }

    // ── Normalize phone ──
    const phoneNormalized = normalizePhone(data.phone);

    // ── Extract first name ──
    const firstName = extractFirstName(data.fullName);

    // ── Determine opportunity status ──
    const oppStatus = getOpportunityStatus(data.eventName, '');

    // ── Build UTM strings for Close custom fields ──
    const adField = [data.utmCampaign, data.utmTerm, data.utmContent]
      .filter(Boolean).join(' | ');
    const quelleField = [data.utmSource, data.utmMedium]
      .filter(Boolean).join(' | ');

    // ── Search for existing lead in Close ──
    let leadId = null;
    let leadExists = false;

    // Search by email first
    if (data.email) {
      try {
        const searchResult = await closeAPI(
          'GET',
          `lead/?query=email:"${data.email}"&_fields=id`,
          CLOSE_API_KEY,
        );
        if (searchResult.data?.length > 0) {
          leadId = searchResult.data[0].id;
          leadExists = true;
        }
      } catch (_) { /* continue to phone search */ }
    }

    // If not found, search by phone
    if (!leadId && phoneNormalized) {
      try {
        const searchResult = await closeAPI(
          'GET',
          `lead/?query=phone:"${phoneNormalized}"&_fields=id`,
          CLOSE_API_KEY,
        );
        if (searchResult.data?.length > 0) {
          leadId = searchResult.data[0].id;
          leadExists = true;
        }
      } catch (_) { /* continue to create */ }
    }

    // ── Create lead if not found ──
    if (!leadId) {
      const leadData = {
        name: data.firmenname || data.fullName || data.email,
        status_label: 'Lead',
        contacts: [{
          name: data.fullName || '',
          emails: data.email ? [{ email: data.email, type: 'office' }] : [],
          phones: phoneNormalized ? [{ phone: phoneNormalized, type: 'office' }] : [],
        }],
        // Custom fields — use Close custom field IDs
        // Ad (UTM Campaign + Term + Content)
        ...(adField && { 'custom.cf_XW2hfkQwHCP4MGaTBfJitVN0ReYjheXjIZKjLbBtMhz': adField }),
        // Quelle (UTM Source + Medium)
        ...(quelleField && { 'custom.cf_V6HRCPxKnerOXkYojfnQ23DBFN0HVC9eisclazlw2OL': quelleField }),
        // Branche
        ...(data.branche && { 'custom.cf_L24PbuKGTeNQL8QlKV1CclvpDqngYHsDD2b2dKpccEC': data.branche }),
        // Mitarbeiteranzahl
        ...(data.mitarbeiterAnzahl && { 'custom.cf_0QcoKgwXRhvZisQVmEU9DDISZpojHGU9hn1v1qdwtWK': data.mitarbeiterAnzahl }),
        // Assigned user (automation_neuer_lead_bearbeiter)
        'custom.cf_1f4LgqkpvCiP6ChqOWdZowZ8GHyHDuj3Rs9VRNTLbFR': ASSIGNED_USER,
        // First name (automation_AI_vorname)
        ...(firstName && { 'custom.cf_gBajgJhca13e7AknzWE7Wc0ZtKO1aq4Xa3hvWsJdS46': firstName }),
      };

      const newLead = await closeAPI('POST', 'lead/', CLOSE_API_KEY, leadData);
      leadId = newLead.id;
    }

    // ── Create Opportunity ──
    const oppData = {
      lead_id: leadId,
      status_id: oppStatus,
      user_id: ASSIGNED_USER,
    };

    const newOpp = await closeAPI('POST', 'opportunity/', CLOSE_API_KEY, oppData);

    // ── Add note with Calendly details if freitext present ──
    if (data.freitext) {
      await closeAPI('POST', 'activity/note/', CLOSE_API_KEY, {
        lead_id: leadId,
        note: `**Calendly Freitext:**\n${data.freitext}`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      leadId,
      leadCreated: !leadExists,
      opportunityId: newOpp.id,
      ASSIGNED_USER,
      firstName,
      eventName: data.eventName,
    }), { status: 200, headers: corsHeaders });

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
