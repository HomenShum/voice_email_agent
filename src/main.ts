import './style.css';
import { createVoiceSession, setTranscriptHandler, setRouterProgressHandler } from './lib/voiceAgent';
import {
  setSearchResultsHandler,
  setContactsHandler,
  setEventsHandler,
  setUnreadHandler,
  setSyncStatusHandler,
  setToolProgressHandler,
  setEmailMetricsHandler,
  setToolCallHandler,
  emailOpsToolset,
  insightToolset,
  contactsToolset,
  calendarToolset,
  syncToolset,
  type ToolCallRecord,
} from './lib/tools';
import { SPECIALIST_MANIFEST } from './lib/agents/routerAgent';

const FUNCTIONS_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';
const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';

let session: unknown;
const toolCallHistory: ToolCallRecord[] = [];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="status-bar" role="region" aria-live="polite">
      <div class="status-primary">
        <span class="status-label">Connection</span>
        <span id="status-summary" class="status-value">Not connected</span>
        <span id="active-agent" class="status-subvalue">Agent: -</span>
      </div>
      <div class="quick-actions" aria-label="Quick actions">
        <button id="quick-connect" type="button" class="btn-secondary" title="Connect the realtime voice agent session">Connect</button>
        <button id="quick-backfill" type="button" class="btn-secondary" title="Run an initial backfill of the latest 10,000 emails">Backfill</button>
        <button id="quick-delta" type="button" class="btn-secondary" title="Trigger the hourly delta sync immediately">Delta Sync</button>
      </div>
    </header>
    <main class="main-grid">
      <section class="column column-primary">
        <div class="panel connect-panel">
          <div class="panel-header">
            <h2 class="panel-title">Voice Conversation</h2>
            <span class="panel-caption">Start a realtime session</span>
          </div>
          <p class="panel-subtitle">Connect your microphone to speak with the agent in real time.</p>
          <div class="button-row">
            <button id="connect" type="button" class="btn-primary">Connect Voice Agent</button>
          </div>
          <p class="control-hint">Requires microphone access. Begin speaking once connected.</p>
        </div>
        <div class="panel-split conversation-stack">
          <div id="transcript" class="panel conversation-panel">
            <div class="panel-header">
              <h3>Conversation</h3>
              <span class="panel-caption">Live transcript</span>
            </div>
            <ul id="transcript-list" class="list-reset small-scrollable-list"></ul>
          </div>
          <div id="routing" class="panel conversation-panel">
            <div class="panel-header">
              <h3>Routing</h3>
              <span class="panel-caption">Delegation updates</span>
            </div>
            <ul id="routing-list" class="list-reset small-scrollable-list" role="log" aria-live="polite"></ul>
          </div>
        </div>
      </section>
      <section class="column column-insights">
        <div class="compact-grid">
          <div class="panel dashboard-card" id="events-panel">
            <div class="panel-header">
              <h3>Upcoming Events</h3>
              <span class="panel-caption">Next 5 entries</span>
            </div>
            <ul id="events-list" class="list-reset dashboard-list"></ul>
          </div>
          <div class="panel dashboard-card" id="unread-panel">
            <div class="panel-header">
              <h3>Unread Messages</h3>
              <span class="panel-caption">Latest snippets</span>
            </div>
            <ul id="unread-list" class="list-reset dashboard-list"></ul>
          </div>
          <div class="panel dashboard-card" id="contacts-panel">
            <div class="panel-header">
              <h3>Contacts</h3>
              <span class="panel-caption">Recent people</span>
            </div>
            <ul id="contacts-list" class="list-reset dashboard-list"></ul>
          </div>
          <div id="email-metrics" class="panel dashboard-card hidden metrics-panel">
            <div class="panel-header">
              <h3>Email Search Results</h3>
              <span class="panel-caption">Top matches from hybrid search</span>
            </div>
            <div class="stat-display">
              <strong>Total Emails Found:</strong>
              <span id="total-emails">0</span>
            </div>
            <div>
              <h4>Top 10 Results</h4>
              <ul id="email-results-list" class="list-reset scrollable-list"></ul>
            </div>
          </div>
        </div>
        <div id="results" class="panel history-panel">
          <div class="panel-header">
            <h3>Tool Call History</h3>
            <span class="panel-caption">Latest 20 tool interactions</span>
          </div>
          <ul id="results-list" class="list-reset scrollable-list"></ul>
        </div>
      </section>
      <aside class="column column-ops">
        <div class="panel nylas-panel">
          <div class="panel-header">
            <h3>Nylas Connection</h3>
            <span class="panel-caption">Manage credentials & sync windows</span>
          </div>
          <div class="form-grid">
            <label class="form-field">
              <span class="field-label">Nylas API Key</span>
              <input id="nylas-api-key" type="password" placeholder="nyk_..." autocomplete="off" title="Enter the Nylas API key with access to this grant" />
            </label>
            <label class="form-field">
              <span class="field-label">Grant ID</span>
              <input id="grant-id" type="text" placeholder="grant-xxxx" autocomplete="off" title="Grant identifier used when syncing mailboxes" />
            </label>
          </div>
          <div class="action-stack">
            <button id="update-context" type="button" class="btn-primary" title="Save credentials and queue initial sync if needed">Save Nylas Credentials</button>
            <p class="control-hint">Validates the grant, stores the API key securely, and queues the first sync if one has not run.</p>
          </div>
          <div class="action-stack">
            <button id="start-sync" type="button" class="btn-secondary" title="Backfill the latest 10,000 emails for the current grant">Initial Backfill (10k emails)</button>
            <p class="control-hint">Uses the local backfill endpoint for quick smoke tests.</p>
          </div>
          <div class="action-stack">
            <button id="delta-sync" type="button" class="btn-secondary" title="Trigger the hourly delta job immediately">Run Delta Sync Now</button>
            <p class="control-hint">Enqueues the Azure Functions timer job so Pinecone receives fresh embeddings.</p>
          </div>
          <div class="action-inline">
            <button id="refresh-nylas" type="button" class="btn-secondary" title="Reload contacts, events, and unread snippets">Refresh Cached Lists</button>
            <button id="delete-data" type="button" class="btn-danger" title="Remove all Pinecone data and local cache for this grant">Delete All Data</button>
          </div>
          <div id="sync-status" class="status-text"></div>
        </div>
        <div id="capabilities" class="panel capability-panel">
          <div class="panel-header">
            <h3>Capabilities</h3>
            <span class="panel-caption">Available agents & tools</span>
          </div>
          <div class="capability-sections">
            <div class="capability-group">
              <div class="capability-group-header">
                <h4>Agents</h4>
                <span id="agent-count" class="capability-count-badge"></span>
              </div>
              <p class="capability-intro">Specialists the router can delegate to during a conversation.</p>
              <ul id="agent-list" class="list-reset capability-list"></ul>
            </div>
            <div class="capability-group">
              <div class="capability-group-header">
                <h4>Tools</h4>
                <span id="tool-count" class="capability-count-badge"></span>
              </div>
              <p class="capability-intro">APIs and workflows exposed to agents, grouped by focus area.</p>
              <ul id="tool-list" class="list-reset capability-list"></ul>
            </div>
          </div>
        </div>
        <div id="index-stats" class="panel dashboard-card">
          <div class="panel-header stats-header">
            <h3>Index Statistics</h3>
            <button id="stats-refresh" type="button" class="btn-secondary">Refresh Index Stats</button>
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
        <div id="jobs-history" class="panel dashboard-card">
          <div class="panel-header">
            <h3>Sync History</h3>
            <span class="panel-caption">Recent jobs</span>
          </div>
          <ul id="jobs-list" class="list-reset scrollable-list"></ul>
        </div>
      </aside>
    </main>
    <footer class="footnote read-the-docs">
      <p>Grant microphone access when prompted. Speak after connecting.</p>
    </footer>
  </div>
