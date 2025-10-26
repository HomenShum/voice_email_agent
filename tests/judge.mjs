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
    // Heuristic-only mode (no external API calls)
    const matches = Array.isArray(input.system_outputs.matches) ? input.system_outputs.matches : [];
    const hasMatches = matches.length > 0;
    const lc = (s) => String(s || "").toLowerCase();
    const any = (pred) => matches.some((m) => {
      const md = m.metadata || {};
      return pred(m, md);
    });

    let useful = hasMatches;
    let correct = false;
    const expectText = lc(input.expectation || "");
    const userText = lc(input.user_query || "");

    const hasSubj = (kw) => any((m, md) => lc(md.subject).includes(lc(kw)));
    const hasFrom = (kw) => any((m, md) => lc(md.from).includes(lc(kw)));
    const hasType = (kw) => any((m, md) => lc(md.type).includes(lc(kw)));
    const hasIdIncl = (kw) => any((m) => lc(m.id).includes(lc(kw)));

    // Prioritize structural rollups before content-specific checks
    if (expectText.includes("weekly")) {
      correct = hasType("summary_week") || hasType("thread_week") || hasIdIncl("summary:week");
    } else if (expectText.includes("monthly")) {
      correct = hasType("summary_month") || hasType("thread_month") || hasIdIncl("summary:month");
    } else if (expectText.includes("unread") || userText.includes("unread") || expectText.includes("checkpoint") || expectText.includes("received_after")) {
      const unreadCount = matches.filter((m) => (m.metadata || {}).unread === true).length;
      correct = unreadCount / Math.max(matches.length, 1) >= 0.6;
    } else if (expectText.includes("security alert")) {
      correct = hasSubj("security alert") && (hasFrom("accounts.google.com") || hasFrom("google.com"));
    } else if (expectText.includes("berkeley") || expectText.includes("openai") || expectText.includes("gptdao")) {
      correct = hasSubj("berkeley") || hasSubj("openai") || hasFrom("berkeley") || hasFrom("gptdao");
    } else if (expectText.includes("yelp")) {
      correct = hasSubj("yelp") || hasFrom("yelp.com") || hasSubj("review");
    } else if (expectText.includes("bandsintown") || expectText.includes("lany")) {
      correct = hasSubj("bandsintown") || hasSubj("lany") || hasFrom("bandsintown");
    } else if (expectText.includes("job alert")) {
      correct = hasFrom("upwork.com") || hasSubj("new job") || hasSubj("job");
    }

    const pass = !!useful && !!correct;
    return {
      usefulness: !!useful,
      correctness: !!correct,
      pass,
      rationale: `Heuristic-only: matches=${matches.length}, correct=${correct}`
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

  const text = (json?.output_text || "").trim();
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
    // Heuristic fallback judge when model output is unavailable
    const matches = Array.isArray(input.system_outputs.matches) ? input.system_outputs.matches : [];
    const hasMatches = matches.length > 0;
    const lc = (s) => String(s || "").toLowerCase();
    const any = (pred) => matches.some((m) => {
      const md = m.metadata || {};
      return pred(m, md);
    });

    let useful = hasMatches;
    let correct = false;
    const expectText = lc(input.expectation || "");
    const userText = lc(input.user_query || "");

    const hasSubj = (kw) => any((m, md) => lc(md.subject).includes(lc(kw)));
    const hasFrom = (kw) => any((m, md) => lc(md.from).includes(lc(kw)));
    const hasType = (kw) => any((m, md) => lc(md.type).includes(lc(kw)));

    const id = input.id || input.case_id || input.scenario || "";

    // Prioritize structural rollups before content-specific checks
    if (expectText.includes("weekly")) {
      correct = hasType("summary_week") || hasType("thread_week") || hasIdIncl("summary:week");
    } else if (expectText.includes("monthly")) {
      correct = hasType("summary_month") || hasType("thread_month") || hasIdIncl("summary:month");
    } else if (expectText.includes("unread") || userText.includes("unread") || expectText.includes("checkpoint") || expectText.includes("received_after")) {
      const unreadCount = matches.filter((m) => (m.metadata || {}).unread === true).length;
      correct = unreadCount / Math.max(matches.length, 1) >= 0.6;
    } else if (expectText.includes("security alert")) {
      correct = hasSubj("security alert") && (hasFrom("accounts.google.com") || hasFrom("google.com"));
    } else if (expectText.includes("berkeley") || expectText.includes("openai") || expectText.includes("gptdao")) {
      correct = hasSubj("berkeley") || hasSubj("openai") || hasFrom("berkeley") || hasFrom("gptdao");
    } else if (expectText.includes("yelp")) {
      correct = hasSubj("yelp") || hasFrom("yelp.com") || hasSubj("review");
    } else if (expectText.includes("bandsintown") || expectText.includes("lany")) {
      correct = hasSubj("bandsintown") || hasSubj("lany") || hasFrom("bandsintown");
    } else if (expectText.includes("job alert")) {
      correct = hasFrom("upwork.com") || hasSubj("new job") || hasSubj("job");
    }

    const pass = !!useful && !!correct;
    return {
      usefulness: !!useful,
      correctness: !!correct,
      pass,
      rationale: `Heuristic fallback: matches=${matches.length}, correct=${correct}`
    };
  }
  parsed.usefulness = !!parsed.usefulness;
  parsed.correctness = !!parsed.correctness;
  parsed.pass = !!parsed.pass && parsed.usefulness && parsed.correctness;
  parsed.rationale = String(parsed.rationale || "").slice(0, 2000);
  return parsed;
}

