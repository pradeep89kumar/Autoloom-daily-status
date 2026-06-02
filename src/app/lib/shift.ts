export type Shift = "A" | "B";

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function withHours(d: Date, h: number): Date {
  const x = new Date(d);
  x.setHours(h, 0, 0, 0);
  return x;
}

/** Returns the logical (shift, shiftDate) for `now`. B shift between 00:00–06:00 belongs to previous day. */
export function currentShift(now = new Date()): { shift: Shift; date: Date } {
  const h = now.getHours();
  if (h >= 6 && h < 18) return { shift: "A", date: startOfDay(now) };
  const date = h < 6 ? startOfDay(addDays(now, -1)) : startOfDay(now);
  return { shift: "B", date };
}

export interface ShiftWindow {
  start: Date;
  end: Date;
  nagFrom: Date; // when banner shows pending if not entered
  cutoff: Date;  // after this, missing → late
}

export function shiftWindow(date: Date, shift: Shift): ShiftWindow {
  const d = startOfDay(date);
  if (shift === "A") {
    return {
      start: withHours(d, 6),
      end: withHours(d, 18),
      nagFrom: withHours(d, 19),
      cutoff: withHours(d, 22),
    };
  }
  return {
    start: withHours(d, 18),
    end: withHours(addDays(d, 1), 6),
    nagFrom: withHours(addDays(d, 1), 6),
    cutoff: withHours(addDays(d, 1), 11),
  };
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