`;

// --- Shared UI Elements ---

const statusSummaryEl = document.querySelector<HTMLSpanElement>('#status-summary')!;
const syncStatus = document.querySelector<HTMLDivElement>('#sync-status')!;
const connectBtn = document.querySelector<HTMLButtonElement>('#connect')!;
const quickConnectBtn = document.querySelector<HTMLButtonElement>('#quick-connect')!;
const quickBackfillBtn = document.querySelector<HTMLButtonElement>('#quick-backfill')!;
const quickDeltaBtn = document.querySelector<HTMLButtonElement>('#quick-delta')!;
const activeAgentEl = document.querySelector<HTMLSpanElement>('#active-agent')!;
const transcriptList = document.querySelector<HTMLUListElement>('#transcript-list')!;
const routingList = document.querySelector<HTMLUListElement>('#routing-list')!;
const agentListEl = document.querySelector<HTMLUListElement>('#agent-list')!;
const agentCountEl = document.querySelector<HTMLSpanElement>('#agent-count')!;
const toolListEl = document.querySelector<HTMLUListElement>('#tool-list')!;
const toolCountEl = document.querySelector<HTMLSpanElement>('#tool-count')!;
const resultsList = document.querySelector<HTMLUListElement>('#results-list')!;

function setStatusMessage(message: string) {
  statusSummaryEl.textContent = message;
  syncStatus.textContent = message;
}

function setActiveAgent(agent: string) {
  activeAgentEl.textContent = `Agent: ${agent}`;
}

function renderCapabilities() {
  agentListEl.innerHTML = '';
  agentCountEl.textContent = `${SPECIALIST_MANIFEST.length}`;
  agentCountEl.setAttribute('aria-label', `${SPECIALIST_MANIFEST.length} agents`);
  for (const manifest of SPECIALIST_MANIFEST) {
    const li = document.createElement('li');
    li.className = 'capability-item';

    const header = document.createElement('div');
    header.className = 'capability-item-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'capability-name';
    nameEl.textContent = manifest.name;
    header.appendChild(nameEl);

    if (manifest.id) {
      const badge = document.createElement('span');
      badge.className = 'capability-badge';
      badge.textContent = manifest.id;
      badge.title = `Agent ID: ${manifest.id}`;
      header.appendChild(badge);
    }

    const description = document.createElement('p');
    description.className = 'capability-description';
    description.textContent = manifest.description;

    li.appendChild(header);
    li.appendChild(description);

    agentListEl.appendChild(li);
  }

  const toolGroups = [
    { label: 'Email', tools: emailOpsToolset },
    { label: 'Insights', tools: insightToolset },
    { label: 'Contacts', tools: contactsToolset },
    { label: 'Calendar', tools: calendarToolset },
    { label: 'Sync', tools: syncToolset },
  ];

  const toolMap = new Map<string, { description?: string; categories: Set<string> }>();
  for (const group of toolGroups) {
    for (const toolDef of group.tools) {
      if (!toolDef?.name) continue;
      const entry = toolMap.get(toolDef.name) ?? { description: toolDef.description, categories: new Set<string>() };
      entry.categories.add(group.label);
      if (!entry.description && toolDef.description) entry.description = toolDef.description;
      toolMap.set(toolDef.name, entry);
    }
  }

  const toolEntries = Array.from(toolMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  toolListEl.innerHTML = '';
  toolCountEl.textContent = `${toolEntries.length}`;
  toolCountEl.setAttribute('aria-label', `${toolEntries.length} tools`);
  for (const [name, info] of toolEntries) {
    const li = document.createElement('li');
    li.className = 'capability-item';

    const header = document.createElement('div');
    header.className = 'capability-item-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'capability-name';
    nameEl.textContent = name;
    header.appendChild(nameEl);

    li.appendChild(header);

    if (info.description) {
      const description = document.createElement('p');
      description.className = 'capability-description';
      description.textContent = info.description;
      li.appendChild(description);
    }

    const categories = Array.from(info.categories).sort((a, b) => a.localeCompare(b));
    if (categories.length) {
      const tagContainer = document.createElement('div');
      tagContainer.className = 'capability-tags';
      for (const category of categories) {
        const tag = document.createElement('span');
        tag.className = 'capability-tag';
        tag.textContent = category;
        tagContainer.appendChild(tag);
      }
      li.appendChild(tagContainer);
    }

    toolListEl.appendChild(li);
  }
}

async function withLoading(
  button: HTMLButtonElement,
  loadingLabel: string,
  task: () => Promise<void>,
  finalLabel?: string
) {
  const original = button.dataset.originalLabel ?? button.textContent ?? '';
  button.dataset.originalLabel = original;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = loadingLabel;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = finalLabel ?? button.dataset.originalLabel ?? original;
  }
}

setStatusMessage('Not connected');
renderCapabilities();
setActiveAgent('RouterAgent');

// --- Index Stats UI ---

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



const contactsList = document.querySelector<HTMLUListElement>('#contacts-list')!;
const eventsList = document.querySelector<HTMLUListElement>('#events-list')!;
const unreadList = document.querySelector<HTMLUListElement>('#unread-list')!;
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

type DashboardListDetail = { text: string; muted?: boolean };
interface DashboardListItemOptions {
  title: string;
  dateLabel?: string;
  details?: DashboardListDetail[];
}

function createDashboardListItem(options: DashboardListItemOptions): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'dashboard-list-item';

  const header = document.createElement('div');
  header.className = 'dashboard-list-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'list-item-title';
  titleSpan.textContent = options.title;
  header.appendChild(titleSpan);

  if (options.dateLabel) {
    const dateSpan = document.createElement('span');
    dateSpan.className = 'list-item-date';
    dateSpan.textContent = options.dateLabel;
    header.appendChild(dateSpan);
  }

  li.appendChild(header);

  if (Array.isArray(options.details)) {
    for (const detail of options.details) {
      if (!detail?.text) continue;
      const detailLine = document.createElement('div');
      detailLine.className = `list-item-detail${detail.muted ? ' muted' : ''}`;
      detailLine.textContent = detail.text;
      li.appendChild(detailLine);
    }
  }

  return li;
}

function truncateText(value: string, max = 140): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > max ? `${collapsed.slice(0, Math.max(0, max - 3))}...` : collapsed;
}

function parseDateInput(source: any): Date | null {
  if (!source) return null;
  if (source instanceof Date) {
    return Number.isNaN(source.getTime()) ? null : source;
  }
  if (typeof source === 'number') {
    const ms = source > 1e12 ? source : source > 1e9 ? source * 1000 : source;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return parseDateInput(numeric);
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof source === 'object') {
    if (Array.isArray(source)) {
      for (const entry of source) {
        const parsed = parseDateInput(entry);
        if (parsed) return parsed;
      }
      return null;
    }
    const candidates = [
      (source as any).date,
      (source as any).date_time,
      (source as any).datetime,
      (source as any).time,
      (source as any).timestamp,
      (source as any).start,
      (source as any).value,
    ];
    for (const candidate of candidates) {
      if (!candidate || candidate === source) continue;
      const parsed = parseDateInput(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

function formatListDate(date: Date | null, includeTime: boolean, fallback = '—'): string {
  if (!date) return fallback;
  const options: Intl.DateTimeFormatOptions = includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return fallback;
  }
}

function extractEventDateInfo(event: any): { date: Date | null; hasTime: boolean } {
  const when = event?.when ?? {};
  const candidates: Array<{ value: any; timed: boolean }> = [
    { value: when.start_time ?? when.startTime, timed: true },
    { value: when.start_date ?? when.startDate, timed: false },
    { value: when.start?.date_time ?? when.start?.datetime ?? when.start?.time, timed: true },
    { value: when.start?.date, timed: false },
    { value: event?.start_time ?? event?.startTime, timed: true },
    { value: event?.start?.date_time ?? event?.start?.datetime ?? event?.start?.time, timed: true },
    { value: event?.start?.date, timed: false },
    { value: event?.start ?? event?.startAt, timed: true },
    { value: event?.date, timed: false },
  ];
  for (const candidate of candidates) {
    const date = parseDateInput(candidate.value);
    if (date) return { date, hasTime: candidate.timed };
  }
  return { date: null, hasTime: false };
}

function extractEventLocation(event: any): string {
  if (!event) return '';
  const direct = typeof event.location === 'string' ? event.location.trim() : '';
  if (direct) return direct;
  const place = event.place ?? event.location;
  if (place && typeof place === 'object') {
    const display = place.display_name ?? place.name ?? place.address;
    if (typeof display === 'string' && display.trim()) return display.trim();
    const loc = place.location;
    if (loc && typeof loc === 'object') {
      const parts = [loc.city, loc.state || loc.region, loc.country]
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean);
      if (parts.length) return parts.join(', ');
    }
  }
  const conferencing = event.conference ?? event.conferencing;
  if (Array.isArray(conferencing) && conferencing.length) {
    const first = conferencing[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') {
      const url = first.url ?? first.join_url ?? first.joinUrl;
      if (typeof url === 'string') return url.trim();
    }
  }
  const hangout = event.hangoutLink ?? event.hangout_link ?? event.meeting_url ?? event.meetingUrl;
  if (typeof hangout === 'string') return hangout.trim();
  return '';
}

function extractMessageDate(message: any): Date | null {
  if (!message) return null;
  const candidates = [
    message.received_at_iso ?? message.receivedAtIso,
    message.received_at ?? message.receivedAt,
    message.date,
    message.created_at ?? message.createdAt,
    message.sent_at ?? message.sentAt,
    message.internalDate,
    message.raw?.received_at,
    message.raw?.receivedAt,
    message.raw?.date,
    message.raw?.timestamp,
  ];
  for (const candidate of candidates) {
    const parsed = parseDateInput(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function resolveMessageSender(message: any): string {
  const fromField = message?.from;
  if (typeof fromField === 'string') return fromField.trim();
  if (Array.isArray(fromField) && fromField.length) {
    const first = fromField[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') {
      const display = first.display ?? first.name ?? first.email ?? first.address;
      if (display) {
        const candidate = String(display).trim();
        if (candidate) return candidate;
      }
      if (first.name && first.email) return `${first.name} <${first.email}>`.trim();
    }
  }
  if (fromField && typeof fromField === 'object') {
    const display = fromField.display ?? fromField.name ?? fromField.email;
    if (display) {
      const trimmedDisplay = String(display).trim();
      if (trimmedDisplay) {
        if (fromField.email && fromField.name && String(fromField.name).trim() && String(fromField.name).trim() !== trimmedDisplay) {
          return `${fromField.name} <${fromField.email}>`.trim();
        }
        return trimmedDisplay;
      }
    }
  }
  const rawFrom = message?.raw?.from;
  if (typeof rawFrom === 'string') return rawFrom.trim();
  if (Array.isArray(rawFrom) && rawFrom.length) {
    const primary = rawFrom[0];
    if (typeof primary === 'string') return primary.trim();
    if (primary && typeof primary === 'object') {
      const display = primary.display ?? primary.name ?? primary.email ?? primary.address;
      if (display) return String(display).trim();
    }
  }
  return '';
}

function renderContactsList(items: any[]): number {
  const data = Array.isArray(items) ? items : [];
  contactsList.innerHTML = '';
  const count = data.length;

  if (!count) {
    contactsList.appendChild(
      createDashboardListItem({
        title: 'No contacts found',
        details: [{ text: 'Refresh cached lists to pull recent contact data.', muted: true }],
      })
    );
    return 0;
  }

  for (const c of data.slice(0, 5)) {
    const name = typeof c?.name === 'string' ? c.name.trim() : (typeof c?.display_name === 'string' ? c.display_name.trim() : '');
    const emails = Array.isArray(c?.emails)
      ? c.emails
          .map((e: any) => {
            if (!e) return '';
            if (typeof e === 'string') return e.trim();
            const email = typeof e?.email === 'string' ? e.email.trim() : '';
            const type = typeof e?.type === 'string' ? e.type.trim() : '';
            return type ? `${email} (${type})` : email;
          })
          .filter(Boolean)
          .join(', ')
      : (typeof c?.email === 'string' ? c.email.trim() : '');

    const title = name || emails || (typeof c?.id === 'string' ? c.id : 'contact');
    const details: DashboardListDetail[] = [];
    if (emails && emails !== title) {
      details.push({ text: emails, muted: true });
    }

    contactsList.appendChild(createDashboardListItem({ title, details }));
  }

  return count;
}

function renderEventsList(items: any[]): number {
  const data = Array.isArray(items) ? items : [];
  eventsList.innerHTML = '';
  const count = data.length;

  if (!count) {
    eventsList.appendChild(
      createDashboardListItem({
        title: 'No upcoming events',
        details: [{ text: 'Try syncing your calendar or refreshing cached lists.', muted: true }],
      })
    );
    return 0;
  }

  for (const ev of data.slice(0, 5)) {
    const rawTitle = typeof ev?.title === 'string'
      ? ev.title
      : typeof ev?.summary === 'string'
        ? ev.summary
        : typeof ev?.subject === 'string'
          ? ev.subject
          : typeof ev?.id === 'string'
            ? ev.id
            : '';
    const title = truncateText(rawTitle || 'event', 100) || 'event';

    const { date, hasTime } = extractEventDateInfo(ev);
    const dateLabel = formatListDate(date, hasTime, 'Date TBD');
    const location = extractEventLocation(ev);

    const organizerSource =
      typeof ev?.organizer === 'string'
        ? ev.organizer
        : ev?.organizer?.name ?? ev?.organizer?.email ?? ev?.organizer_email ?? ev?.organizerName;
    const organizer = typeof organizerSource === 'string' ? organizerSource.trim() : '';

    const details: DashboardListDetail[] = [];
    if (location) details.push({ text: truncateText(location, 120) });
    if (organizer) details.push({ text: `Organizer: ${organizer}`, muted: true });

    eventsList.appendChild(
      createDashboardListItem({
        title,
        dateLabel,
        details,
      })
    );
  }

  return count;
}

function renderUnreadList(items: any[]): number {
  const data = Array.isArray(items) ? items : [];
  unreadList.innerHTML = '';
  const count = data.length;

  if (!count) {
    unreadList.appendChild(
      createDashboardListItem({
        title: 'No unread messages',
        details: [{ text: 'All caught up! New mail will appear here.', muted: true }],
      })
    );
    return 0;
  }

  for (const m of data.slice(0, 5)) {
    const subject = typeof m?.subject === 'string' && m.subject.trim()
      ? m.subject
      : typeof m?.snippet === 'string' && m.snippet.trim()
        ? m.snippet
        : typeof m?.id === 'string'
          ? m.id
          : 'message';

    const collapsedSubject = truncateText(subject, 100) || 'message';
    const messageDate = extractMessageDate(m);
    const dateLabel = formatListDate(messageDate, true, '—');
    const sender = resolveMessageSender(m);
    const snippet = typeof m?.snippet === 'string' ? truncateText(m.snippet, 120) : '';

    const details: DashboardListDetail[] = [];
    if (sender) details.push({ text: sender });
    if (snippet && snippet !== collapsedSubject) details.push({ text: snippet, muted: true });

    unreadList.appendChild(
      createDashboardListItem({
        title: collapsedSubject,
        dateLabel,
        details,
      })
    );
  }

  return count;
}

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

function appendRouterUpdate(message: string) {
  const li = document.createElement('li');
  li.className = 'routing-entry';
  li.innerHTML = `<span class="router-time">${new Date().toLocaleTimeString()}</span><span class="router-text">${message}</span>`;
  routingList.appendChild(li);
  while (routingList.childElementCount > 50) {
    const first = routingList.firstElementChild;
    if (first) routingList.removeChild(first);
    else break;
  }
  const scroller = routingList.parentElement as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
}

function appendToolUpdate(text: string) {
  const li = document.createElement('li');
  li.innerHTML = `<em style="color:#555;">[tool] ${text}</em>`;
  transcriptList.appendChild(li);
  const scroller = transcriptList.parentElement as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
}

setRouterProgressHandler((text: string) => {
  appendRouterUpdate(text);

  const match = text.match(/^\[(.+?)\]\s*(.*)$/);
  if (!match) return;

  const agentName = match[1].trim();
  const details = match[2] ?? '';

  const delegateMatch = details.match(/Delegating to\s+(.+?)(?:[.?!]|$)/i);
  if (delegateMatch) {
    setActiveAgent(delegateMatch[1].trim());
    return;
  }

  if (/Completed|complete|finished|returned/i.test(details) && agentName !== 'RouterAgent') {
    setActiveAgent('RouterAgent');
    return;
  }

  if (agentName) {
    setActiveAgent(agentName);
  }
});

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
    const statusLabel = call.error ? 'ERR' : 'OK';

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
        <span class="tool-status ${statusClass}">${statusLabel}</span>
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
  emailMetricsDiv.classList.remove('hidden');
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
  const count = renderContactsList(items);
  appendToolUpdate(`list_contacts returned ${count} item(s)`);
});

setEventsHandler((payload: any) => {
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.events) ? payload.events : []);
  const count = renderEventsList(items);
  appendToolUpdate(`list_events returned ${count} item(s)`);
});

setUnreadHandler((payload: any) => {
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.messages) ? payload.messages : []);
  const count = renderUnreadList(items);
  appendToolUpdate(`list_unread_messages returned ${count} item(s)`);
});

setSyncStatusHandler((payload: any) => {
  const queued = payload?.queued ?? 0;
  setStatusMessage(`Sync queued: ${queued}`);
  appendToolUpdate(`sync_start queued ${queued} email(s)`);
});

startSyncBtn.addEventListener('click', async () => {
  await withLoading(startSyncBtn, 'Starting...', async () => {
    try {
      const res = await fetch('http://localhost:8787/sync/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceEpoch: Math.floor(Date.now() / 1000), limit: 25 }),
      });
      const data = await res.json();
      setStatusMessage(`Sync queued: ${data?.queued ?? 0}`);
      appendToolUpdate(`sync_start queued ${data?.queued ?? 0} email(s)`);
    } catch (e) {
      console.error(e);
      setStatusMessage('Sync failed - see console');
    }
  }, 'Initial Backfill (10k emails)');
});

// Manual Delta Sync button
const deltaSyncBtn2 = deltaSyncBtn; // alias for clarity

deltaSyncBtn2.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  if (!grantId) {
    appendToolUpdate('delta_start skipped - enter grantId first');
    return;
  }
  localStorage.setItem('nylasGrantId', grantId);

  await withLoading(deltaSyncBtn2, 'Enqueuing...', async () => {
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/api/sync/delta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantId }),
      });
      const data = await res.json();
      setStatusMessage(`Delta enqueued for ${grantId}: sinceEpoch=${data?.sinceEpoch ?? 'n/a'}`);
      appendToolUpdate(`delta_start enqueued for grant ${grantId}`);
      void refreshJobsHistory();
    } catch (e) {
      console.error(e);
      setStatusMessage('Delta sync failed - see console');
    }
  }, 'Run Delta Sync Now');
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
      const count = renderContactsList(items);
      console.log(`[init] Loaded ${count} contacts`);
    } else {
      console.warn('[init] Failed to load contacts:', await contactsRes.text());
    }

    // Fetch events
    const eventsRes = await fetch(`${API_BASE}/nylas/events?${params}`);
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      const items = Array.isArray(eventsData?.data) ? eventsData.data : (Array.isArray(eventsData?.events) ? eventsData.events : []);
      const count = renderEventsList(items);
      console.log(`[init] Loaded ${count} events`);
    } else {
      console.warn('[init] Failed to load events:', await eventsRes.text());
    }

    // Fetch unread messages
    const unreadRes = await fetch(`${API_BASE}/nylas/unread?${params}`);
    if (unreadRes.ok) {
      const unreadData = await unreadRes.json();
      const normalized = Array.isArray(unreadData?.messages) ? unreadData.messages : (Array.isArray(unreadData?.data) ? unreadData.data : []);
      const count = renderUnreadList(normalized);
      const totalUnread = typeof unreadData?.total === 'number' ? unreadData.total : count;
      console.log(`[init] Loaded ${totalUnread} unread messages`);
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
  await withLoading(refreshNylasBtn, 'Refreshing...', async () => {
    await initializeNylasData();
  }, 'Refresh Cached Lists');
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
    const msg = j?.message ? ` - ${j.message}` : '';
    li.innerHTML = `<strong>${created}</strong> - ${j?.status || 'running'}: ${processed} msgs, ${iv} vectors${msg}`;
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
      const pct = job?.percent ?? null;
      const status = job?.status || 'running';
      const proc = job?.processed ?? 0;
      const tot = (job?.total ?? null);
      const pctStr = pct === null ? '' : ` (${pct}%)`;
      const totalStr = tot === null || tot === undefined ? '' : `/${tot}`;
      setStatusMessage(`Sync status: ${status} \u2014 ${proc}${totalStr}${pctStr}`);
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
    setStatusMessage('Provide both Nylas API key and Grant ID to save credentials.');
    return;
  }
  // Save grantId locally for convenience
  localStorage.setItem('nylasGrantId', grantId);
  await withLoading(updateCtxBtn, 'Saving...', async () => {
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/api/user/update-context`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nylasApiKey: apiKey, grantId })
      });
      const data = await res.json();
      if (res.ok && data?.jobId) {
        appendToolUpdate(`update-context accepted: job ${data.jobId}`);
        setStatusMessage(`Sync queued for ${grantId} \u2014 job ${data.jobId}`);
        startProgressPolling(data.jobId);
        void refreshJobsHistory();
      } else {
        appendToolUpdate(`update-context failed: ${data?.error || 'unknown error'}`);
        setStatusMessage(`Update failed \u2014 ${data?.error || 'see console'}`);
      }
    } catch (e) {
      console.error(e);
      setStatusMessage('Update failed \u2014 see console');
    }
  }, 'Save Nylas Credentials');
});

