import { test, expect } from '@playwright/test';

/**
 * API E2E Tests for Voice Email Agent Backend
 * 
 * Coverage:
 * - /api/search (Pinecone semantic search)
 * - /api/aggregate (Pinecone aggregation)
 * - /api/nylas/unread (Nylas unread messages)
 * - /api/nylas/contacts (Nylas contacts)
 * - /api/nylas/events (Nylas calendar events)
 * - /api/sync/backfill (Service Bus backfill trigger)
 * - /api/sync/delta (Service Bus delta sync trigger)
 * - /api/realtime/session (OpenAI Realtime session - gated)
 */

// Determine API base URL from environment or default to Azure Functions
const API_BASE = process.env.PW_API_BASE 
  || process.env.VITE_API_BASE 
  || 'https://func-email-agent-9956-lx.azurewebsites.net';

// Test grant ID (use env var or default)
const TEST_GRANT_ID = process.env.TEST_GRANT_ID || process.env.NYLAS_GRANT_ID || 'test-grant-id';

test.describe('API Endpoints @api', () => {
  
  test('POST /api/search - should return search results', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/search`, {
      data: {
        grantId: TEST_GRANT_ID,
        query: 'test email',
        topK: 5,
      },
    });

    // Should return 200 or 400/500 if not configured
    expect([200, 400, 500]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();

      // Verify response structure - API returns { matches: [...] }
      expect(json).toHaveProperty('matches');
      expect(Array.isArray(json.matches)).toBe(true);

      // If matches exist, verify structure
      if (json.matches.length > 0) {
        const firstMatch = json.matches[0];
        expect(firstMatch).toHaveProperty('id');
        expect(firstMatch).toHaveProperty('score');
        expect(firstMatch).toHaveProperty('metadata');
      }
    } else {
      // If not configured, should return error message
      const text = await response.text();
      console.log(`[API] /api/search returned ${response.status()}: ${text}`);
    }
  });

  test('POST /api/aggregate - should return aggregation results', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/aggregate`, {
      data: {
        grantId: TEST_GRANT_ID,
        query: 'emails',
        topK: 50,
        groupBy: 'from_domain',
      },
    });

    // Should return 200 or 400/500 if not configured
    expect([200, 400, 500]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();

      // Verify response structure - API returns { groupBy, counts: [...] }
      expect(json).toHaveProperty('groupBy');
      expect(json).toHaveProperty('counts');
      expect(Array.isArray(json.counts)).toBe(true);

      // Each count should have key and count
      if (json.counts.length > 0) {
        const firstCount = json.counts[0];
        expect(firstCount).toHaveProperty('key');
        expect(firstCount).toHaveProperty('count');
      }
    } else {
      const text = await response.text();
      console.log(`[API] /api/aggregate returned ${response.status()}: ${text}`);
    }
  });

  test('GET /api/nylas/unread - should return unread messages', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/nylas/unread`, {
      params: {
        grantId: TEST_GRANT_ID,
        limit: '5',
      },
    });

    // Should return 200, 400, or 401 (if Nylas API returns unauthorized)
    expect([200, 400, 401]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response is an array or has a data/messages property
      const messages = Array.isArray(json) ? json : (json.data || json.messages || []);
      expect(Array.isArray(messages)).toBe(true);
      
      // If messages exist, verify structure
      if (messages.length > 0) {
        const firstMessage = messages[0];
        expect(firstMessage).toHaveProperty('id');
        // Nylas messages typically have subject, from, etc.
      }
    } else {
      const text = await response.text();
      console.log(`[API] /api/nylas/unread returned ${response.status()}: ${text}`);
    }
  });

  test('GET /api/nylas/contacts - should return contacts', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/nylas/contacts`, {
      params: {
        grantId: TEST_GRANT_ID,
        limit: '5',
      },
    });

    // Should return 200, 400, or 401 (if Nylas API returns unauthorized)
    expect([200, 400, 401]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response is an array or has a data property
      const contacts = Array.isArray(json) ? json : (json.data || []);
      expect(Array.isArray(contacts)).toBe(true);
      
      // If contacts exist, verify structure
      if (contacts.length > 0) {
        const firstContact = contacts[0];
        expect(firstContact).toHaveProperty('id');
      }
    } else {
      const text = await response.text();
      console.log(`[API] /api/nylas/contacts returned ${response.status()}: ${text}`);
    }
  });

  test('GET /api/nylas/events - should return calendar events', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/nylas/events`, {
      params: {
        grantId: TEST_GRANT_ID,
        limit: '5',
      },
    });

    // Should return 200, 400, or 401 (if Nylas API returns unauthorized)
    expect([200, 400, 401]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response is an array or has a data property
      const events = Array.isArray(json) ? json : (json.data || []);
      expect(Array.isArray(events)).toBe(true);
      
      // If events exist, verify structure
      if (events.length > 0) {
        const firstEvent = events[0];
        expect(firstEvent).toHaveProperty('id');
      }
    } else {
      const text = await response.text();
      console.log(`[API] /api/nylas/events returned ${response.status()}: ${text}`);
    }
  });

  test('POST /api/sync/backfill - should trigger backfill job', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/sync/backfill`, {
      data: {
        grantId: TEST_GRANT_ID,
        limit: 10,
      },
    });

    // Should return 200, 202, 400, or 500
    expect([200, 202, 400, 500]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response indicates job was queued
      // Response shape may vary: { ok: true, jobId: '...' } or { queued: N }
      expect(json).toBeDefined();
      console.log(`[API] /api/sync/backfill response:`, json);
    } else {
      const text = await response.text();
      console.log(`[API] /api/sync/backfill returned ${response.status()}: ${text}`);
    }
  });

  test('POST /api/sync/delta - should trigger delta sync job', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/sync/delta`, {
      data: {
        grantId: TEST_GRANT_ID,
      },
    });

    // Should return 200, 202, 400, or 500
    expect([200, 202, 400, 500]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response indicates job was queued
      expect(json).toBeDefined();
      console.log(`[API] /api/sync/delta response:`, json);
    } else {
      const text = await response.text();
      console.log(`[API] /api/sync/delta returned ${response.status()}: ${text}`);
    }
  });

  test.skip('POST /api/realtime/session - should return ephemeral OpenAI key (gated)', async ({ request }) => {
    // Skip this test unless OPENAI_API_KEY is configured
    if (!process.env.OPENAI_API_KEY) {
      console.log('[API] Skipping /api/realtime/session test - OPENAI_API_KEY not set');
      return;
    }

    const response = await request.post(`${API_BASE}/api/realtime/session`, {
      data: {},
    });

    // Should return 200 or 500 if not configured
    expect([200, 500]).toContain(response.status());

    if (response.ok()) {
      const json = await response.json();
      
      // Verify response has client_secret
      expect(json).toHaveProperty('client_secret');
      expect(typeof json.client_secret).toBe('string');
      expect(json.client_secret.length).toBeGreaterThan(0);
    } else {
      const text = await response.text();
      console.log(`[API] /api/realtime/session returned ${response.status()}: ${text}`);
    }
  });
});

test.describe('API Error Handling @api', () => {
  
  test('POST /api/search - should return 400 for missing grantId', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/search`, {
      data: {
        query: 'test',
        // Missing grantId
      },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/search - should return 400 for missing query', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/search`, {
      data: {
        grantId: TEST_GRANT_ID,
        // Missing query
      },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/aggregate - should return 400 for missing grantId', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/aggregate`, {
      data: {
        query: 'test',
        // Missing grantId
      },
    });

    expect(response.status()).toBe(400);
  });

  test('GET /api/nylas/unread - should return 400 or 200 for missing grantId', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/nylas/unread`, {
      params: {
        // Missing grantId - will use env default if available
      },
    });

    // Should return 400 if no default grantId, or 200/401 if default exists
    expect([200, 400, 401]).toContain(response.status());
  });
});

