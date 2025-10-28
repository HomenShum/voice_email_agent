import './style.css';
import typescriptLogo from './typescript.svg';
import viteLogo from '/vite.svg';
import { createVoiceSession, setTranscriptHandler } from './lib/voiceAgent';
import { setSearchResultsHandler, setContactsHandler, setEventsHandler, setUnreadHandler, setSyncStatusHandler, setToolProgressHandler, setEmailMetricsHandler, setToolCallHandler, type ToolCallRecord } from './lib/tools';

let session: unknown;
const toolCallHistory: ToolCallRecord[] = [];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <a href="https://vite.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Voice Agent + Vite</h1>
    <div class="card">
      <button id="connect" type="button">Connect Voice Agent</button>
    </div>
    <!-- Conversation Panel -->
    <div id="transcript" class="panel small-scrollable-list">
      <h3>Conversation</h3>
      <ul id="transcript-list" class="list-reset"></ul>
    </div>

    <!-- Tool Results Panel -->
    <div id="results" class="panel">
      <h3>Tool Call History</h3>
      <ul id="results-list" class="list-reset scrollable-list"></ul>
    </div>

    <!-- Email Search Results Panel -->
    <div id="email-metrics" class="panel" style="display:none;">
      <h3>Email Search Results</h3>
      <div class="stat-display">
        <strong>Total Emails Found:</strong>
        <span id="total-emails">0</span>
      </div>
      <div>
        <h4>Top 10 Results</h4>
        <ul id="email-results-list" class="list-reset scrollable-list"></ul>
      </div>
    </div>

    <!-- Nylas Integration Panel -->
    <div id="nylas" class="panel">
      <h3>Nylas Integration</h3>

      <div class="control-group">
        <button id="start-sync" type="button">Start Sync</button>
        <input id="nylas-api-key" type="password" placeholder="Nylas API Key" />
        <input id="grant-id" type="text" placeholder="Enter Grant ID" />
        <button id="update-context" type="button">Update Voice Agent Context</button>
        <button id="delta-sync" type="button">Delta Sync Now</button>
        <button id="delete-data" type="button" class="danger">Delete All Data</button>
        <button id="refresh-nylas" type="button">Refresh Data</button>
      </div>

      <div class="grid-3col">
        <div class="grid-column">
          <h4>Contacts</h4>
          <ul id="contacts-list" class="list-reset"></ul>
        </div>
        <div class="grid-column">
          <h4>Events</h4>
          <ul id="events-list" class="list-reset"></ul>
        </div>
        <div class="grid-column">
          <h4>Unread Messages</h4>
          <ul id="unread-list" class="list-reset"></ul>
        </div>
      </div>

      <div id="sync-status" class="status-text"></div>
    </div>

    <!-- Hourly Sync History Panel -->
    <div id="jobs-history" class="panel">
      <h3>Hourly Sync History</h3>
      <ul id="jobs-list" class="list-reset scrollable-list"></ul>
    </div>

    <!-- Index Stats Panel -->
    <div id="index-stats" class="panel">
      <h3>Index Statistics</h3>
      <div class="control-group">
        <button id="stats-refresh" type="button">Refresh Index Stats</button>
      </div>
      <div class="grid-2col">
        <div class="grid-column">
          <h4>Dense</h4>
          <ul id="dense-top5" class="list-reset"></ul>
          <div class="stat-display"><strong>Total:</strong> <span id="dense-total">0</span></div>
        </div>
        <div class="grid-column">
          <h4>Sparse</h4>
          <ul id="sparse-top5" class="list-reset"></ul>
          <div class="stat-display"><strong>Total:</strong> <span id="sparse-total">0</span></div>
        </div>
      </div>
      <div class="stat-display small">
        <strong>Last Updated:</strong> <span id="stats-updated">-</span>
      </div>
    </div>


    <p class="read-the-docs">
      Grant microphone access when prompted. Speak after connecting.
    </p>
  </div>
