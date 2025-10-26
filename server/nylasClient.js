// Minimal Nylas v3 REST client (zero deps)
// Docs: https://developer.nylas.com/docs/api/v3/ecc/

import { getApiKeyForGrant } from './nylasConfig.js';

const NYLAS_BASE = process.env.NYLAS_BASE || 'https://api.us.nylas.com/v3';

function authHeaders(grantId) {
  const key = getApiKeyForGrant(grantId);
  if (!key) throw new Error(`Missing API key for grant: ${grantId}`);
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function nylasGet(path, params = {}, grantId) {
  const url = new URL(NYLAS_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: authHeaders(grantId) });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Nylas GET ${url.pathname} failed ${r.status}: ${text}`);
  }
  return await r.json();
}

export async function listContacts({ grantId, limit = 5 }) {
  if (!grantId) throw new Error('grantId required');
  return nylasGet(`/grants/${grantId}/contacts`, { limit }, grantId);
}

export async function listEvents({ grantId, calendarId = 'primary', limit = 5 }) {
  if (!grantId) throw new Error('grantId required');
  return nylasGet(`/grants/${grantId}/events`, { calendar_id: calendarId, limit }, grantId);
}

export async function listUnreadMessages({ grantId, limit = 5, received_after } = {}) {
  if (!grantId) throw new Error('grantId required');
  const params = { limit, unread: 'true' };
  if (received_after) Object.assign(params, { received_after });
  return nylasGet(`/grants/${grantId}/messages`, params, grantId);
}



export async function listMessagesPage({ grantId, limit = 200, page_token, received_after } = {}) {
  if (!grantId) throw new Error('grantId required');
  const params = { limit };
  if (page_token) params.page_token = page_token;
  if (received_after) params.received_after = received_after;
  return nylasGet(`/grants/${grantId}/messages`, params, grantId);
}
