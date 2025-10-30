import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import { getJob } from "../shared/storage";

app.http("syncProgress", {
  route: "user/sync-progress/{jobId}",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const jobId = ((req as any).params?.jobId || (req as any).params?.jobID || (req as any).params?.jobid || "").toString();
    if (!jobId) return { status: 400, jsonBody: { ok: false, error: "jobId required" } };
    const job = await getJob(jobId);
    if (!job) return { status: 404, jsonBody: { ok: false, error: "not_found" } };
    const percent = typeof job.total === "number" && job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : null;
    return { status: 200, jsonBody: { ok: true, job: { ...job, percent } } };
  },
});