`;

// --- Index Stats UI ---
const statsPanel = document.querySelector<HTMLDivElement>('#index-stats')!;
const statsRefreshBtn = document.querySelector<HTMLButtonElement>('#stats-refresh')!;
const denseTop5El = document.querySelector<HTMLUListElement>('#dense-top5')!;
const sparseTop5El = document.querySelector<HTMLUListElement>('#sparse-top5')!;
const denseTotalEl = document.querySelector<HTMLSpanElement>('#dense-total')!;
const sparseTotalEl = document.querySelector<HTMLSpanElement>('#sparse-total')!;
const statsUpdatedEl = document.querySelector<HTMLSpanElement>('#stats-updated')!;

function renderIndexStats(payload: any) {
  const session = payload?.session || {};
  const pinecone = payload?.pinecone || {};
  const dense = session?.dense || {};
  const sparse = session?.sparse || {};
  const denseTop = Array.isArray(dense?.top5Types) ? dense.top5Types : [];
  const sparseTop = Array.isArray(sparse?.top5Types) ? sparse.top5Types : [];

  const makeLi = (t: any) => {
    const li = document.createElement('li');
    const type = typeof t?.type === 'string' ? t.type : String(t?.type || '');
    const count = typeof t?.count === 'number' ? t.count : (typeof t?.value === 'number' ? t.value : 0);
    li.textContent = `${type || '(unknown)'}: ${count}`;
    return li;
  };

  denseTop5El.innerHTML = '';
  for (const t of denseTop) denseTop5El.appendChild(makeLi(t));
  sparseTop5El.innerHTML = '';
  for (const t of sparseTop) sparseTop5El.appendChild(makeLi(t));

  const denseTotal = (pinecone?.dense?.totalRecordCount) ?? dense?.records ?? 0;
  const sparseTotal = (pinecone?.sparse?.totalRecordCount) ?? sparse?.records ?? 0;
  denseTotalEl.textContent = String(denseTotal || 0);
  sparseTotalEl.textContent = String(sparseTotal || 0);

  const updated = dense?.lastUpdated || sparse?.lastUpdated || payload?.persisted?.updatedAt || payload?.session?.startedAt;
  statsUpdatedEl.textContent = updated ? new Date(updated).toLocaleTimeString() : '-';
}

async function refreshIndexStats() {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/api/index/stats?includePersisted=1`);
    if (!res.ok) return;
    const data = await res.json();
    renderIndexStats(data);
  } catch (e) {
    console.warn('[index-stats] refresh failed', e);
  }
}

statsRefreshBtn.addEventListener('click', async () => {
  statsRefreshBtn.disabled = true;
  statsRefreshBtn.textContent = 'Refreshing...';
  await refreshIndexStats();
  statsRefreshBtn.disabled = false;
  statsRefreshBtn.textContent = 'Refresh Index Stats';
});

setInterval(refreshIndexStats, 15000);
void refreshIndexStats();


const transcriptList = document.querySelector<HTMLUListElement>('#transcript-list')!;
const resultsList = document.querySelector<HTMLUListElement>('#results-list')!;

const contactsList = document.querySelector<HTMLUListElement>('#contacts-list')!;
const eventsList = document.querySelector<HTMLUListElement>('#events-list')!;
const unreadList = document.querySelector<HTMLUListElement>('#unread-list')!;
const syncStatus = document.querySelector<HTMLDivElement>('#sync-status')!;
const startSyncBtn = document.querySelector<HTMLButtonElement>('#start-sync')!;
const deltaSyncBtn = document.querySelector<HTMLButtonElement>('#delta-sync')!;

const apiKeyInput = document.querySelector<HTMLInputElement>('#nylas-api-key')!;
const updateCtxBtn = document.querySelector<HTMLButtonElement>('#update-context')!;
const deleteDataBtn = document.querySelector<HTMLButtonElement>('#delete-data')!;
let syncPollTimer: any = null;

