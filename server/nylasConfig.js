// Multi-tenant Nylas configuration
// Maps Grant IDs to their corresponding API keys

/**
 * Grant ID -> API Key mapping
 *
 * In production, this should come from:
 * - Database (Azure Table Storage, Cosmos DB, etc.)
 * - Azure Key Vault
 * - Environment variables with a naming convention
 *
 * Format: NYLAS_KEY_<GRANT_ID>=<api_key>
 */

const grantApiKeyMap = new Map();

function loadGrantsFromEnv() {
  grantApiKeyMap.clear();

  // Load from environment variables
  // Pattern: NYLAS_KEY_grant123=key_abc...
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('NYLAS_KEY_')) {
      const grantId = key.replace('NYLAS_KEY_', '');
      grantApiKeyMap.set(grantId, value);
    }
  }

  // Fallback to default key for backward compatibility
  const DEFAULT_API_KEY = process.env.NYLAS_API_KEY;
  const DEFAULT_GRANT_ID = process.env.NYLAS_GRANT_ID;

  if (DEFAULT_API_KEY && DEFAULT_GRANT_ID) {
    grantApiKeyMap.set(DEFAULT_GRANT_ID, DEFAULT_API_KEY);
    console.log(`[nylasConfig] Registered default grant: ${DEFAULT_GRANT_ID}`);
  } else {
    console.log(`[nylasConfig] No default grant configured. NYLAS_API_KEY=${!!DEFAULT_API_KEY}, NYLAS_GRANT_ID=${!!DEFAULT_GRANT_ID}`);
  }
}

// Load on startup
loadGrantsFromEnv();

/**
 * Reload grants from environment variables
 * Call this after loading .env to pick up new variables
 */
export function reloadGrantsFromEnv() {
  loadGrantsFromEnv();
}

/**
 * Get the API key for a specific grant ID
 * @param {string} grantId - The Nylas grant ID
 * @returns {string} The API key for this grant
 * @throws {Error} If no API key is configured for this grant
 */
export function getApiKeyForGrant(grantId) {
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
 * @param {string} grantId - The Nylas grant ID
 * @param {string} apiKey - The Nylas API key for this grant
 */
export function registerGrant(grantId, apiKey) {
  if (!grantId || !apiKey) throw new Error('Both grantId and apiKey are required');
  grantApiKeyMap.set(grantId, apiKey);
  console.log(`[Nylas] Registered grant: ${grantId}`);
}

/**
 * List all registered grant IDs
 * @returns {string[]} Array of grant IDs
 */
export function listRegisteredGrants() {
  return Array.from(grantApiKeyMap.keys());
}
