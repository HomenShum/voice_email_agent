// Multi-tenant Nylas configuration for Azure Functions
// Maps Grant IDs to their corresponding API keys

/**
 * Grant ID -> API Key mapping
 * 
 * In production, load from:
 * - Azure Key Vault (recommended)
 * - Azure Table Storage / Cosmos DB
 * - Environment variables with naming convention
 * 
 * Format: NYLAS_KEY_<GRANT_ID>=<api_key>
 */

const grantApiKeyMap = new Map<string, string>();

// Load from environment variables
// Pattern: NYLAS_KEY_grant123=key_abc...
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('NYLAS_KEY_') && value) {
    const grantId = key.replace('NYLAS_KEY_', '');
    grantApiKeyMap.set(grantId, value);
  }
}

// Fallback to default key for backward compatibility
const DEFAULT_API_KEY = process.env.NYLAS_API_KEY;
const DEFAULT_GRANT_ID = process.env.NYLAS_GRANT_ID;

if (DEFAULT_API_KEY && DEFAULT_GRANT_ID) {
  grantApiKeyMap.set(DEFAULT_GRANT_ID, DEFAULT_API_KEY);
}

/**
 * Get the API key for a specific grant ID
 * @param grantId - The Nylas grant ID
 * @returns The API key for this grant
 * @throws Error if no API key is configured for this grant
 */
export function getApiKeyForGrant(grantId: string): string {
  if (!grantId) throw new Error('Grant ID is required');
  
  const apiKey = grantApiKeyMap.get(grantId);
  
  if (!apiKey) {
    // Try default as fallback
    if (DEFAULT_API_KEY) {
      console.warn(`[Nylas] No specific API key for grant ${grantId}, using default`);
      return DEFAULT_API_KEY;
    }
    throw new Error(`No API key configured for grant: ${grantId}`);
  }
  
  return apiKey;
}

/**
 * Register a new grant with its API key (runtime registration)
 * Useful for OAuth flows or admin panels
 * @param grantId - The Nylas grant ID
 * @param apiKey - The Nylas API key for this grant
 */
export function registerGrant(grantId: string, apiKey: string): void {
  if (!grantId || !apiKey) throw new Error('Both grantId and apiKey are required');
  grantApiKeyMap.set(grantId, apiKey);
  console.log(`[Nylas] Registered grant: ${grantId}`);
}

/**
 * List all registered grant IDs
 * @returns Array of grant IDs
 */
export function listRegisteredGrants(): string[] {
  return Array.from(grantApiKeyMap.keys());
}

/**
 * Check if a grant ID has an API key configured
 * @param grantId - The Nylas grant ID
 * @returns true if API key exists for this grant
 */
export function hasApiKeyForGrant(grantId: string): boolean {
  return grantApiKeyMap.has(grantId) || !!DEFAULT_API_KEY;
}