const grantInput = document.querySelector<HTMLInputElement>('#grant-id')!;
const refreshNylasBtn = document.querySelector<HTMLButtonElement>('#refresh-nylas')!;

const emailMetricsDiv = document.querySelector<HTMLDivElement>('#email-metrics')!;
const totalEmailsSpan = document.querySelector<HTMLSpanElement>('#total-emails')!;
const emailResultsList = document.querySelector<HTMLUListElement>('#email-results-list')!;
const jobsListEl = document.querySelector<HTMLUListElement>('#jobs-list')!;


const FUNCTIONS_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';
const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';

function extractText(item: any): string {

  if (!item) return '';
  const seen = new Set<any>();
  function walk(node: any, depth = 0): string[] {
    if (!node || typeof node === 'function' || seen.has(node) || depth > 4) return [];
    if (typeof node === 'string') return [node];
    if (typeof node !== 'object') return [];
    seen.add(node);
    const out: string[] = [];
    // common direct fields
    if (typeof node.text === 'string') out.push(node.text);
    if (typeof node.transcript === 'string') out.push(node.transcript);
    if (typeof node.content === 'string') out.push(node.content);
    // common array content shapes
    if (Array.isArray(node.content)) for (const c of node.content) out.push(...walk(c, depth + 1));
    // scan other properties
    for (const k of Object.keys(node)) {
      if (k === 'text' || k === 'transcript' || k === 'content') continue;
      const v: any = (node as any)[k];
      if (typeof v === 'string') {
        if (k.includes('text') || k.includes('transcript') || k.includes('message')) out.push(v);
      } else if (Array.isArray(v)) {
        for (const el of v) out.push(...walk(el, depth + 1));
      } else if (v && typeof v === 'object') {
        out.push(...walk(v, depth + 1));
      }
    }
    return out;
  }
  return walk(item).join(' ').trim();
}

function renderTranscript(history: any[]) {
  transcriptList.innerHTML = '';
  const items = Array.isArray(history) ? history : [];
  const messages = items.filter((i: any) => i?.role || i?.type === 'message');
  for (const m of messages.slice(-30)) {
    const li = document.createElement('li');
    const who = m.role || (m.author ?? 'assistant');
    const text = extractText(m) || '[no text]';
    li.innerHTML = `<strong>${who}:</strong> ${text}`;
    transcriptList.appendChild(li);
  }
  const scroller = transcriptList.parentElement as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
}

function appendToolUpdate(text: string) {
  const li = document.createElement('li');
  li.innerHTML = `<em style="color:#555;">[tool] ${text}</em>`;
  transcriptList.appendChild(li);
  const scroller = transcriptList.parentElement as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
}

// Wire proactive tool progress logs into the transcript UI
setToolProgressHandler((text: string) => {
  appendToolUpdate(text);
});

// Wire tool call tracking to results panel
setToolCallHandler((toolCall: ToolCallRecord) => {
  toolCallHistory.push(toolCall);
  renderToolResults();
});

