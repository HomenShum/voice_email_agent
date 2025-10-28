const JUDGE_MODEL = process.env.OPENAI_JUDGE_MODEL || "gpt-5"; // larger model for judging

export async function judgeCase(input) {
  const instruction = [
    "You are an impartial evaluator for an email voice agent.",
    "Given a user query, an expectation, and the system outputs (search matches and optional aggregation),",
    "return a strict JSON object with fields: usefulness, correctness, pass, rationale.",
    "- usefulness: true if the outputs would help a typical user accomplish the task.",
    "- correctness: true if the outputs match the expectation and do not include contradictory or wrong facts.",
    "- pass: true only if usefulness and correctness are both true.",
    "Be concise and avoid speculation; rely only on provided outputs.",
    "Output ONLY JSON."
  ].join(" ");

  const content = [
    `SCENARIO: ${input.scenario}`,
    `USER_QUERY: ${input.user_query}`,
    `EXPECTATION: ${input.expectation}`,
    `SYSTEM_OUTPUTS.MATCHES: ${JSON.stringify(input.system_outputs.matches, null, 2)}`,
    `SYSTEM_OUTPUTS.AGGREGATION: ${JSON.stringify(input.system_outputs.aggregation ?? {}, null, 2)}`
  ].join("\n\n");

  if (process.env.JUDGE_DISABLE_LLM === '1') {
    return {
      usefulness: false,
      correctness: false,
      pass: false,
      rationale: "JUDGE_DISABLE_LLM=1 (LLM judging disabled)",
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      usefulness: false,
      correctness: false,
      pass: false,
      rationale: "Missing OPENAI_API_KEY"
    };
  }

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      input: [
        { role: "system", content: instruction },
        { role: "user", content }
      ],
      
    })
  });

  let json;
  try {
    json = await r.json();
  } catch {
    return {
      usefulness: false,
      correctness: false,
      pass: false,
      rationale: `Non-JSON judge response: HTTP ${r.status}`
    };
  }

  const concatenated = Array.isArray(json?.output)
    ? json.output
        .flatMap((item) => {
          if (!item?.content) return [];
          return item.content
            .filter((part) => part?.type === "output_text" || part?.type === "text")
            .map((part) => part.text || part.output_text || "");
        })
        .join("")
    : "";
  const text = (json?.output_text || concatenated || "").trim();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch {}
    if (!parsed) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
  }
  if (!parsed) {
    return {
      usefulness: false,
      correctness: false,
      pass: false,
      rationale: `Judge model returned non-JSON output: ${text || "[empty]"}`,
    };
  }

  if (typeof parsed.usefulness !== "boolean" || typeof parsed.correctness !== "boolean" || typeof parsed.pass !== "boolean") {
    return {
      usefulness: false,
      correctness: false,
      pass: false,
      rationale: "Judge response missing boolean usefulness/correctness/pass fields",
    };
  }

  parsed.pass = parsed.pass && parsed.usefulness && parsed.correctness;
  parsed.rationale = String(parsed.rationale || "").slice(0, 2000);
  return parsed;
}