deleteDataBtn.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  if (!grantId) {
    appendToolUpdate('delete skipped \u2014 enter grantId first');
    return;
  }
  const confirmDelete = window.confirm(`Delete ALL data for grant ${grantId}? This cannot be undone.`);
  if (!confirmDelete) return;
  await withLoading(deleteDataBtn, 'Deleting...', async () => {
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/api/user/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grantId })
      });
      const data = await res.json();
      if (res.ok) {
        appendToolUpdate(`delete ok \u2014 pinecone: ${data?.pinecone || 'n/a'}`);
        setStatusMessage(`Deleted data for ${grantId}`);
      } else {
        appendToolUpdate(`delete failed: ${data?.error || 'unknown'}`);
        setStatusMessage(`Delete failed \u2014 ${data?.error || 'see console'}`);
      }
    } catch (e) {
      console.error(e);
      setStatusMessage('Delete failed \u2014 see console');
    }
  }, 'Delete All Data');
});


// Load Nylas data on startup
initializeNylasData();
void refreshJobsHistory();
setInterval(refreshJobsHistory, 60000);


connectBtn.addEventListener('click', async () => {
  if (connectBtn.classList.contains('is-connected')) return;
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  try {
    session = await createVoiceSession();
    connectBtn.textContent = 'Connected';
    connectBtn.classList.add('is-connected');
    setStatusMessage('Voice agent connected. You can start speaking.');
    quickConnectBtn.disabled = true;
    quickConnectBtn.textContent = 'Connected';
    void session;

  } catch (e) {
    console.error(e);
    connectBtn.textContent = 'Retry Connect';
    connectBtn.disabled = false;
    setStatusMessage('Connection failed - check console logs.');
  }
});

quickConnectBtn.addEventListener('click', () => {
  if (!connectBtn.classList.contains('is-connected')) {
    connectBtn.click();
  }
});

quickBackfillBtn.addEventListener('click', () => {
  startSyncBtn.click();
});

quickDeltaBtn.addEventListener('click', () => {
  deltaSyncBtn.click();
});
