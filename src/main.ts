import './style.css';
import typescriptLogo from './typescript.svg';
import viteLogo from '/vite.svg';
import { createVoiceSession, setTranscriptHandler } from './lib/voiceAgent';
import { setSearchResultsHandler, setSyncStatusHandler, setToolProgressHandler, setEmailMetricsHandler, setToolCallHandler, addToolCallListener, type ToolCallRecord } from './lib/tools';
import { ROUTER_AGENT_ID, EMAIL_AGENT_ID, INSIGHT_AGENT_ID, CONTACTS_AGENT_ID, CALENDAR_AGENT_ID, AUTOMATION_AGENT_ID } from './lib/agents';
import { supportsEmailAnalytics, supportsEmailCounting } from './lib/featureFlags';

let session: unknown;
const toolCallHistory: ToolCallRecord[] = [];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-container">
    <!-- Sidebar -->
    <aside class="sidebar">
      <!-- Nylas Integration Panel -->
      <div id="nylas" class="sidebar-panel nylas-panel">
        <h3>Sync & Data</h3>

        <div class="nylas-controls">
          <div class="control-row">
            <input id="grant-id" type="text" placeholder="Grant ID" />
          </div>
          <div class="control-row">
            <input id="api-key" type="password" placeholder="API Key" />
          </div>
          <div class="control-row">
            <button id="delta-sync" type="button">Sync</button>
          </div>
          <div id="sync-status" class="sync-status"></div>
        </div>
      </div>

      <!-- Tools & Agents Panel -->
      <div id="tools-agents-panel" class="sidebar-panel">
        <h3>Tools & Agents</h3>

        <!-- Agents & Tools Section -->
        <div class="agents-section">
          <h4>Agents & Tools</h4>
          <div id="agents-list" class="agents-tools-list"></div>
        </div>
      </div>

      <!-- Dashboard Widgets Panel -->
      <div id="dashboard-widgets-panel" class="sidebar-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0;">Dashboard</h3>
          <button id="refresh-dashboard" type="button" style="padding: 4px 8px; font-size: 0.8em;">🔄 Refresh</button>
        </div>

        <!-- Recent Messages -->
        <div class="dashboard-widget">
          <h4>📧 Recent Messages</h4>
          <ul id="recent-messages-list" class="list-reset scrollable-list dashboard-list"></ul>
        </div>

        <!-- Recent Contacts -->
        <div class="dashboard-widget">
          <h4>👥 Recent Contacts</h4>
          <ul id="recent-contacts-list" class="list-reset scrollable-list dashboard-list"></ul>
        </div>

        <!-- Upcoming Events -->
        <div class="dashboard-widget">
          <h4>📅 Upcoming Events</h4>
          <ul id="upcoming-events-list" class="list-reset scrollable-list dashboard-list"></ul>
        </div>
      </div>

    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <div class="header">
        <button id="toggle-sidebar" class="sidebar-toggle" title="Toggle sidebar">☰</button>
        <div class="header-content">
          <a href="https://vite.dev" target="_blank">
            <img src="${viteLogo}" class="logo" alt="Vite logo" />
          </a>
          <a href="https://www.typescriptlang.org/" target="_blank">
            <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
          </a>
          <h1>Voice Agent</h1>
          <div class="card">
            <button id="connect" type="button">Connect Voice Agent</button>
          </div>
        </div>
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

      <p class="read-the-docs">
        Grant microphone access when prompted. Speak after connecting.
      </p>
    </main>
  </div>
