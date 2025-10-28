import type { HttpRequest, HttpResponseInit } from "@azure/functions";

function loadAzureFunctionsRuntime(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  const realDir = path.resolve(process.cwd(), "node_modules", "@azure", "functions");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(realDir);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@azure/functions");
  }
}

const { app } = loadAzureFunctionsRuntime();

import {
  getIndexSessionMetrics,
  resetIndexSessionMetrics,
  describeIndexStatsDense,
  describeIndexStatsSparse,
  getPersistedIndexSession,
  flushIndexSessionMetricsNow,
  getIndexMetricsPersistenceInfo,
} from "../shared/pinecone";

// GET /api/index/stats
// Query params:
// - reset=1       -> reset in-memory session metrics
// - flush=1       -> force flush metrics to disk now
// - includePersisted=1 -> include last persisted snapshot in response
app.http("indexStats", {
  route: "index/stats",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const reset = (url.searchParams.get("reset") || "").toLowerCase();
      const flush = (url.searchParams.get("flush") || "").toLowerCase();
      const includePersisted = (url.searchParams.get("includePersisted") || "").toLowerCase();

      if (reset === "1" || reset === "true") {
        resetIndexSessionMetrics();
      }
      if (flush === "1" || flush === "true") {
        flushIndexSessionMetricsNow();
      }

      const [denseStats, sparseStats] = await Promise.all([
        describeIndexStatsDense(),
        describeIndexStatsSparse(),
      ]);

      const session = getIndexSessionMetrics();
      const persistence = getIndexMetricsPersistenceInfo();
      const persisted = includePersisted === "1" || includePersisted === "true" ? getPersistedIndexSession() : undefined;

      return {
        status: 200,
        jsonBody: {
          session,
          pinecone: {
            dense: denseStats,
            sparse: sparseStats,
          },
          persistence,
          persisted,
        },
      };
    } catch (e: any) {
      return { status: 500, body: String(e?.message || e) };
    }
  },
});

