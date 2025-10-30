export const CASES = [
  {
    id: "security-alert",
    scenario: "User asks to find a Google security alert email",
    user_query: "Find the security alert from Google",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: { query: "Security alert", types: ["message"], topK: 5 },
    expect:
      "Functional: Retrieve at least one email relevant to a security alert. Typically from Google or similar provider is fine, but DO NOT require exact subject or domain matches. Judge on relevance to 'security alert' rather than exact strings.",
  },
  {
    id: "uc-berkeley-event",
    scenario: "User asks about UC Berkeley related announcement",
    user_query: "Show me the UC Berkeley event email",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "UC Berkeley OpenAI",
      types: ["message", "thread_day", "thread_week", "thread_month"],
      topK: 5,
    },
    expect: "Functional: Show results plausibly related to UC Berkeley and/or OpenAI (or similar academic/AI event). Content may drift; judge on topical relevance to the query rather than exact phrases.",
  },
  {
    id: "yelp-prompt",
    scenario: "User asks what Yelp wanted",
    user_query: "What did Yelp ask me to do recently?",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: { query: "Yelp review", types: ["message"], topK: 5 },
    expect: "Functional: Identify an email prompting a review (e.g., from Yelp or similar). Judge on action-request relevance, not exact brand phrasing.",
  },
  {
    id: "bandsintown",
    scenario: "User asks band notification summary",
    user_query: "Summarize the Bandsintown update",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "Bandsintown LANY",
      types: ["message", "thread_day", "thread_week", "thread_month"],
      topK: 5,
    },
    expect: "Functional: Surface a music event/artist notification (e.g., Bandsintown/LANY or similar). Judge on musical event relevance rather than exact artist/domain.",
  },
  {
    id: "upwork-job",
    scenario: "User asks for the Upwork job alert summary",
    user_query: "Summarize the Upwork job alert",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "Upwork New job alert",
      types: ["message", "thread_day", "thread_week", "thread_month"],
      topK: 5,
    },
    expect: "Functional: Return a job alert or equivalent listing summary. Judge on job-alert relevance rather than exact wording or sender.",
  },
  // --- Rollup tests (day/week/month) ---
  {
    id: "rollup-week",
    scenario: "User asks for a weekly rollup for a specific thread",
    user_query: "Give me the weekly summary for the OpenAI @ UC Berkeley thread",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "OpenAI UC Berkeley weekly summary",
      types: ["thread_week"],
      topK: 5,
    },
    expect:
      "Functional: Provide a weekly rollup-style result for the topic/thread (week-scale grouping with thematic summary). Do not require specific phrases; judge on rollup behavior and topical coherence.",
  },
  {
    id: "rollup-month",
    scenario: "User asks for a monthly rollup",
    user_query: "Summarize the monthly highlights related to job alerts",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "monthly summary job alert",
      types: ["thread_month"],
      topK: 5,
    },
    expect: "Functional: Provide a monthly rollup related to job-alert themes (month-scale grouping). Judge on rollup behavior and topic alignment, not exact words.",
  },
  // --- Unread delta (optional) ---
  {
    id: "unread-delta",
    scenario: "Pull latest unread since the last pull; ensure we do not re-scan all",
    user_query: "Fetch unread since last run",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "recent unread",
      types: ["message"],
      topK: 5,
      // dateFrom: "2025-10-25T00:00:00.000Z",
    },
    expect:
      "Functional: Show recent unread items since the last checkpoint with minimal overlap. Judge based on plausibility and metadata cues (e.g., unread=true), not perfect deduplication.",
    assert({ matches }) {
      const list = Array.isArray(matches) ? matches : [];
      if (!list.length) throw new Error("Expected unread query to return at least one match");
      const withUnread = list.filter((m) => m && typeof m?.metadata?.unread !== "undefined");
      if (!withUnread.length) {
        throw new Error("Expected at least one match with metadata.unread present");
      }
      const invalid = withUnread.filter((m) => typeof m.metadata.unread !== "boolean");
      if (invalid.length) {
        const sample = invalid
          .slice(0, 3)
          .map((m) => `${m.id ?? "unknown"}=${JSON.stringify(m.metadata.unread)}`)
          .join(", ");
        throw new Error(`metadata.unread must be boolean; found non-boolean values: ${sample}`);
      }
      if (!withUnread.some((m) => m.metadata.unread === true)) {
        throw new Error("Expected at least one unread=true match in unread query results");
      }
    },
  },
  {
    id: "attachment-summary",
    scenario: "User asks which recent emails included attachments",
    user_query: "Which emails had attachments recently?",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: {
      query: "calendar invite attachment",
      types: ["message", "email"],
      topK: 10,
    },
    expect:
      "Functional: At least one result indicates attachments (prefer has_attachments=true) and exposes attachment-related metadata. Judge on attachment relevance rather than exact subject/sender.",
    assert({ matches }) {
      const withAttachment = (matches || []).find((m) => {
        const meta = m?.metadata || {};
        return (
          String(meta?.type || "").match(/message|email/i) &&
          meta.has_attachments === true
        );
      });
      if (!withAttachment) {
        throw new Error("Expected a message result with has_attachments=true");
      }
      const meta = withAttachment.metadata || {};
      if (
        typeof meta.message_id === "undefined" &&
        typeof meta.email_id === "undefined" &&
        typeof meta.thread_id === "undefined"
      ) {
        throw new Error("Attachment-bearing message missing identifier metadata (message/email/thread)");
      }
    },
  },
];