`;

const transcriptList = document.querySelector<HTMLUListElement>('#transcript-list')!;
const resultsList = document.querySelector<HTMLUListElement>('#results-list')!;

const syncStatus = document.querySelector<HTMLDivElement>('#sync-status')!;
const deltaSyncBtn = document.querySelector<HTMLButtonElement>('#delta-sync')!;
const grantInput = document.querySelector<HTMLInputElement>('#grant-id')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;

const emailMetricsDiv = document.querySelector<HTMLDivElement>('#email-metrics')!;
const totalEmailsSpan = document.querySelector<HTMLSpanElement>('#total-emails')!;
const emailResultsList = document.querySelector<HTMLUListElement>('#email-results-list')!;

const agentsList = document.querySelector<HTMLDivElement>('#agents-list')!;

const FUNCTIONS_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';

// Sidebar toggle
const toggleSidebarBtn = document.querySelector<HTMLButtonElement>('#toggle-sidebar')!;
const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
let sidebarOpen = true;

toggleSidebarBtn.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('collapsed', !sidebarOpen);
  toggleSidebarBtn.textContent = sidebarOpen ? '☰' : '☶';
  localStorage.setItem('sidebarOpen', String(sidebarOpen));
});

// Restore sidebar state
const savedSidebarState = localStorage.getItem('sidebarOpen');
if (savedSidebarState === 'false') {
  sidebarOpen = false;
  sidebar.classList.add('collapsed');
  toggleSidebarBtn.textContent = '☶';
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



setSyncStatusHandler((payload: any) => {
  const queued = payload?.queued ?? 0;
  syncStatus.textContent = `Sync queued: ${queued}`;
  appendToolUpdate(`sync_start queued ${queued} email(s)`);
});

// Delta Sync button
deltaSyncBtn.addEventListener('click', async () => {
  const grantId = (grantInput?.value || '').trim();
  const apiKey = (apiKeyInput?.value || '').trim();

  if (!grantId || !apiKey) {
    syncStatus.textContent = 'Enter Grant ID and API Key';
    return;
  }

  try {
    deltaSyncBtn.disabled = true;
    deltaSyncBtn.textContent = 'Syncing...';
    localStorage.setItem('nylasGrantId', grantId);
    localStorage.setItem('nylasApiKey', apiKey);

    const res = await fetch(`${FUNCTIONS_BASE}/api/sync/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId, apiKey }),
    });
    await res.json();
    syncStatus.textContent = `✓ Sync enqueued`;
    appendToolUpdate(`delta_start enqueued for grant ${grantId}`);
  } catch (e) {
    console.error(e);
    syncStatus.textContent = '✗ Sync failed';
  } finally {
    deltaSyncBtn.disabled = false;
    deltaSyncBtn.textContent = 'Sync';
  }
});




// Initialize Nylas data on app load
async function initializeNylasData() {
  try {
    const storedGrantId = localStorage.getItem('nylasGrantId');
    const storedApiKey = localStorage.getItem('nylasApiKey');

    if (storedGrantId) {
      grantInput.value = storedGrantId;
      console.log(`[init] Loaded grantId from localStorage`);
    }

    if (storedApiKey) {
      apiKeyInput.value = storedApiKey;
      console.log(`[init] Loaded apiKey from localStorage`);
    }

    // Load dashboard data if grant ID is available
    if (storedGrantId) {
      await loadDashboardData(storedGrantId);
    }
  } catch (e) {
    console.error('[init] Failed to initialize Nylas:', e);
  }
}

