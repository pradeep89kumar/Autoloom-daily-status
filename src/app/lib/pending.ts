import { addDays, shiftWindow, startOfDay, ymd, type Shift } from "./shift";
import type { CapturedRow } from "./sheetSync";

export type SlotStatus = "pending" | "late";

export interface PendingSlot {
  loomId: string;
  loomName: string;
  date: Date;
  dateYmd: string;
  shift: Shift;
  status: SlotStatus;
}

export interface PendingDetectionInput {
  looms: { id: string; name: string }[];
  rows: CapturedRow[];
  now?: Date;
  /** How many days back to look. */
  lookbackDays?: number;
}

/** Tool went live on this date. Slots before this are never surfaced. */
const ROLLOUT_FLOOR = new Date(2026, 5, 1); // 1 Jun 2026, local time

/**
 * Compute pending and late slots:
 *  - Iterates each loom × each (date, shift) in [max(rollout, now-lookback), now].
 *  - A slot is considered only after its `nagFrom` time (else hidden — "all looks good").
 *  - Status = "late" if past cutoff, else "pending".
 *  - Skipped if a row already exists for (date, shift, loomId).
 */
export function detectPendingSlots({
  looms,
  rows,
  now = new Date(),
  lookbackDays = 14,
}: PendingDetectionInput): PendingSlot[] {
  const filled = new Set(rows.map((r) => `${r.date}|${r.shift}|${r.loomId.toUpperCase()}`));
  const slots: PendingSlot[] = [];

  const earliest = startOfDay(ROLLOUT_FLOOR);

  for (let i = lookbackDays; i >= 0; i--) {
    const date = startOfDay(addDays(now, -i));
    if (date < earliest) continue; // ignore slots before rollout
    for (const shift of ["A", "B"] as Shift[]) {
      const w = shiftWindow(date, shift);
      if (now < w.nagFrom) continue;

      const status: SlotStatus = now >= w.cutoff ? "late" : "pending";
      const dateStr = ymd(date);

      for (const loom of looms) {
        const key = `${dateStr}|${shift}|${loom.name.toUpperCase()}`;
        if (filled.has(key)) continue;
        slots.push({
          loomId: loom.id,
          loomName: loom.name,
          date,
          dateYmd: dateStr,
          shift,
          status,
        });
      }
    }
  }
  slots.sort((a, b) => (a.dateYmd === b.dateYmd
    ? (a.shift === b.shift ? a.loomName.localeCompare(b.loomName) : a.shift < b.shift ? 1 : -1)
    : a.dateYmd < b.dateYmd ? 1 : -1));
  return slots;
}
