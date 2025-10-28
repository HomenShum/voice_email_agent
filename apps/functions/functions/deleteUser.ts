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
import { Pinecone } from "@pinecone-database/pinecone";
import { deleteGrantData, deleteGrantSecret } from "../shared/storage";

async function deleteNamespaceVectors(grantId: string, ctx: InvocationContext): Promise<{ ok: boolean; method: string; }> {
  const apiKey = process.env.PINECONE_API_KEY || "";
  const indexName = process.env.PINECONE_INDEX_NAME || "";
  const host = process.env.PINECONE_INDEX_HOST || "";
  if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
  if (!indexName && !host) throw new Error("Missing PINECONE_INDEX_NAME or PINECONE_INDEX_HOST");

  // Prefer SDK; fall back to REST if needed
  try {
    if (indexName) {
      const pc = new Pinecone({ apiKey });
      const index = pc.index(indexName);
      // SDK v6 supports deleteAll via namespace(); older versions might not
      const ns: any = (index as any).namespace(grantId);
      if (ns && typeof ns.deleteAll === "function") {
        await ns.deleteAll();
        return { ok: true, method: "sdk.deleteAll" };
      }
      // Fallback to generic delete call if available
      if (ns && typeof ns.deleteMany === "function") {
        await ns.deleteMany({ deleteAll: true } as any);
        return { ok: true, method: "sdk.deleteMany" };
      }
    }
  } catch (e: any) {
    ctx.warn?.(`deleteUser: SDK delete failed, will try REST: ${e?.message || e}`);
  }

  // REST fallback using index host
  if (!host) throw new Error("PINECONE_INDEX_HOST required for REST delete");
  const url = `https://${host}/vectors/delete`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ namespace: grantId, deleteAll: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinecone REST delete failed ${res.status}: ${text}`);
  }
  return { ok: true, method: "rest.deleteAll" };
}

app.http("deleteUser", {
  route: "user/delete",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as Partial<{ grantId: string }>;
      const grantId = (body?.grantId || "").trim();
      if (!grantId) return { status: 400, jsonBody: { ok: false, error: "grantId required" } };

      // 1) Delete Pinecone namespace
      let delMethod = "none";
      try {
        const delRes = await deleteNamespaceVectors(grantId, ctx);
        delMethod = delRes.method;
      } catch (e: any) {
        ctx.warn?.(`deleteUser: Pinecone delete failed: ${e?.message || e}`);
      }

      // 2) Remove local stored data & secret (dev)
      await deleteGrantSecret(grantId);
      await deleteGrantData(grantId);

      return { status: 200, jsonBody: { ok: true, grantId, pinecone: delMethod } };
    } catch (err: any) {
      ctx.error?.("deleteUser error", err);
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});