// Load dashboard data (recent messages, contacts, events)
async function loadDashboardData(grantId: string) {
  console.log('[dashboard] Loading dashboard data for grantId:', grantId);

  try {
    // Fetch recent messages
    console.log('[dashboard] Fetching recent messages...');
    const messagesRes = await fetch(`${FUNCTIONS_BASE}/api/nylas/unread?limit=5&grantId=${grantId}`);
    console.log('[dashboard] Messages response status:', messagesRes.status);
    if (messagesRes.ok) {
      const messagesData = await messagesRes.json();
      console.log('[dashboard] Messages data:', messagesData);
      displayRecentMessages(messagesData?.data || []);
    } else {
      const errorText = await messagesRes.text();
      console.error('[dashboard] Messages error:', messagesRes.status, errorText);
      displayRecentMessages([]);
    }
  } catch (e) {
    console.error('[dashboard] Failed to load recent messages:', e);
    displayRecentMessages([]);
  }

  try {
    // Fetch recent contacts
    console.log('[dashboard] Fetching recent contacts...');
    const contactsRes = await fetch(`${FUNCTIONS_BASE}/api/nylas/contacts?limit=5&grantId=${grantId}`);
    console.log('[dashboard] Contacts response status:', contactsRes.status);
    if (contactsRes.ok) {
      const contactsData = await contactsRes.json();
      console.log('[dashboard] Contacts data:', contactsData);
      displayRecentContacts(contactsData?.data || []);
    } else {
      const errorText = await contactsRes.text();
      console.error('[dashboard] Contacts error:', contactsRes.status, errorText);
      displayRecentContacts([]);
    }
  } catch (e) {
    console.error('[dashboard] Failed to load recent contacts:', e);
    displayRecentContacts([]);
  }

  try {
    // Fetch upcoming events
    console.log('[dashboard] Fetching upcoming events...');
    const eventsRes = await fetch(`${FUNCTIONS_BASE}/api/nylas/events?limit=5&grantId=${grantId}`);
    console.log('[dashboard] Events response status:', eventsRes.status);
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      console.log('[dashboard] Events data:', eventsData);
      displayUpcomingEvents(eventsData?.data || []);
    } else {
      const errorText = await eventsRes.text();
      console.error('[dashboard] Events error:', eventsRes.status, errorText);
      displayUpcomingEvents([]);
    }
  } catch (e) {
    console.error('[dashboard] Failed to load upcoming events:', e);
    displayUpcomingEvents([]);
  }
}

// Display recent messages
function displayRecentMessages(messages: any[]) {
  const messagesList = document.querySelector<HTMLUListElement>('#recent-messages-list')!;
  messagesList.innerHTML = '';

  if (messages.length === 0) {
    messagesList.innerHTML = '<li class="empty-state">No recent messages</li>';
    return;
  }

  messages.forEach((msg: any) => {
    const li = document.createElement('li');
    li.className = 'dashboard-item';
    const from = msg.from?.[0]?.name || msg.from?.[0]?.email || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.date ? new Date(msg.date * 1000).toLocaleDateString() : '';
    li.innerHTML = `
      <div class="dashboard-item-header">
        <strong>${from}</strong>
        <span class="dashboard-item-date">${date}</span>
      </div>
      <div class="dashboard-item-body">${subject}</div>
    `;
    messagesList.appendChild(li);
  });
}

// Display recent contacts
function displayRecentContacts(contacts: any[]) {
  const contactsList = document.querySelector<HTMLUListElement>('#recent-contacts-list')!;
  contactsList.innerHTML = '';

  if (contacts.length === 0) {
    contactsList.innerHTML = '<li class="empty-state">No recent contacts</li>';
    return;
  }

  contacts.forEach((contact: any) => {
    const li = document.createElement('li');
    li.className = 'dashboard-item';
    const name = contact.given_name || contact.surname
      ? `${contact.given_name || ''} ${contact.surname || ''}`.trim()
      : 'Unknown';
    const email = contact.emails?.[0]?.email || '';
    li.innerHTML = `
      <div class="dashboard-item-header">
        <strong>${name}</strong>
      </div>
      <div class="dashboard-item-body">${email}</div>
    `;
    contactsList.appendChild(li);
  });
}

// Display upcoming events
function displayUpcomingEvents(events: any[]) {
  const eventsList = document.querySelector<HTMLUListElement>('#upcoming-events-list')!;
  eventsList.innerHTML = '';

  if (events.length === 0) {
    eventsList.innerHTML = '<li class="empty-state">No upcoming events</li>';
    return;
  }

  events.forEach((event: any) => {
    const li = document.createElement('li');
    li.className = 'dashboard-item';
    const title = event.title || '(no title)';
    const when = event.when?.start_time
      ? new Date(event.when.start_time * 1000).toLocaleString()
      : '';
    li.innerHTML = `
      <div class="dashboard-item-header">
        <strong>${title}</strong>
      </div>
      <div class="dashboard-item-body">${when}</div>
    `;
    eventsList.appendChild(li);
  });
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
});

// Load Nylas data on startup
initializeNylasData();

