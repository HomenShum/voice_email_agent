#!/usr/bin/env node

/**
 * Manually invoke the backfill worker handler for local fixture refreshes.
 * Usage:
 *   node apps/functions/scripts/backfillManual.js <grantId> <sinceEpoch> [max=200]
 *
 * Environment:
 *   - Loads .env if present (OpenAI, Pinecone, etc.)
 *   - Defaults DATA_DIR to apps/functions/.data
 *   - Sets PINECONE_DENSE_INDEX_NAME if only PINECONE_INDEX_NAME is provided
 */

const path = require("path");
const fs = require("fs");

const ROOT = process.cwd();
const ENV_PATH = path.resolve(ROOT, ".env");

const Module = require("module");
const functionsNodeModules = path.resolve(ROOT, "apps/functions/node_modules");
const existingNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
if (!existingNodePath.includes(functionsNodeModules)) {
  existingNodePath.push(functionsNodeModules);
  process.env.NODE_PATH = existingNodePath.join(path.delimiter);
  Module._initPaths();
}

const azureFunctionsIndex = path.resolve(functionsNodeModules, "@azure/functions/dist/azure-functions.js");
const rootFunctionsDir = path.resolve(ROOT, "node_modules", "@azure", "functions");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  if (request === "@azure/functions") {
    return azureFunctionsIndex;
  }
  if (request === rootFunctionsDir) {
    return azureFunctionsIndex;
  }
  if (request === `${rootFunctionsDir}\\index.js` || request === `${rootFunctionsDir}/index.js`) {
    return azureFunctionsIndex;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

if (fs.existsSync(ENV_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: ENV_PATH });
}

if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.resolve(ROOT, "apps/functions/.data");
}
if (!process.env.PINECONE_DENSE_INDEX_NAME && process.env.PINECONE_INDEX_NAME) {
  process.env.PINECONE_DENSE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;
}
if (!process.env.PINECONE_SPARSE_INDEX_NAME && process.env.PINECONE_INDEX_NAME) {
  process.env.PINECONE_SPARSE_INDEX_NAME = `${process.env.PINECONE_INDEX_NAME}-sparse`;
}

const grantId = process.argv[2] || process.env.NYLAS_GRANT_ID;
const sinceEpoch = Number(process.argv[3] ?? Math.floor(Date.now() / 1000) - 30 * 24 * 3600);
const max = Number(process.argv[4] ?? process.env.MAX ?? 200);

if (!grantId) {
  console.error("Usage: node backfillManual.js <grantId> <sinceEpoch> [max]");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY must be configured (set in .env or environment).");
  process.exit(1);
}
if (!process.env.PINECONE_API_KEY) {
  console.error("PINECONE_API_KEY must be configured (set in .env or environment).");
  process.exit(1);
}

// Stub enqueueBackfill to avoid cascading jobs when running manually
const busPath = path.resolve(ROOT, "apps/functions/dist/shared/bus.js");
const bus = require(busPath);
bus.enqueueBackfill = async (job, delaySeconds) => {
  console.log(`[manual] Skipping enqueueBackfill grant=${job?.grantId} delay=${delaySeconds ?? 0}`);
};

// Capture the backfill handler from Azure Functions registration
const azf = require(path.resolve(ROOT, "apps/functions/node_modules/@azure/functions"));
let capturedHandler = null;
const customServiceBusQueue = (name, options) => {
  capturedHandler = options?.handler;
  console.log(`[manual] Captured handler for ${name}`);
  return { name, options };
};
azf.app.serviceBusQueue = customServiceBusQueue;
console.log("[manual] Patched serviceBusQueue:", azf.app.serviceBusQueue === customServiceBusQueue);

require(path.resolve(ROOT, "apps/functions/dist/functions/backfillWorker.js"));
Module._resolveFilename = originalResolveFilename;

if (typeof capturedHandler !== "function") {
  console.error("[manual] Failed to capture backfill handler.");
  process.exit(1);
}

const ctx = {
  log: (...args) => console.log("[bf]", ...args),
  warn: (...args) => console.warn("[bf:warn]", ...args),
  error: (...args) => console.error("[bf:error]", ...args),
};

async function run() {
  const job = {
    grantId,
    sinceEpoch: Number.isFinite(sinceEpoch) ? sinceEpoch : 0,
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 200,
    processed: 0,
    attempt: 0,
  };

  console.log(`[manual] Starting backfill for grant=${grantId} since=${job.sinceEpoch} max=${job.max}`);
  await capturedHandler(job, ctx);
  console.log("[manual] Backfill run complete.");
}

run().catch(err => {
  console.error("[manual] Error running backfill:", err);
  process.exit(1);
});
