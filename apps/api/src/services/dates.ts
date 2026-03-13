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

export function dateKeyToUtcMidnight(dateKey: string) {
  // dateKey is YYYY-MM-DD in the user's local calendar.
  // We store entryDate as UTC midnight for that calendar date.
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
