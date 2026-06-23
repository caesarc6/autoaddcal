import { getSupabase } from "./supabase.js";
import { decrypt, encrypt } from "../utils/crypto.js";

export interface UserRecord {
  id: string;
  created_at: string;
  google_account_id: string | null;
  google_email: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expiry: number | null;
  google_connected_at: string | null;
  google_calendar_id: string | null;
  google_calendar_name: string | null;
  google_event_color_id: string | null;
  wps_employee_number: string | null;
  wps_staff_name: string | null;
  wps_store_name: string | null;
  wps_session_cookies: string | null;
  wps_connected_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_week_sync_from: string | null;
  last_week_sync_fingerprint: string | null;
  auto_sync_enabled: boolean;
  save_employee_id: boolean;
  save_wps_password: boolean;
  wps_saved_password: string | null;
}

type DbUserRow = Omit<
  UserRecord,
  | "google_access_token"
  | "google_refresh_token"
  | "wps_session_cookies"
  | "wps_saved_password"
  | "auto_sync_enabled"
  | "save_employee_id"
  | "save_wps_password"
> & {
  google_access_token: string | null;
  google_refresh_token: string | null;
  wps_session_cookies: string | null;
  wps_saved_password: string | null;
  auto_sync_enabled: boolean | number | null;
  save_employee_id: boolean | number | null;
  save_wps_password: boolean | number | null;
};

function maybeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

function mapUser(row: DbUserRow): UserRecord {
  return {
    ...row,
    google_access_token: maybeDecrypt(row.google_access_token),
    google_refresh_token: maybeDecrypt(row.google_refresh_token),
    wps_session_cookies: maybeDecrypt(row.wps_session_cookies),
    wps_saved_password: maybeDecrypt(row.wps_saved_password),
    auto_sync_enabled: Boolean(row.auto_sync_enabled ?? true),
    save_employee_id: Boolean(row.save_employee_id ?? false),
    save_wps_password: Boolean(row.save_wps_password ?? false),
    google_calendar_id: row.google_calendar_id ?? "primary",
    google_event_color_id: row.google_event_color_id ?? "8",
  };
}

function encryptOptional(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

export async function createUser(): Promise<string> {
  const { data, error } = await getSupabase()
    .from("users")
    .insert({})
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create user");
  }

  return data.id as string;
}

export async function getUser(id: string): Promise<UserRecord | undefined> {
  const { data, error } = await getSupabase().from("users").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapUser(data as DbUserRow) : undefined;
}

export async function findUserByGoogleAccountId(
  googleAccountId: string,
): Promise<UserRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("users")
    .select("*")
    .eq("google_account_id", googleAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapUser(data as DbUserRow) : undefined;
}

