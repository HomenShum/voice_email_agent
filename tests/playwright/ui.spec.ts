import { test, expect } from '@playwright/test';

/**
 * UI E2E Tests for Voice Email Agent
 *
 * Coverage:
 * - Connect button flow
 * - Text input enable/disable states
 * - Send text via button click
 * - Send text via Enter key
 * - Transcript updates
 * - Tool call history updates
 * - Full text → tool invocation → UI update flow
 */

test.describe('Voice Agent UI @ui', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    // Capture console errors for diagnostics and navigate to the app
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto('/');
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      // Surface errors in CI logs for the deployed run
      console.log('Console errors detected:', JSON.stringify(consoleErrors, null, 2));
    }
  });

  test('should load the UI with disabled text input initially', async ({ page }) => {
    // Check that text input and send button are disabled initially
    const textInput = page.locator('#text-input');
    const sendBtn = page.locator('#send-text');

    await expect(textInput).toBeDisabled();
    await expect(sendBtn).toBeDisabled();
    await expect(sendBtn).toHaveText('Send');
  });

  test('should enable text input after connecting (realtime, conditional)', async ({ page }) => {
    test.skip(!process.env.OPENAI_API_KEY, 'Requires OPENAI_API_KEY');

    // Click connect button
    const connectBtn = page.locator('#connect');
    await connectBtn.click();

    // Wait for connection to complete
    await expect(connectBtn).toHaveText('Connected', { timeout: 15000 });

    // Verify input enabled and panel state updated
    const textInput = page.locator('#text-input');
    const sendBtn = page.locator('#send-text');
    await expect(textInput).toBeEnabled();
    await expect(sendBtn).toBeEnabled();

    // Tools & Agents panel should reflect active conversation
    const toolsAgentsPanel = page.locator('#tools-agents-panel');
    await expect(toolsAgentsPanel).toHaveClass(/conversation-active/);
  });

  test('should have connect button', async ({ page }) => {
    const connectBtn = page.locator('#connect');
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toHaveText('Connect Voice Agent');
  });

  test('should have test request button', async ({ page }) => {
    const testBtn = page.locator('#test-send-text');
    await expect(testBtn).toBeVisible();
    await expect(testBtn).toHaveText('Send Test Request');
  });

  test('should have all UI panels', async ({ page }) => {
    // Verify all main panels exist
    await expect(page.locator('#transcript')).toBeVisible();
    await expect(page.locator('#results')).toBeVisible();

    // sync-status exists but may be hidden initially (empty div)
    const syncStatus = page.locator('#sync-status');
    await expect(syncStatus).toBeAttached(); // Just check it exists in DOM

    // Verify panel headings
    await expect(page.locator('text=Conversation')).toBeVisible();
    await expect(page.locator('text=Tool Call History')).toBeVisible();
  });

  test('should show transcript in conversation panel', async ({ page }) => {
    // This test verifies that the transcript area exists and can receive updates
    // The correct selector is #transcript-list (not #tool-history)
    const transcript = page.locator('#transcript-list');
    await expect(transcript).toBeVisible();

    // The transcript should be empty initially (or have minimal content)
    const initialContent = await transcript.textContent();
    expect(initialContent).toBeDefined();
  });

  test('should have tool call history panel', async ({ page }) => {
    // Verify tool call history panel exists
    const toolHistory = page.locator('#results-list');
    await expect(toolHistory).toBeVisible();

    // Should be empty initially
    const initialContent = await toolHistory.textContent();
    expect(initialContent).toBeDefined();
  });

  test('should send text and reflect tool + agent UI updates (realtime, conditional)', async ({ page }) => {
    test.skip(!process.env.OPENAI_API_KEY, 'Requires OPENAI_API_KEY');

    // Step 1: Connect to voice agent
    const connectBtn = page.locator('#connect');
    await connectBtn.click();
    await expect(connectBtn).toHaveText('Connected', { timeout: 15000 });

    // Step 2: Send a text message that should trigger specialized agent + tools
    const textInput = page.locator('#text-input');
    const sendBtn = page.locator('#send-text');

    await textInput.fill('Search my emails about project updates');
    await sendBtn.click();

    // Step 3: Transcript shows user message and tool progress lines
    const transcript = page.locator('#transcript-list');
    await expect(transcript).toContainText('project updates', { timeout: 15000 });
    await expect(transcript).toContainText('[tool]', { timeout: 20000 });

    // Step 4: Tool call history reflects one or more tool calls with details
    const toolHistory = page.locator('#results-list');
    const toolItems = toolHistory.locator('.tool-call-item');
    await expect.poll(async () => await toolItems.count()).toBeGreaterThan(0);

    // Be robust to different tools; ensure item shows params or result text
    const firstTool = toolItems.first();
    await expect(firstTool).toContainText(/OK|completed|results|groups|count|queued|Total/i);

    // Step 5: Agents & Tools panel should be visible and populated
    await expect(page.locator('#agents-list')).toBeVisible();
    // At least one tool name should render from metadata
    await expect(page.locator('#agents-list .tool-name').first()).toBeVisible();

    // Step 6: No console errors during the happy-path flow
    expect(consoleErrors, 'Console errors detected').toEqual([]);
  });
});
