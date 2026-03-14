function getDatePartsInTimezone(timezone: string, date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not resolve date parts for timezone ${timezone}`);
  }

  return { year, month, day };
}

export function getLocalDateKey(timezone: string, date = new Date()) {
  const { year, month, day } = getDatePartsInTimezone(timezone, date);
  return `${year}-${month}-${day}`;
}

/** Normalize a date key to YYYY-MM-DD. Accepts YYYY-MM-DD or DD-MM-YYYY. */
export function normalizeDateKey(dateKey: string): string {
  const parts = dateKey.split("-").map((p) => p.trim());
  if (parts.length !== 3) return dateKey;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  const c = Number(parts[2]);
  if (parts[0].length === 4 && a >= 1900 && a <= 2100) {
    return dateKey;
  }
  if (parts[2].length === 4 && c >= 1900 && c <= 2100) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return dateKey;
}

export function dateKeyToUtcMidnight(dateKey: string) {
  const normalized = normalizeDateKey(dateKey);
  return new Date(`${normalized}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const normalized = normalizeDateKey(dateKey);
  const [y, m, d] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
