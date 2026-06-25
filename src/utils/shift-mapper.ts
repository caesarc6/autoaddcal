import type { WpsCalendarDay, WorkShift } from "../types/index.js";

const SEGMENT_LABELS: Record<string, string> = {
  D01: "Work shift",
  D02: "Day Off",
  D03: "Public Holiday",
  D04: "Special Leave",
  D05: "Training",
  D08: "Work (Half)",
  D09: "Personal Leave",
  D10: "Work (Early)",
  D11: "Work (Late)",
  D12: "Work (Split)",
  D13: "Sick Leave",
  D14: "Maternity Leave",
  D15: "Compensation Day",
  D16: "Long-term Leave",
};

const WORK_CODES = new Set(["D01", "D08", "D10", "D11", "D12"]);

export function isWorkShiftCode(code: string): boolean {
  return WORK_CODES.has(code);
}

/**
 * WPS encodes shift times with a sentinel date of 1753-01-01.
 * The day component indicates overnight: 01 = same day, 02 = next day.
 */
export function parseWpsTime(
  value: string | null,
  shiftDate: string,
  dayOfMonth: number,
): Date | null {
  if (!value) return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, , sentinelDay, hour, minute, second] = match;
  const base = new Date(`${shiftDate}T00:00:00`);

  if (Number.isNaN(base.getTime())) return null;

  const result = new Date(base);

  if (year === "1753") {
    if (Number(sentinelDay) === 2) {
      result.setDate(result.getDate() + 1);
    }
  } else {
    const actualDay = Number(sentinelDay);
    if (actualDay !== dayOfMonth) {
      result.setDate(result.getDate() + (actualDay - dayOfMonth));
    }
  }

  result.setHours(Number(hour), Number(minute), Number(second), 0);
  return result;
}

function labelForCode(code: string | null): string {
  if (!code) return "Unscheduled";
  return SEGMENT_LABELS[code] ?? code;
}

export function mapCalendarDay(day: WpsCalendarDay, monthKey: string): WorkShift {
  const date = `${monthKey}-${String(day.dates).padStart(2, "0")}`;
  const segmentCode =
    day.shiftWorkSegmentCode ?? day.workSegmentCode ?? "NONE";
  const label = labelForCode(segmentCode);

  const start = parseWpsTime(
    day.shiftWorkingTime ?? day.workingTime,
    date,
    day.dates,
  );
  const end = parseWpsTime(
    day.shiftClockOutTime ?? day.clockOutTime,
    date,
    day.dates,
  );
  const isWork = WORK_CODES.has(segmentCode);
  const allDay = !isWork || (!start && !end);

  const title =
    isWork && start && end
      ? `Work: ${formatTime(start)} – ${formatTime(end)}`
      : label;

  const descriptionParts = [
    `Work schedule (${segmentCode} - ${labelForCode(segmentCode)})`,
    day.eventDetail ? `Event: ${day.eventDetail}` : null,
  ].filter(Boolean);

  return {
    date,
    title,
    description: descriptionParts.join("\n"),
    start: allDay ? null : start,
    end: allDay ? null : end,
    allDay,
    segmentCode,
  };
}

export function shiftsToSync(shifts: WorkShift[]): WorkShift[] {
  return shifts.filter((shift) => {
    if (WORK_CODES.has(shift.segmentCode)) return true;
    // D02 (day off) is omitted — only sync work and explicit leave/holiday types.
    return ["D03", "D04", "D05", "D09", "D13", "D14", "D15", "D16"].includes(
      shift.segmentCode,
    );
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function monthKeysAround(date: Date, monthsBefore = 0, monthsAfter = 2): string[] {
  const keys: string[] = [];
  const cursor = new Date(date.getFullYear(), date.getMonth() - monthsBefore, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + monthsAfter, 1);

  while (cursor <= end) {
    keys.push(monthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function toDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}

function formatRangeLabel(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/**
 * Monday of the Mon–Sun week that contains today. Sync runs from that Monday
 * through the latest published schedule day (including this week's Sunday).
 */
export function syncRangeStart(now = new Date()): string {
  const day = now.getDay();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((day + 6) % 7));
  return toDateString(start);
}

/** @deprecated Use syncRangeStart + buildScheduleSyncRange */
export function upcomingWorkWeekRange(now = new Date()): {
  from: string;
  to: string;
  label: string;
} {
  const from = syncRangeStart(now);
  const end = new Date(`${from}T12:00:00`);
  end.setDate(end.getDate() + 6);
  const to = toDateString(end);
  return { from, to, label: formatRangeLabel(from, to) };
}

/**
 * From the sync start Monday through the latest published schedule day
 * (often two or more weeks ahead when the portal has posted that far).
 */
export function buildScheduleSyncRange(
  shifts: WorkShift[],
  now = new Date(),
): { from: string; to: string; label: string } {
  const from = syncRangeStart(now);
  const eligible = filterShiftsToRange(shifts, from, "9999-12-31");

  if (eligible.length === 0) {
    const end = new Date(`${from}T12:00:00`);
    end.setDate(end.getDate() + 6);
    const to = toDateString(end);
    return { from, to, label: formatRangeLabel(from, to) };
  }

  const to = eligible[eligible.length - 1].date;
  return { from, to, label: formatRangeLabel(from, to) };
}

export function filterShiftsToRange(
  shifts: WorkShift[],
  from: string,
  to: string,
): WorkShift[] {
  return shifts.filter((shift) => shift.date >= from && shift.date <= to);
}

export function monthKeysForRange(from: string, to: string): string[] {
  const keys = new Set<string>();
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);

  keys.add(monthKeyFromDate(cursor));
  while (cursor <= end) {
    keys.add(monthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }

  return [...keys].sort();
}
