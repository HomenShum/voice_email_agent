export interface ScratchpadEntry {
  toolName: string;
  timestamp: number;
  summary?: string;
  parameters?: Record<string, unknown> | null;
  result?: unknown;
  filters?: Record<string, unknown> | null;
}

export class Scratchpad {
  private readonly capacity: number;
  private entries: ScratchpadEntry[] = [];

  constructor(capacity = 3) {
    this.capacity = Math.max(1, capacity);
  }

  add(entry: ScratchpadEntry) {
    const enriched: ScratchpadEntry = {
      ...entry,
      timestamp: entry.timestamp ?? Date.now(),
    };
    this.entries.unshift(enriched);
    if (this.entries.length > this.capacity) {
      this.entries = this.entries.slice(0, this.capacity);
    }
  }

  list(): ScratchpadEntry[] {
    return [...this.entries];
  }

  latest(): ScratchpadEntry | undefined {
    return this.entries[0];
  }

  toInstructionSummary(): string {
    if (!this.entries.length) return 'No recent tool context available.';
    const lines = this.entries.map((entry, idx) => {
      const ts = new Date(entry.timestamp).toISOString();
      const filters = entry.filters && Object.keys(entry.filters).length
        ? ` filters=${JSON.stringify(entry.filters)}`
        : '';
      const summary = entry.summary ? ` ${entry.summary}` : '';
      return `${idx + 1}. [${entry.toolName}] ${ts}${filters}${summary}`;
    });
    return `Recent context:
${lines.join('\n')}`;
  }
}
