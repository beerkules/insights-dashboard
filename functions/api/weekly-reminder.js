/**
 * Weekly Reminder — Salesteam Leadpflege — Cloudflare Function
 * Replaces Zapier "Weekly Reminder - Salesteam" (5 Steps: Schedule → 4× Close Create Task)
 *
 * Required env vars:
 *   - CLOSE_API_KEY
 *
 * Manual Trigger:
 *   GET https://dashboard.hashtaghamburg.de/api/weekly-reminder
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

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

const SALESTEAM_LEAD = 'lead_7w74CvQQBdhmt8xERk3RfqEPDK10ZmQgllk7gJNbU8Q';

const TASKS = [
  {
    userName: 'Benjamin Nadjem',
    userId: null,
    text: '🚨 Smartview Leadpflege',
  },
  {
    userName: 'Faruk 21',
    userId: null,
    text: '🚨 Filter Outbound Leads https://docs.google.com/spreadsheets/d/1zJEW9-QLgg2CSbOz_42lMHQYGtXWr2coa4h',
  },
];

async function resolveUserIds(apiKey) {
  const usersResponse = await closeAPI('GET', 'user/', apiKey);
  const users = usersResponse.data || [];
  for (const task of TASKS) {
    if (task.userId) continue;
    const match = users.find(u =>
      u.first_name?.includes(task.userName.split(' ')[0]) ||
      `${u.first_name} ${u.last_name}` === task.userName
    );
    if (match) task.userId = match.id;
  }
}

async function createWeeklyTasks(apiKey) {
  await resolveUserIds(apiKey);
  const today = new Date().toISOString().split('T')[0];
  const results = [];
  for (const task of TASKS) {
    if (!task.userId) {
      results.push({ userName: task.userName, error: 'User-ID nicht gefunden. Bitte manuell eintragen.' });
      continue;
    }
    try {
      const created = await closeAPI('POST', 'task/', apiKey, {
        lead_id: SALESTEAM_LEAD,
        assigned_to: task.userId,
        date: today,
        text: task.text,
        is_complete: false,
      });
      results.push({ userName: task.userName, taskId: created.id, success: true });
    } catch (err) {
      results.push({ userName: task.userName, error: err.message });
    }
  }
  return results;
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const CLOSE_API_KEY = env.CLOSE_API_KEY;
    if (!CLOSE_API_KEY) {
      return new Response(JSON.stringify({ error: 'CLOSE_API_KEY not configured' }), { status: 500, headers: corsHeaders });
    }
    const results = await createWeeklyTasks(CLOSE_API_KEY);
    return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), tasks: results }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
  });
}
