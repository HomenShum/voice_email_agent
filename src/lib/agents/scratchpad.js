export class Scratchpad {
    capacity;
    entries = [];
    constructor(capacity = 3) {
        this.capacity = Math.max(1, capacity);
    }
    add(entry) {
        const enriched = {
            ...entry,
            timestamp: entry.timestamp ?? Date.now(),
        };
        this.entries.unshift(enriched);
        if (this.entries.length > this.capacity) {
            this.entries = this.entries.slice(0, this.capacity);
        }
    }
    list() {
        return [...this.entries];
    }
    latest() {
        return this.entries[0];
    }
    toInstructionSummary() {
        if (!this.entries.length)
            return 'No recent tool context available.';
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