function renderToolResults() {
  resultsList.innerHTML = '';

  // Display in reverse chronological order (newest first)
  const recentCalls = toolCallHistory.slice(-20).reverse();

  for (const call of recentCalls) {
    const li = document.createElement('li');
    li.className = 'tool-call-item';

    const timestamp = new Date(call.timestamp).toLocaleTimeString();
    const statusClass = call.error ? 'error' : 'success';
    const statusIcon = call.error ? '❌' : '✅';

    // Format parameters
    const paramsKeys = Object.keys(call.parameters || {});
    const paramsPreview = paramsKeys.length > 0
      ? paramsKeys.map(k => {
          const v = call.parameters[k];
          if (v === null || v === undefined) return null;
          if (typeof v === 'object') return `${k}: {...}`;
          if (typeof v === 'string' && v.length > 30) return `${k}: "${v.substring(0, 30)}..."`;
          return `${k}: ${JSON.stringify(v)}`;
        }).filter(Boolean).join(', ')
      : 'no params';

    // Format result summary
    let resultSummary = '';
    if (call.error) {
      resultSummary = `<span class="error-text">Error: ${call.error}</span>`;
    } else if (call.result) {
      const r = call.result;
      if (Array.isArray(r?.results)) {
        const total = r.total ?? r.results.length;
        resultSummary = `${r.results.length} of ${total} results`;
      } else if (Array.isArray(r?.data)) {
        resultSummary = `${r.data.length} items`;
      } else if (Array.isArray(r?.groups)) {
        resultSummary = `${r.groups.length} groups`;
      } else if (typeof r?.total === 'number') {
        resultSummary = `<strong>Total: ${r.total.toLocaleString()} emails</strong>`;
      } else if (typeof r?.count === 'number') {
        resultSummary = `count: ${r.count}`;
      } else if (typeof r?.queued === 'number') {
        resultSummary = `queued: ${r.queued}`;
      } else {
        resultSummary = 'completed';
      }
    }

    li.innerHTML = `
      <div class="tool-call-header">
        <span class="tool-status ${statusClass}">${statusIcon}</span>
        <strong>${call.name}</strong>
        <span class="tool-time">${timestamp}</span>
        ${call.duration ? `<span class="tool-duration">${call.duration}ms</span>` : ''}
      </div>
      <div class="tool-params">${paramsPreview}</div>
      ${resultSummary ? `<div class="tool-result">${resultSummary}</div>` : ''}
    `;

    resultsList.appendChild(li);
  }

  // Show count if there are more calls than displayed
  if (toolCallHistory.length > 20) {
    const info = document.createElement('li');
    info.className = 'tool-info';
    info.textContent = `Showing last 20 of ${toolCallHistory.length} total calls`;
    resultsList.appendChild(info);
  }
}


setTranscriptHandler((history: any[]) => {
  renderTranscript(history);
});

// Keep search results handler for backward compatibility but tool calls now render in results panel
setSearchResultsHandler((payload: any) => {
  const items = Array.isArray(payload?.results) ? payload.results : [];
  appendToolUpdate(`search_emails returned ${items.length} result(s)`);
});

// Email metrics handler - display total count and top 10 results
setEmailMetricsHandler((payload: any) => {
  const items = Array.isArray(payload?.results) ? payload.results : [];
  const total = payload?.total ?? items.length;

  // Show metrics div
  emailMetricsDiv.style.display = 'block';
  totalEmailsSpan.textContent = String(total);

  // Render top 10 results with metadata
  emailResultsList.innerHTML = '';
  for (const r of items.slice(0, 10)) {
    const li = document.createElement('li');
    const dateStr = r.date ? new Date(r.date * 1000).toLocaleDateString() : 'unknown';
    const scoreStr = r.score ? ` (score: ${(r.score as number).toFixed(2)})` : '';
    li.innerHTML = `
      <div class="email-result-item">
        <strong>${r.title || r.id}</strong>
        <div class="email-meta">From: ${r.from || 'unknown'} | ${dateStr}${scoreStr}</div>
        <div class="email-preview">${r.snippet || 'No preview'}</div>
      </div>
    `;
    emailResultsList.appendChild(li);
  }
});

setContactsHandler((payload: any) => {
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.contacts) ? payload.contacts : []);
  contactsList.innerHTML = '';
  for (const c of items.slice(0, 5)) {
    const name = c?.name || c?.display_name || '';
    const emails = Array.isArray(c?.emails) ? c.emails.map((e: any) => e?.email || e).filter(Boolean).join(', ') : (c?.email || '');
    const li = document.createElement('li');
    li.textContent = `${name || emails || c?.id || 'contact'}`;
    contactsList.appendChild(li);
  }
  const count = items.length || 0;
  appendToolUpdate(`list_contacts returned ${count} item(s)`);
});

