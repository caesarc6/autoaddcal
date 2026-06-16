import {
  fetchCalendarMonth,
  sessionFromStored,
  validateSession,
  type WpsSession,
} from "./wps-client.js";
import { syncShiftsToGoogle } from "./google-calendar.js";
import { getUser, updateSyncStatus, updateWeekSyncFingerprint } from "../db/index.js";
import {
  buildScheduleSyncRange,
  filterShiftsToRange,
  mapCalendarDay,
  monthKeysAround,
  shiftsToSync,
  syncRangeStart,
} from "../utils/shift-mapper.js";
import type { SchedulePreview, SyncResult, WorkShift } from "../types/index.js";

const WORK_CODES = new Set(["D01", "D08", "D10", "D11", "D12"]);
const DAY_OFF_CODES = new Set(["D02", "D03", "D04", "D05", "D09", "D13", "D14", "D15", "D16"]);

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toPreviewShift(shift: WorkShift) {
  return {
    date: shift.date,
    title: shift.title,
    segmentCode: shift.segmentCode,
    allDay: shift.allDay,
    startTime: shift.start ? formatTime(shift.start) : null,
    endTime: shift.end ? formatTime(shift.end) : null,
  };
}

function summarizeShifts(shifts: WorkShift[]) {
  let work = 0;
  let dayOff = 0;
  let other = 0;

  for (const shift of shifts) {
    if (WORK_CODES.has(shift.segmentCode)) work++;
    else if (DAY_OFF_CODES.has(shift.segmentCode)) dayOff++;
    else other++;
  }

  return { work, dayOff, other, total: shifts.length };
}

export function shiftFingerprint(shifts: WorkShift[]): string {
  return shifts
    .map((shift) => {
      const start = shift.start?.getTime() ?? 0;
      const end = shift.end?.getTime() ?? 0;
      return `${shift.date}:${shift.segmentCode}:${start}:${end}:${shift.title}`;
    })
    .join("|");
}

async function loadWpsSession(userId: string): Promise<WpsSession> {
  const user = getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const wpsCookies = user.wps_session_cookies as string | null;
  if (!wpsCookies) {
    throw new Error("Work schedule not connected. Sign in with your employee ID.");
  }

  let session: WpsSession;
  try {
    session = await sessionFromStored(wpsCookies);
  } catch (error) {
    throw new Error(
      `Your session expired. Please sign in again. (${error instanceof Error ? error.message : "unknown"})`,
    );
  }

  const valid = await validateSession(session.cookieHeader);
  if (!valid) {
    throw new Error("Your session expired. Please sign in again.");
  }

  return session;
}

async function fetchShiftsFromWps(
  session: WpsSession,
  now = new Date(),
): Promise<{ shifts: WorkShift[]; weekRange: ReturnType<typeof buildScheduleSyncRange> }> {
  const from = syncRangeStart(now);
  const months = monthKeysAround(new Date(`${from}T12:00:00`), 0, 2);
  const allShifts: WorkShift[] = [];

  for (const month of months) {
    const data = await fetchCalendarMonth(session.context, month);
    const monthKey = month.slice(0, 7);
    for (const day of data.calendarList ?? []) {
      allShifts.push(mapCalendarDay(day, monthKey));
    }
  }

  allShifts.sort((a, b) => a.date.localeCompare(b.date));
  const syncable = shiftsToSync(allShifts);
  const weekRange = buildScheduleSyncRange(syncable, now);
  const shifts = filterShiftsToRange(syncable, weekRange.from, weekRange.to);

  return { shifts, weekRange };
}

export async function previewUserSchedule(userId: string): Promise<SchedulePreview> {
  const session = await loadWpsSession(userId);
  const { shifts, weekRange } = await fetchShiftsFromWps(session);

  return {
    staffName: session.staffName,
    storeName: session.storeName,
    weekRange,
    summary: summarizeShifts(shifts),
    shifts: shifts.map(toPreviewShift),
  };
}

async function pushShiftsToGoogle(
  userId: string,
  shifts: WorkShift[],
  weekRange: ReturnType<typeof buildScheduleSyncRange>,
): Promise<SyncResult> {
  const user = getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const googleRefresh = user.google_refresh_token as string | null;
  const googleAccess = user.google_access_token as string | null;

  if (!googleRefresh || !googleAccess) {
    throw new Error("Google Calendar not connected");
  }

  const calendarId = (user.google_calendar_id as string | null) ?? "primary";
  const colorId = (user.google_event_color_id as string | null) ?? "8";

  try {
    const result = await syncShiftsToGoogle(
      userId,
      googleAccess,
      googleRefresh,
      shifts,
      calendarId,
      colorId,
    );
    updateSyncStatus(userId, "success");
    updateWeekSyncFingerprint(userId, weekRange.from, shiftFingerprint(shifts));
    console.log(
      `Synced ${shifts.length} shifts for ${userId} (${weekRange.label})`,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    updateSyncStatus(userId, "error", message);
    throw error;
  }
}

/** Manual sync — always pushes to Google Calendar. */
export async function syncUserSchedule(userId: string): Promise<SyncResult> {
  const session = await loadWpsSession(userId);
  const { shifts, weekRange } = await fetchShiftsFromWps(session);
  return pushShiftsToGoogle(userId, shifts, weekRange);
}

/**
 * Thursday auto-sync — re-checks WPS up to 4 times; skips if the week
 * already matches what was last synced (stops retrying once updated).
 */
export async function scheduledThursdaySyncUserSchedule(
  userId: string,
): Promise<{ synced: boolean; reason: string }> {
  const user = getUser(userId);
  if (!user) {
    return { synced: false, reason: "user not found" };
  }

  const session = await loadWpsSession(userId);
  const { shifts, weekRange } = await fetchShiftsFromWps(session);
  const fingerprint = shiftFingerprint(shifts);
  const lastFrom = user.last_week_sync_from as string | null;
  const lastFingerprint = user.last_week_sync_fingerprint as string | null;

  if (lastFrom === weekRange.from && lastFingerprint === fingerprint) {
    const reason = `schedule unchanged for ${weekRange.label}`;
    console.log(`Thursday sync skipped for ${userId}: ${reason}`);
    return { synced: false, reason };
  }

  await pushShiftsToGoogle(userId, shifts, weekRange);
  return { synced: true, reason: `synced ${weekRange.label}` };
}
