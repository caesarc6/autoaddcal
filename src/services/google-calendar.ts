import { google } from "googleapis";
import { config } from "../config.js";
import type { SyncResult, WorkShift } from "../types/index.js";
import {
  deleteSyncedEvent,
  getSyncedEvent,
  listSyncedDates,
  upsertSyncedEvent,
} from "../db/index.js";

export interface GoogleCalendarOption {
  id: string;
  name: string;
  primary: boolean;
  accessRole: string;
}

import {
  DEFAULT_GOOGLE_EVENT_COLOR_ID,
  GOOGLE_EVENT_COLORS,
  isValidGoogleEventColorId,
} from "../utils/google-colors.js";

export { GOOGLE_EVENT_COLORS, DEFAULT_GOOGLE_EVENT_COLOR_ID };

const EVENT_SOURCE = "autaddcal-wps";
const DEFAULT_TIME_ZONE = "America/New_York";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function oauthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function getGoogleAuthUrl(state = "login"): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function fetchGoogleAccount(
  accessToken: string,
): Promise<{ id: string; email: string }> {
  const auth = oauthClient();
  auth.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    throw new Error("Google account info unavailable");
  }
  return { id: data.id, email: data.email };
}

export async function exchangeGoogleCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiryDate: number }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google OAuth did not return required tokens");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? Date.now() + 3600_000,
  };
}

async function calendarClient(accessToken: string, refreshToken: string) {
  const auth = oauthClient();
  auth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.calendar({ version: "v3", auth });
}

export async function listWritableGoogleCalendars(
  accessToken: string,
  refreshToken: string,
): Promise<GoogleCalendarOption[]> {
  const calendar = await calendarClient(accessToken, refreshToken);
  const response = await calendar.calendarList.list({ minAccessRole: "writer" });
  const entries = response.data.items ?? [];

  return entries
    .filter((entry) => entry.id && entry.summary)
    .map((entry) => ({
      id: entry.id!,
      name: entry.summary!,
      primary: Boolean(entry.primary),
      accessRole: entry.accessRole ?? "reader",
    }))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function eventBody(shift: WorkShift, colorId: string) {
  const extendedProperties = {
    private: {
      source: EVENT_SOURCE,
      segmentCode: shift.segmentCode,
      shiftDate: shift.date,
    },
  };

  const color = { colorId };

  if (shift.allDay || !shift.start || !shift.end) {
    const nextDay = new Date(`${shift.date}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      summary: shift.title,
      description: shift.description,
      start: { date: shift.date },
      end: { date: nextDay.toISOString().slice(0, 10) },
      extendedProperties,
      ...color,
    };
  }

  return {
    summary: shift.title,
    description: shift.description,
    start: {
      dateTime: formatLocalDateTime(shift.start),
      timeZone: DEFAULT_TIME_ZONE,
    },
    end: {
      dateTime: formatLocalDateTime(shift.end),
      timeZone: DEFAULT_TIME_ZONE,
    },
    extendedProperties,
    ...color,
  };
}

export async function syncShiftsToGoogle(
  userId: string,
  accessToken: string,
  refreshToken: string,
  shifts: WorkShift[],
  calendarId = "primary",
  colorId = DEFAULT_GOOGLE_EVENT_COLOR_ID,
): Promise<SyncResult> {
  const calendar = await calendarClient(accessToken, refreshToken);
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  const eventColorId = isValidGoogleEventColorId(colorId)
    ? colorId
    : DEFAULT_GOOGLE_EVENT_COLOR_ID;

  const incomingDates = new Set(shifts.map((s) => s.date));
  const fromDate = shifts[0]?.date;
  const toDate = shifts[shifts.length - 1]?.date;

  if (fromDate && toDate) {
    const existingDates = await listSyncedDates(userId, fromDate, toDate);
    for (const date of existingDates) {
      if (!incomingDates.has(date)) {
        const synced = await getSyncedEvent(userId, date);
        if (synced) {
          try {
            await calendar.events.delete({
              calendarId,
              eventId: synced.google_event_id,
            });
            await deleteSyncedEvent(userId, date);
            result.deleted++;
          } catch {
            result.skipped++;
          }
        }
      }
    }
  }

  for (const shift of shifts) {
    const existing = await getSyncedEvent(userId, shift.date);
    const body = eventBody(shift, eventColorId);

    try {
      if (existing) {
        await calendar.events.update({
          calendarId,
          eventId: existing.google_event_id,
          requestBody: body,
        });
        await upsertSyncedEvent(userId, shift.date, existing.google_event_id, shift.segmentCode);
        result.updated++;
      } else {
        const created = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
        if (!created.data.id) {
          result.skipped++;
          continue;
        }
        await upsertSyncedEvent(userId, shift.date, created.data.id, shift.segmentCode);
        result.created++;
      }
    } catch {
      result.skipped++;
    }
  }

  return result;
}
