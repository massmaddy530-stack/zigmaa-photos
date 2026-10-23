// Guest-link expiry helpers. The API stores UTC instants; <input type="datetime-local"> works in local time
// without a timezone, so values are converted at the edges.

export type ExpiryState = "none" | "active" | "expired";

export function expiryState(iso: string | null | undefined, now: Date = new Date()): ExpiryState {
  if (!iso) return "none";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "none";
  return t <= now.getTime() ? "expired" : "active";
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in the browser's local time (the datetime-local input format). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) -> ISO instant with timezone, or null if empty/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // a date-time string without an offset is parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
