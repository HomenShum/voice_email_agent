export const CASES = [
  {
    id: "security-alert",
    scenario: "User asks to find a Google security alert email",
    user_query: "Find the security alert from Google",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: { query: "Security alert", types: ["message"], topK: 5 },
    expect:
      "At least one result has subject containing 'Security alert' and from like accounts.google.com",
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
    expect: "A result referencing OpenAI @ UC Berkeley or GPTDAO announcement",
  },
  {
    id: "yelp-prompt",
    scenario: "User asks what Yelp wanted",
    user_query: "What did Yelp ask me to do recently?",
    namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
    search: { query: "Yelp review", types: ["message"], topK: 5 },
    expect: "It should mention Yelp asking for a review",
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
    expect: "A match referencing LANY or Bandsintown",
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
    expect: "A result describing an Upwork job alert with brief job info",
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
      "A weekly rollup summary with themes such as 'event', 'OpenAI', 'Berkeley', 'speakers'",
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
    expect: "A monthly rollup mentioning job alert themes",
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
      "Results include only items after the last received_after checkpoint; minimal overlap with already processed items",
  },
];