export async function clearUserConnections(userId: string): Promise<void> {
  const user = await getUser(userId);

  const update: Record<string, unknown> = {
    wps_session_cookies: null,
    wps_connected_at: null,
    wps_staff_name: null,
    wps_store_name: null,
    google_access_token: null,
    google_refresh_token: null,
    google_token_expiry: null,
    google_connected_at: null,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_error: null,
    last_week_sync_from: null,
    last_week_sync_fingerprint: null,
  };

  if (!user?.save_employee_id) {
    update.wps_employee_number = null;
  }
  if (!user?.save_wps_password) {
    update.wps_saved_password = null;
  }

  const { error } = await getSupabase().from("users").update(update).eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateWpsSession(
  userId: string,
  data: {
    employeeNumber: string;
    staffName: string;
    storeName: string;
    sessionCookies: string;
  },
): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({
      wps_employee_number: data.employeeNumber,
      wps_staff_name: data.staffName,
      wps_store_name: data.storeName,
      wps_session_cookies: encryptOptional(data.sessionCookies),
      wps_connected_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateWpsCredentialPrefs(
  userId: string,
  prefs: {
    saveEmployeeId: boolean;
    savePassword: boolean;
    password?: string;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    save_employee_id: prefs.saveEmployeeId,
    save_wps_password: prefs.savePassword,
  };

  if (prefs.savePassword && prefs.password) {
    payload.wps_saved_password = encryptOptional(prefs.password);
  } else if (!prefs.savePassword) {
    payload.wps_saved_password = null;
  }

  const { error } = await getSupabase().from("users").update(payload).eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateGoogleTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiryDate: number,
  account?: { id: string; email: string },
): Promise<void> {
  const payload: Record<string, unknown> = {
    google_access_token: encryptOptional(accessToken),
    google_refresh_token: encryptOptional(refreshToken),
    google_token_expiry: expiryDate,
    google_connected_at: new Date().toISOString(),
  };

  if (account) {
    payload.google_account_id = account.id;
    payload.google_email = account.email;
  }

  const user = await getUser(userId);
  if (!user?.google_calendar_id) {
    payload.google_calendar_id = "primary";
  }

  const { error } = await getSupabase().from("users").update(payload).eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateGoogleCalendar(
  userId: string,
  calendarId: string,
  calendarName: string,
): Promise<void> {
  const user = await getUser(userId);
  const previousCalendarId = user?.google_calendar_id ?? "primary";

  const { error } = await getSupabase()
    .from("users")
    .update({
      google_calendar_id: calendarId,
      google_calendar_name: calendarName,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  if (previousCalendarId !== calendarId) {
    await clearSyncedEventsForUser(userId);
  }
}

export async function clearSyncedEventsForUser(userId: string): Promise<void> {
  const { error } = await getSupabase().from("synced_events").delete().eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateGoogleEventColor(userId: string, colorId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({ google_event_color_id: colorId })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateWeekSyncFingerprint(
  userId: string,
  weekFrom: string,
  fingerprint: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({
      last_week_sync_from: weekFrom,
      last_week_sync_fingerprint: fingerprint,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateSyncStatus(
  userId: string,
  status: "success" | "error",
  errorMessage?: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: errorMessage ?? null,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getSyncedEvent(
  userId: string,
  shiftDate: string,
): Promise<{ google_event_id: string } | undefined> {
  const { data, error } = await getSupabase()
    .from("synced_events")
    .select("google_event_id")
    .eq("user_id", userId)
    .eq("shift_date", shiftDate)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? undefined;
}

export async function upsertSyncedEvent(
  userId: string,
  shiftDate: string,
  googleEventId: string,
  segmentCode: string,
): Promise<void> {
  const { error } = await getSupabase().from("synced_events").upsert(
    {
      user_id: userId,
      shift_date: shiftDate,
      google_event_id: googleEventId,
      segment_code: segmentCode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,shift_date" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteSyncedEvent(userId: string, shiftDate: string): Promise<void> {
  const { error } = await getSupabase()
    .from("synced_events")
    .delete()
    .eq("user_id", userId)
    .eq("shift_date", shiftDate);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listSyncedDates(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("synced_events")
    .select("shift_date")
    .eq("user_id", userId)
    .gte("shift_date", fromDate)
    .lte("shift_date", toDate);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => row.shift_date as string);
}

export async function updateAutoSyncEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .update({ auto_sync_enabled: enabled })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getUsersReadyToSync(): Promise<UserRecord[]> {
  const { data, error } = await getSupabase()
    .from("users")
    .select("*")
    .not("google_refresh_token", "is", null)
    .eq("auto_sync_enabled", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => mapUser(row as DbUserRow))
    .filter(
      (user) =>
        Boolean(user.wps_session_cookies) ||
        (user.save_wps_password &&
          Boolean(user.wps_saved_password) &&
          Boolean(user.wps_employee_number)),
    );
}

export function userCanAutoSyncWps(user: UserRecord): boolean {
  return (
    Boolean(user.wps_session_cookies) ||
    (user.save_wps_password && Boolean(user.wps_saved_password) && Boolean(user.wps_employee_number))
  );
}

export function toUserResponse(user: UserRecord) {
  return {
    id: user.id,
    wps: {
      connected: Boolean(user.wps_session_cookies),
      employeeNumber: user.wps_employee_number,
      staffName: user.wps_staff_name,
      storeName: user.wps_store_name,
      connectedAt: user.wps_connected_at,
    },
    google: {
      connected: Boolean(user.google_refresh_token),
      email: user.google_email,
      connectedAt: user.google_connected_at,
      calendarId: user.google_calendar_id ?? "primary",
      calendarName: user.google_calendar_name,
      eventColorId: user.google_event_color_id ?? "8",
    },
    profile: {
      saveEmployeeId: user.save_employee_id,
      savePassword: user.save_wps_password,
      hasSavedPassword: Boolean(user.wps_saved_password),
      savedEmployeeNumber:
        user.save_employee_id && user.wps_employee_number ? user.wps_employee_number : null,
    },
    sync: {
      lastSyncAt: user.last_sync_at,
      lastSyncStatus: user.last_sync_status,
      lastSyncError: user.last_sync_error,
      autoSyncEnabled: user.auto_sync_enabled,
    },
  };
}