setEventsHandler((payload: any) => {
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.events) ? payload.events : []);
  eventsList.innerHTML = '';
  for (const ev of items.slice(0, 5)) {
    const title = ev?.title || ev?.summary || ev?.subject || ev?.id || 'event';
    const li = document.createElement('li');
    li.textContent = `${title}`;
    eventsList.appendChild(li);
  }
  const count = items.length || 0;
  appendToolUpdate(`list_events returned ${count} item(s)`);
});

setUnreadHandler((payload: any) => {
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.messages) ? payload.messages : []);
  unreadList.innerHTML = '';
  for (const m of items.slice(0, 5)) {
    const subject = m?.subject || m?.snippet || m?.id || 'message';
    const li = document.createElement('li');
    li.textContent = `${subject}`;
    unreadList.appendChild(li);
  }
  const count = items.length || 0;
  appendToolUpdate(`list_unread_messages returned ${count} item(s)`);
});

setSyncStatusHandler((payload: any) => {
  const queued = payload?.queued ?? 0;
  syncStatus.textContent = `Sync queued: ${queued}`;
  appendToolUpdate(`sync_start queued ${queued} email(s)`);
});

startSyncBtn.addEventListener('click', async () => {
  try {
    startSyncBtn.disabled = true;
    startSyncBtn.textContent = 'Syncing...';
    const res = await fetch('http://localhost:8787/sync/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sinceEpoch: Math.floor(Date.now()/1000), limit: 25 }),
    });
    const data = await res.json();
    syncStatus.textContent = `Sync queued: ${data?.queued ?? 0}`;
    appendToolUpdate(`sync_start queued ${data?.queued ?? 0} email(s)`);
  } catch (e) {
    console.error(e);
    syncStatus.textContent = 'Sync failed — see console';


  } finally {
    startSyncBtn.disabled = false;
    startSyncBtn.textContent = 'Start Sync';
  }
});

// Manual Delta Sync button
const deltaSyncBtn2 = deltaSyncBtn; // alias for clarity

