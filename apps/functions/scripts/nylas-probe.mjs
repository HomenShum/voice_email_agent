#!/usr/bin/env node
// Minimal Nylas v3 probe: GET /v3/grants/{grantId}/messages?limit=200
// Reads env from process.env or falls back to parsing .env in CWD.

import fs from 'node:fs';
import path from 'node:path';

function loadDotEnvIntoProcessEnv(dotenvPath = path.resolve(process.cwd(), '.env')) {
  try {
    if (!fs.existsSync(dotenvPath)) return;
    const text = fs.readFileSync(dotenvPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

async function main() {
  loadDotEnvIntoProcessEnv();

  const apiKey = process.env.NYLAS_API_KEY;
  const grantId = process.env.NYLAS_GRANT_ID || process.env.GRANT_ID;
  const base = (process.env.NYLAS_BASE && process.env.NYLAS_BASE.trim()) || 'https://api.us.nylas.com/v3';
  const limit = Number(process.env.NYLAS_PROBE_LIMIT || 200);

  if (!apiKey || !grantId) {
    console.error('[nylas-probe] Missing NYLAS_API_KEY or NYLAS_GRANT_ID in env/.env');
    process.exit(2);
  }

  const url = new URL(`${base.replace(/\/$/, '')}/grants/${grantId}/messages`);
  url.searchParams.set('limit', String(limit));

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json, application/gzip',
    'Content-Type': 'application/json',
  };

  const started = Date.now();
  let status = 0;
  try {
    const res = await fetch(url.toString(), { headers });
    status = res.status;
    const text = await res.text();
    if (!res.ok) {
      console.error(`[nylas-probe] HTTP ${res.status}: ${text.slice(0, 500)}`);
      console.log(`SUMMARY | nylas-probe | status=${res.status} grant=${grantId} count=0 error=true base=${base}`);
      process.exit(1);
    }
    const json = JSON.parse(text);
    const data = Array.isArray(json?.data) ? json.data : [];
    const count = data.length;
    const first = data[0] || {};
    const sample = {
      id: first.id,
      subject: first.subject,
      thread_id: first.thread_id,
      date: first.date,
    };
    console.log('[nylas-probe] status:', status);
    console.log('[nylas-probe] count:', count);
    console.log('[nylas-probe] first:', sample);
    const ms = Date.now() - started;
    console.log(`SUMMARY | nylas-probe | status=${status} grant=${grantId} count=${count} ms=${ms} base=${base}`);
  } catch (err) {
    console.error('[nylas-probe] Error:', err?.message || err);
    console.log(`SUMMARY | nylas-probe | status=${status||'ERR'} grant=${grantId} count=0 error=true base=${base}`);
    process.exit(1);
  }
}

main();

