export function formatTime(ts: string) {
  return new Date(ts).toLocaleString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("ar-SY", {
    timeZone: "Asia/Damascus",
  });
}

// ── Business-day boundary ────────────────────────────────────────────────────
// The gym's day runs 6 AM → 6 AM (Asia/Damascus): late-night activity after
// midnight counts as the PREVIOUS day, so the new day starts clean at 6 AM.
// Damascus is UTC+3 year-round (no DST), so a fixed +03:00 offset is correct.
export const DAMASCUS_OFFSET = "+03:00";
export const BUSINESS_DAY_START_HOUR = 6;

// The Damascus calendar date (YYYY-MM-DD) of an instant. en-CA → ISO order.
function damascusCalendarDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
}

// Which business date an instant belongs to. Shifting the instant back by the
// start hour means 00:00–06:00 Damascus resolves to the previous calendar date.
export function businessDateOf(instant: Date = new Date()): string {
  const shifted = new Date(instant.getTime() - BUSINESS_DAY_START_HOUR * 3_600_000);
  return damascusCalendarDate(shifted);
}

// The business date "now" belongs to.
export function currentBusinessDate(): string {
  return businessDateOf(new Date());
}

// UTC [start, end) window for one business date — its 6 AM to the next 6 AM
// (Damascus). 24h is always correct because Damascus has no DST.
export function businessDayWindowUTC(businessDate: string): { start: string; end: string } {
  const hh = String(BUSINESS_DAY_START_HOUR).padStart(2, "0");
  const start = new Date(`${businessDate}T${hh}:00:00.000${DAMASCUS_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// UTC [start, end) window spanning whole business days from startDate to
// endDate inclusive (startDate's 6 AM → the day after endDate's 6 AM).
export function businessRangeUTC(startDate: string, endDate: string): { start: string; end: string } {
  return {
    start: businessDayWindowUTC(startDate).start,
    end: businessDayWindowUTC(endDate).end,
  };
}

// Start of the current business day as a UTC ISO string — for live "today"
// filters (created_at >= this).
export function businessDayStartUTC(): string {
  return businessDayWindowUTC(currentBusinessDate()).start;
}

// Does a timestamp fall in the current business day? For client-side "today"
// list filters (e.g. reception's today sales/expenses).
export function isCurrentBusinessDay(instant: string | Date): boolean {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return businessDateOf(d) === currentBusinessDate();
}