deltaSyncBtn2.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  if (!grantId) {
    appendToolUpdate('delta_start skipped — enter grantId first');
    return;
  }
  // Save grant ID to localStorage
  localStorage.setItem('nylasGrantId', grantId);

  try {
    deltaSyncBtn2.disabled = true;
    deltaSyncBtn2.textContent = 'Delta Syncing...';
    const res = await fetch(`${FUNCTIONS_BASE}/api/sync/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId }),
    });
    const data = await res.json();
    syncStatus.textContent = `Delta enqueued for ${grantId}: sinceEpoch=${data?.sinceEpoch ?? 'n/a'}`;

    appendToolUpdate(`delta_start enqueued for grant ${grantId}`);
    void refreshJobsHistory();
  } catch (e) {
    console.error(e);
    syncStatus.textContent = 'Delta sync failed — see console';
  } finally {
    deltaSyncBtn2.disabled = false;
    deltaSyncBtn2.textContent = 'Delta Sync Now';
  }
});




// Initialize Nylas data on app load
async function initializeNylasData() {
  try {
    // Get grantId from localStorage or use placeholder
    const storedGrantId = localStorage.getItem('nylasGrantId');
    const grantId = storedGrantId || grantInput.value.trim();

    // If no grantId is available, rely on backend env var (NYLAS_GRANT_ID)
    const params = new URLSearchParams({ limit: '5' });
    if (grantId) {
      params.set('grantId', grantId);
      console.log(`[init] Using grantId: ${grantId}`);
    } else {
      console.log('[init] No grantId provided, relying on backend NYLAS_GRANT_ID env var');
    }

    // Fetch contacts
    const contactsRes = await fetch(`${API_BASE}/nylas/contacts?${params}`);
    if (contactsRes.ok) {
      const contactsData = await contactsRes.json();
      const items = Array.isArray(contactsData?.data) ? contactsData.data : (Array.isArray(contactsData?.contacts) ? contactsData.contacts : []);
      contactsList.innerHTML = '';
      for (const c of items.slice(0, 5)) {
        const name = c?.name || c?.display_name || '';
        const emails = Array.isArray(c?.emails) ? c.emails.map((e: any) => e?.email || e).filter(Boolean).join(', ') : (c?.email || '');
        const li = document.createElement('li');
        li.textContent = `${name || emails || c?.id || 'contact'}`;
        contactsList.appendChild(li);
      }
      console.log(`[init] Loaded ${items.length} contacts`);
    } else {
      console.warn('[init] Failed to load contacts:', await contactsRes.text());
    }

    // Fetch events
    const eventsRes = await fetch(`${API_BASE}/nylas/events?${params}`);
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      const items = Array.isArray(eventsData?.data) ? eventsData.data : (Array.isArray(eventsData?.events) ? eventsData.events : []);
      eventsList.innerHTML = '';
      for (const ev of items.slice(0, 5)) {
        const title = ev?.title || ev?.summary || ev?.subject || ev?.id || 'event';
        const li = document.createElement('li');
        li.textContent = `${title}`;
        eventsList.appendChild(li);
      }
      console.log(`[init] Loaded ${items.length} events`);
    } else {
      console.warn('[init] Failed to load events:', await eventsRes.text());
    }

    // Fetch unread messages
    const unreadRes = await fetch(`${API_BASE}/nylas/unread?${params}`);
    if (unreadRes.ok) {
      const unreadData = await unreadRes.json();
      const items = Array.isArray(unreadData?.data) ? unreadData.data : (Array.isArray(unreadData?.messages) ? unreadData.messages : []);
      unreadList.innerHTML = '';
      for (const m of items.slice(0, 5)) {
        const subject = m?.subject || m?.snippet || m?.id || 'message';
        const li = document.createElement('li');
        li.textContent = `${subject}`;
        unreadList.appendChild(li);
      }
      console.log(`[init] Loaded ${items.length} unread messages`);
    } else {
      console.warn('[init] Failed to load unread messages:', await unreadRes.text());
    }

    console.log('[init] Nylas data loaded successfully');
  } catch (e) {
    console.error('[init] Failed to load Nylas data:', e);
  }
}

// Load saved grant ID from localStorage
const savedGrantId = localStorage.getItem('nylasGrantId');
if (savedGrantId) {
  grantInput.value = savedGrantId;
}

// Save grant ID to localStorage when changed
grantInput.addEventListener('change', () => {
  const value = grantInput.value.trim();
  if (value) {
    localStorage.setItem('nylasGrantId', value);
    console.log('[init] Grant ID saved to localStorage');
  } else {
    localStorage.removeItem('nylasGrantId');
  }
  void refreshJobsHistory();
});

// Refresh button handler
refreshNylasBtn.addEventListener('click', async () => {

  refreshNylasBtn.disabled = true;
  refreshNylasBtn.textContent = 'Refreshing...';
  await initializeNylasData();
  refreshNylasBtn.disabled = false;
  refreshNylasBtn.textContent = 'Refresh Data';
});
function renderJobsHistory(jobs: any[]) {
  if (!jobsListEl) return;
  jobsListEl.innerHTML = '';
  const items = Array.isArray(jobs) ? jobs : [];
  for (const j of items.slice(0, 24)) {
    const li = document.createElement('li');
    const created = j?.createdAt ? new Date(j.createdAt).toLocaleTimeString() : '';
    const processed = typeof j?.processed === 'number' ? j.processed : 0;
    const iv = typeof j?.indexedVectors === 'number' ? j.indexedVectors : 0;
    const msg = j?.message ? ` — ${j.message}` : '';
    li.innerHTML = `<strong>${created}</strong> — ${j?.status || 'running'}: ${processed} msgs, ${iv} vectors${msg}`;
    jobsListEl.appendChild(li);
  }
}

async function refreshJobsHistory() {
  try {
    const gid = (localStorage.getItem('nylasGrantId') || grantInput.value || '').trim();
    if (!gid) return;
    const res = await fetch(`${FUNCTIONS_BASE}/api/user/jobs?grantId=${encodeURIComponent(gid)}&limit=24`);
    if (!res.ok) return;
    const data = await res.json();
    renderJobsHistory(data?.jobs || []);
  } catch (e) {
    console.warn('[jobs] refresh failed', e);
  }
}


function startProgressPolling(jobId: string) {
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
  const tick = async () => {
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/api/user/sync-progress/${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      const job = data?.job || {};
      const pct = (job?.percent ?? null);
      const status = job?.status || 'running';
      const proc = job?.processed ?? 0;
      const tot = (job?.total ?? null);
      const pctStr = pct === null ? '' : ` (${pct}%)`;
      const totalStr = tot === null || tot === undefined ? '' : `/${tot}`;
      syncStatus.textContent = `Sync status: ${status} \u2014 ${proc}${totalStr}${pctStr}`;
      if (status === 'complete' || status === 'error') {
        clearInterval(syncPollTimer);
        syncPollTimer = null;
      }
    } catch (e) {
      console.warn('[progress] poll failed', e);
    }
  };
  // kick and poll every 2s
  void tick();
  syncPollTimer = setInterval(tick, 2000);
}

updateCtxBtn.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  const apiKey = (apiKeyInput?.value || '').trim();
  if (!grantId || !apiKey) {
    appendToolUpdate('update-context skipped \u2014 enter API key and grantId');
    return;
  }
  // Save grantId locally for convenience
  localStorage.setItem('nylasGrantId', grantId);
  updateCtxBtn.disabled = true;
  updateCtxBtn.textContent = 'Updating...';
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/api/user/update-context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nylasApiKey: apiKey, grantId })
    });
    const data = await res.json();
    if (res.ok && data?.jobId) {
      appendToolUpdate(`update-context accepted: job ${data.jobId}`);
      syncStatus.textContent = `Sync queued for ${grantId} \u2014 job ${data.jobId}`;
      startProgressPolling(data.jobId);
      void refreshJobsHistory();
    } else {
      appendToolUpdate(`update-context failed: ${data?.error || 'unknown error'}`);
      syncStatus.textContent = `Update failed \u2014 ${data?.error || 'see console'}`;
    }
  } catch (e) {
    console.error(e);
    syncStatus.textContent = 'Update failed \u2014 see console';
  } finally {
    updateCtxBtn.disabled = false;
    updateCtxBtn.textContent = 'Update Voice Agent Context';
  }
});

deleteDataBtn.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  if (!grantId) {
    appendToolUpdate('delete skipped \u2014 enter grantId first');
    return;
  }
  const confirmDelete = window.confirm(`Delete ALL data for grant ${grantId}? This cannot be undone.`);
  if (!confirmDelete) return;
  deleteDataBtn.disabled = true;
  deleteDataBtn.textContent = 'Deleting...';
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/api/user/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grantId })
    });
    const data = await res.json();
    if (res.ok) {
      appendToolUpdate(`delete ok \u2014 pinecone: ${data?.pinecone || 'n/a'}`);
      syncStatus.textContent = `Deleted data for ${grantId}`;
    } else {
      appendToolUpdate(`delete failed: ${data?.error || 'unknown'}`);
      syncStatus.textContent = `Delete failed \u2014 ${data?.error || 'see console'}`;
    }
  } catch (e) {
    console.error(e);
    syncStatus.textContent = 'Delete failed \u2014 see console';
  } finally {
    deleteDataBtn.disabled = false;
    deleteDataBtn.textContent = 'Delete All Data';
  }
});


// Load Nylas data on startup
initializeNylasData();
void refreshJobsHistory();
setInterval(refreshJobsHistory, 60000);


document.querySelector<HTMLButtonElement>('#connect')!.addEventListener('click', async () => {
  const btn = document.querySelector<HTMLButtonElement>('#connect')!;
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  try {
    session = await createVoiceSession();
    btn.textContent = 'Connected ✓';
    void session;

  } catch (e) {
    console.error(e);
    btn.textContent = 'Failed — check console';
    btn.disabled = false;
  }
});
