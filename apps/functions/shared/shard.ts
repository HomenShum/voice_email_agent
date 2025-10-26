export function dayKeyFromEpoch(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export function weekKeyFromEpoch(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return isoWeekKey(d);
}

export function monthKeyFromEpoch(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

export function weekKeyFromDayKey(dayKey: string): string {
  const d = new Date(dayKey + "T00:00:00Z");
  return isoWeekKey(d);
}

function isoWeekKey(date: Date): string {
  // ISO week number (UTC)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  const y = d.getUTCFullYear();
  const w = String(weekNo).padStart(2, "0");
  return `${y}-W${w}`;
}