// Dashboard refresh button
const refreshDashboardBtn = document.querySelector<HTMLButtonElement>('#refresh-dashboard')!;
refreshDashboardBtn.addEventListener('click', async () => {
  const grantId = localStorage.getItem('nylasGrantId');
  if (!grantId) {
    alert('Please enter a Grant ID first');
    return;
  }

  refreshDashboardBtn.disabled = true;
  refreshDashboardBtn.textContent = '🔄 Loading...';

  try {
    await loadDashboardData(grantId);
    refreshDashboardBtn.textContent = '✓ Refreshed';
    setTimeout(() => {
      refreshDashboardBtn.textContent = '🔄 Refresh';
    }, 2000);
  } catch (e) {
    console.error('[dashboard] Refresh failed:', e);
    refreshDashboardBtn.textContent = '✗ Failed';
    setTimeout(() => {
      refreshDashboardBtn.textContent = '🔄 Refresh';
    }, 2000);
  } finally {
    refreshDashboardBtn.disabled = false;
  }
});

// ========== Tools & Agents Panel ==========

// Agent metadata
const AGENT_METADATA = {
  [ROUTER_AGENT_ID]: { name: 'Router', icon: '🎯', description: 'Routes requests to specialists' },
  [EMAIL_AGENT_ID]: { name: 'Email Ops', icon: '📧', description: 'Email search & operations' },
  [INSIGHT_AGENT_ID]: { name: 'Insights', icon: '📊', description: 'Analytics & aggregations' },
  [CONTACTS_AGENT_ID]: { name: 'Contacts', icon: '👥', description: 'Contact management' },
  [CALENDAR_AGENT_ID]: { name: 'Calendar', icon: '📅', description: 'Event scheduling' },
  [AUTOMATION_AGENT_ID]: { name: 'Automation', icon: '⚙️', description: 'Workflow automation' },
};

// Tools mapped to agents
const emailAgentTools = [
  { name: 'search_emails', description: 'Hybrid search over emails', icon: '🔍' },
  { name: 'triage_recent_emails', description: 'Prioritize urgent messages', icon: '🎯' },
  { name: 'list_recent_emails', description: 'Fetch recent emails with MapReduce', icon: '📬' },
  { name: 'list_unread_messages', description: 'List unread messages', icon: '📨' },
];
if (supportsEmailCounting) {
  emailAgentTools.push({ name: 'count_emails', description: 'Count total indexed emails', icon: '🔢' });
}

const insightAgentTools = [
  { name: 'aggregate_emails', description: 'Group & count by metadata', icon: '📊' },
];
if (supportsEmailAnalytics) {
  insightAgentTools.push({ name: 'analyze_emails', description: 'Summarize search results', icon: '📝' });
} else {
  insightAgentTools.push({
    name: 'search_emails',
    description: 'Hybrid search (fallback while analyze_emails is offline)',
    icon: '🔍',
  });
}
if (supportsEmailCounting) {
  insightAgentTools.push({ name: 'count_emails', description: 'Count total indexed emails', icon: '🔢' });
}

const AGENT_TOOLS = {
  [ROUTER_AGENT_ID]: [],
  [EMAIL_AGENT_ID]: emailAgentTools,
  [INSIGHT_AGENT_ID]: insightAgentTools,
  [CONTACTS_AGENT_ID]: [
    { name: 'list_contacts', description: 'List recent contacts', icon: '👥' },
  ],
  [CALENDAR_AGENT_ID]: [
    { name: 'list_events', description: 'List calendar events', icon: '📅' },
  ],
  [AUTOMATION_AGENT_ID]: [
    { name: 'sync_start', description: 'Start unread sync', icon: '🔄' },
    { name: 'backfill_start', description: 'Historical email backfill', icon: '⏮️' },
  ],
};
// Agent activity tracking
const agentActivity = new Map<string, { lastActive: number; callCount: number }>();
let isConversationActive = false;

