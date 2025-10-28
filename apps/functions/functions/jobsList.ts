import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

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
import { listJobs } from "../shared/storage";

app.http("jobsList", {
  route: "user/jobs",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const grantId = (url.searchParams.get("grantId") || "").trim();
      const limit = Number(url.searchParams.get("limit") || "24");
      if (!grantId) {
        return { status: 400, jsonBody: { ok: false, error: "grantId required" } };
      }
      const jobs = await listJobs(grantId, limit);
      return { status: 200, jsonBody: { ok: true, jobs } };
    } catch (err: any) {
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});

