/**
 * Webseite Leadformular → Close Lead Creation — Cloudflare Function
 * Replaces Zapier "Webseite Leadformular -> Close" (2 Steps: Webhook → SubZap)
 *
 * Required env vars:
 *   - CLOSE_API_KEY
 *
 * Website Form Setup:
 *   POST https://dashboard.hashtaghamburg.de/api/website-lead
 *   Content-Type: application/json
 *   Body: { name, email, phone, company, message, utm_source, utm_medium, utm_campaign }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const ASSIGNED_USER = 'user_Iitd0EwzvBbThx5GFfUYT7N6upX7PZPyiaofwvcFPbg';
const ANFRAGE_STATUS = 'stat_m5ncxf213kocQZ2ESSyJOm9atSpDygUpw14cROYohEC';

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

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '+49' + cleaned.slice(1);
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (!cleaned.startsWith('+') && cleaned.length > 6) cleaned = '+49' + cleaned;
  return cleaned;
}

function extractFirstName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  return (firstName.length >= 2 && /^[A-ZÄÖÜ]/i.test(firstName)) ? firstName : '';
}

function parseFormPayload(body) {
  return {
    fullName: body.name || body.Name || body.fullName || body.full_name || '',
    email: body.email || body.Email || body.e_mail || body['E-Mail'] || '',
    phone: body.phone || body.Phone || body.telefon || body.Telefon || body.tel || '',
    company: body.company || body.Company || body.firma || body.Firma || body.firmenname || body.Firmenname || body.unternehmen || '',
    message: body.message || body.Message || body.nachricht || body.Nachricht || body.freitext || '',
    branche: body.branche || body.Branche || body.industry || '',
    utmSource: body.utm_source || body.utmSource || body.UTM_Source || '',
    utmMedium: body.utm_medium || body.utmMedium || '',
    utmCampaign: body.utm_campaign || body.utmCampaign || '',
    utmTerm: body.utm_term || body.utmTerm || '',
    utmContent: body.utm_content || body.utmContent || '',
  };
}

export async function onRequestPost(context) {
  const { env } = context;
  try {
    const CLOSE_API_KEY = env.CLOSE_API_KEY;
    if (!CLOSE_API_KEY) {
      return new Response(JSON.stringify({ error: 'CLOSE_API_KEY not configured' }), { status: 500, headers: corsHeaders });
    }
    const body = await context.request.json();
    const data = parseFormPayload(body);
    if (!data.email && !data.phone) {
      return new Response(JSON.stringify({ error: 'No email or phone provided' }), { status: 400, headers: corsHeaders });
    }
    const phoneNormalized = normalizePhone(data.phone);
    const firstName = extractFirstName(data.fullName);
    const adField = [data.utmCampaign, data.utmTerm, data.utmContent].filter(Boolean).join(' | ');
    const quelleField = [data.utmSource, data.utmMedium].filter(Boolean).join(' | ') || 'website';

    let leadId = null;
    let leadExists = false;
    if (data.email) {
      try {
        const result = await closeAPI('GET', `lead/?query=email:"${data.email}"&_fields=id`, CLOSE_API_KEY);
        if (result.data?.length > 0) { leadId = result.data[0].id; leadExists = true; }
      } catch (_) {}
    }
    if (!leadId && phoneNormalized) {
      try {
        const result = await closeAPI('GET', `lead/?query=phone:"${phoneNormalized}"&_fields=id`, CLOSE_API_KEY);
        if (result.data?.length > 0) { leadId = result.data[0].id; leadExists = true; }
      } catch (_) {}
    }

    if (!leadId) {
      const leadData = {
        name: data.company || data.fullName || data.email,
        status_label: 'Lead',
        contacts: [{ name: data.fullName || '', emails: data.email ? [{ email: data.email, type: 'office' }] : [], phones: phoneNormalized ? [{ phone: phoneNormalized, type: 'office' }] : [] }],
        ...(adField && { 'custom.cf_XW2hfkQwHCP4MGaTBfJitVN0ReYjheXjIZKjLbBtMhz': adField }),
        ...(quelleField && { 'custom.cf_V6HRCPxKnerOXkYojfnQ23DBFN0HVC9eisclazlw2OL': quelleField }),
        'custom.cf_1f4LgqkpvCiP6ChqOWdZowZ8GHyHDuj3Rs9VRNTLbFR': ASSIGNED_USER,
        ...(firstName && { 'custom.cf_gBajgJhca13e7AknzWE7Wc0ZtKO1aq4Xa3hvWsJdS46': firstName }),
      };
      const newLead = await closeAPI('POST', 'lead/', CLOSE_API_KEY, leadData);
      leadId = newLead.id;
    }

    const newOpp = await closeAPI('POST', 'opportunity/', CLOSE_API_KEY, {
      lead_id: leadId, status_id: ANFRAGE_STATUS, user_id: ASSIGNED_USER,
    });

    const noteLines = ['**Quelle:** Webseite Leadformular'];
    if (data.company) noteLines.push(`**Firma:** ${data.company}`);
    if (data.branche) noteLines.push(`**Branche:** ${data.branche}`);
    if (data.message) noteLines.push(`**Nachricht:** ${data.message}`);
    if (noteLines.length > 0) {
      await closeAPI('POST', 'activity/note/', CLOSE_API_KEY, { lead_id: leadId, note: noteLines.join('\n') });
    }

    return new Response(JSON.stringify({ success: true, leadId, leadCreated: !leadExists, opportunityId: newOpp.id }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
  });
}