function initializeToolsAndAgentsPanel() {
  // Render agents with nested tools
  renderAgentsWithTools();

  // Set up tool activity listener - this fires during live conversations
  addToolCallListener((record) => {
    updateAgentActivity(record);
    // Force immediate agent re-render during active conversation
    if (isConversationActive) {
      renderAgentsWithTools();
    }
  });

  // Update agents display every 2 seconds (or more frequently during conversation)
  setInterval(() => {
    renderAgentsWithTools();
  }, isConversationActive ? 500 : 2000);
}

function renderAgentsWithTools() {
  agentsList.innerHTML = '';

  for (const [agentId, metadata] of Object.entries(AGENT_METADATA)) {
    const activity = agentActivity.get(agentId);
    const activeThreshold = isConversationActive ? 3000 : 5000;
    const isActive = activity && (Date.now() - activity.lastActive < activeThreshold);

    // Create agent container
    const agentContainer = document.createElement('div');
    agentContainer.className = `agent-container ${isActive ? 'active' : ''}`;

    // Agent card
    const agentCard = document.createElement('div');
    agentCard.className = 'agent-card';

    const statsHtml = activity
      ? `<div class="agent-stats">${activity.callCount} call${activity.callCount !== 1 ? 's' : ''}</div>`
      : '';

    const timeAgoMs = activity ? Date.now() - activity.lastActive : null;
    const timeAgoHtml = timeAgoMs !== null && isConversationActive
      ? `<div class="agent-time-ago">${timeAgoMs < 1000 ? 'now' : Math.round(timeAgoMs / 1000) + 's ago'}</div>`
      : '';

    agentCard.innerHTML = `
      <div class="agent-icon">${metadata.icon}</div>
      <div class="agent-info">
        <div class="agent-name">${metadata.name}</div>
        <div class="agent-description">${metadata.description}</div>
        ${statsHtml}
        ${timeAgoHtml}
      </div>
      ${isActive ? '<div class="agent-status-indicator"></div>' : ''}
    `;
    agentContainer.appendChild(agentCard);

    // Tools for this agent
    const tools = (AGENT_TOOLS as any)[agentId] || [];
    if (tools.length > 0) {
      const toolsList = document.createElement('ul');
      toolsList.className = 'agent-tools-list';

      for (const tool of tools) {
        const toolItem = document.createElement('li');
        toolItem.className = 'agent-tool-item';
        toolItem.innerHTML = `
          <span class="tool-icon">${tool.icon}</span>
          <div class="tool-info">
            <div class="tool-name">${tool.name}</div>
            <div class="tool-description">${tool.description}</div>
          </div>
        `;
        toolsList.appendChild(toolItem);
      }

      agentContainer.appendChild(toolsList);
    }

    agentsList.appendChild(agentContainer);
  }
}

function updateAgentActivity(record: ToolCallRecord) {
  if (!record.agentId) return;

  const current = agentActivity.get(record.agentId) || { lastActive: 0, callCount: 0 };
  agentActivity.set(record.agentId, {
    lastActive: Date.now(),
    callCount: current.callCount + 1,
  });
}

// Removed updateToolActivity function - Recent Activity section has been removed

// Initialize the panel
initializeToolsAndAgentsPanel();

document.querySelector<HTMLButtonElement>('#connect')!.addEventListener('click', async () => {
  const btn = document.querySelector<HTMLButtonElement>('#connect')!;
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  try {
    session = await createVoiceSession();
    btn.textContent = 'Connected ✓';
    isConversationActive = true;

    // Add visual indicator to panel during active conversation
    const panel = document.querySelector<HTMLDivElement>('#tools-agents-panel');
    if (panel) {
      panel.classList.add('conversation-active');
    }

    void session;

  } catch (e) {
    console.error(e);
    btn.textContent = 'Failed — check console';
    btn.disabled = false;
    isConversationActive = false;
  }
});

// Initialize Nylas data on page load
initializeNylasData();

// Auto-refresh dashboard data every 5 minutes
setInterval(() => {
  const grantId = localStorage.getItem('nylasGrantId');
  if (grantId) {
    loadDashboardData(grantId);
  }
}, 5 * 60 * 1000);
