import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createUserId } from "../utils/crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.VERCEL
  ? join(tmpdir(), "autaddcal.db")
  : join(__dirname, "../../data/autaddcal.db");

mkdirSync(dirname(dbPath), { recursive: true });

const database = new Database(dbPath);
export const db: Database.Database = database;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    wps_employee_number TEXT,
    wps_staff_name TEXT,
    wps_store_name TEXT,
    wps_session_cookies TEXT,
    wps_connected_at TEXT,
    google_access_token TEXT,
    google_refresh_token TEXT,
    google_token_expiry INTEGER,
    google_connected_at TEXT,
    last_sync_at TEXT,
    last_sync_status TEXT,
    last_sync_error TEXT
  );

  CREATE TABLE IF NOT EXISTS synced_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    google_event_id TEXT NOT NULL,
    segment_code TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, shift_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_synced_events_user ON synced_events(user_id);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "google_calendar_id", "TEXT DEFAULT 'primary'");
ensureColumn("users", "google_calendar_name", "TEXT");
ensureColumn("users", "google_event_color_id", "TEXT DEFAULT '8'");
ensureColumn("users", "last_week_sync_from", "TEXT");
ensureColumn("users", "last_week_sync_fingerprint", "TEXT");
ensureColumn("users", "auto_sync_enabled", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("users", "google_account_id", "TEXT");
ensureColumn("users", "google_email", "TEXT");

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_account_id
  ON users(google_account_id)
  WHERE google_account_id IS NOT NULL
`);

export function createUser(): string {
  const id = createUserId();
  db.prepare("INSERT INTO users (id) VALUES (?)").run(id);
  return id;
}

export function getUser(id: string) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
}

export function listUsers() {
  return db
    .prepare(
      `SELECT id, created_at, wps_employee_number, wps_staff_name, wps_store_name,
              wps_connected_at, google_connected_at, last_sync_at, last_sync_status, last_sync_error
       FROM users ORDER BY created_at DESC`,
    )
    .all();
}

export function clearUserConnections(userId: string): void {
  db.prepare(
    `UPDATE users SET
      wps_employee_number = NULL,
      wps_staff_name = NULL,
      wps_store_name = NULL,
      wps_session_cookies = NULL,
      wps_connected_at = NULL,
      google_access_token = NULL,
      google_refresh_token = NULL,
      google_token_expiry = NULL,
      google_connected_at = NULL,
      google_account_id = NULL,
      google_email = NULL,
      google_calendar_id = 'primary',
      google_calendar_name = NULL,
      google_event_color_id = '8',
      last_sync_at = NULL,
      last_sync_status = NULL,
      last_sync_error = NULL,
      last_week_sync_from = NULL,
      last_week_sync_fingerprint = NULL,
      auto_sync_enabled = 1
     WHERE id = ?`,
  ).run(userId);
  clearSyncedEventsForUser(userId);
}

export function updateWpsSession(
  userId: string,
  data: {
    employeeNumber: string;
    staffName: string;
    storeName: string;
    sessionCookies: string;
  },
): void {
  db.prepare(
    `UPDATE users SET
      wps_employee_number = ?,
      wps_staff_name = ?,
      wps_store_name = ?,
      wps_session_cookies = ?,
      wps_connected_at = datetime('now')
     WHERE id = ?`,
  ).run(
    data.employeeNumber,
    data.staffName,
    data.storeName,
    data.sessionCookies,
    userId,
  );
}

export function findUserByGoogleAccountId(googleAccountId: string) {
  return db
    .prepare("SELECT * FROM users WHERE google_account_id = ?")
    .get(googleAccountId) as Record<string, unknown> | undefined;
}

export function updateGoogleTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiryDate: number,
  account?: { id: string; email: string },
): void {
  if (account) {
    db.prepare(
      `UPDATE users SET
        google_access_token = ?,
        google_refresh_token = ?,
        google_token_expiry = ?,
        google_connected_at = datetime('now'),
        google_account_id = ?,
        google_email = ?,
        google_calendar_id = COALESCE(google_calendar_id, 'primary')
       WHERE id = ?`,
    ).run(
      accessToken,
      refreshToken,
      expiryDate,
      account.id,
      account.email,
      userId,
    );
    return;
  }

  db.prepare(
    `UPDATE users SET
      google_access_token = ?,
      google_refresh_token = ?,
      google_token_expiry = ?,
      google_connected_at = datetime('now'),
      google_calendar_id = COALESCE(google_calendar_id, 'primary')
     WHERE id = ?`,
  ).run(accessToken, refreshToken, expiryDate, userId);
}

export function updateGoogleCalendar(
  userId: string,
  calendarId: string,
  calendarName: string,
): void {
  const user = getUser(userId);
  const previousCalendarId =
    (user?.google_calendar_id as string | null | undefined) ?? "primary";

  db.prepare(
    `UPDATE users SET
      google_calendar_id = ?,
      google_calendar_name = ?
     WHERE id = ?`,
  ).run(calendarId, calendarName, userId);

  if (previousCalendarId !== calendarId) {
    clearSyncedEventsForUser(userId);
  }
}

export function clearSyncedEventsForUser(userId: string): void {
  db.prepare("DELETE FROM synced_events WHERE user_id = ?").run(userId);
}

export function updateGoogleEventColor(userId: string, colorId: string): void {
  db.prepare(
    `UPDATE users SET google_event_color_id = ? WHERE id = ?`,
  ).run(colorId, userId);
}

export function updateWeekSyncFingerprint(
  userId: string,
  weekFrom: string,
  fingerprint: string,
): void {
  db.prepare(
    `UPDATE users SET
      last_week_sync_from = ?,
      last_week_sync_fingerprint = ?
     WHERE id = ?`,
  ).run(weekFrom, fingerprint, userId);
}

export function updateSyncStatus(
  userId: string,
  status: "success" | "error",
  error?: string,
): void {
  db.prepare(
    `UPDATE users SET
      last_sync_at = datetime('now'),
      last_sync_status = ?,
      last_sync_error = ?
     WHERE id = ?`,
  ).run(status, error ?? null, userId);
}

export function getSyncedEvent(userId: string, shiftDate: string) {
  return db
    .prepare("SELECT * FROM synced_events WHERE user_id = ? AND shift_date = ?")
    .get(userId, shiftDate) as { google_event_id: string } | undefined;
}

export function upsertSyncedEvent(
  userId: string,
  shiftDate: string,
  googleEventId: string,
  segmentCode: string,
): void {
  db.prepare(
    `INSERT INTO synced_events (user_id, shift_date, google_event_id, segment_code)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, shift_date) DO UPDATE SET
       google_event_id = excluded.google_event_id,
       segment_code = excluded.segment_code,
       updated_at = datetime('now')`,
  ).run(userId, shiftDate, googleEventId, segmentCode);
}

export function deleteSyncedEvent(userId: string, shiftDate: string): void {
  db.prepare("DELETE FROM synced_events WHERE user_id = ? AND shift_date = ?").run(
    userId,
    shiftDate,
  );
}

export function listSyncedDates(userId: string, fromDate: string, toDate: string): string[] {
  const rows = db
    .prepare(
      `SELECT shift_date FROM synced_events
       WHERE user_id = ? AND shift_date >= ? AND shift_date <= ?`,
    )
    .all(userId, fromDate, toDate) as Array<{ shift_date: string }>;
  return rows.map((r) => r.shift_date);
}

export function updateAutoSyncEnabled(userId: string, enabled: boolean): void {
  db.prepare(`UPDATE users SET auto_sync_enabled = ? WHERE id = ?`).run(
    enabled ? 1 : 0,
    userId,
  );
}

export function getUsersReadyToSync() {
  return db
    .prepare(
      `SELECT * FROM users
       WHERE wps_session_cookies IS NOT NULL
         AND google_refresh_token IS NOT NULL
         AND auto_sync_enabled = 1`,
    )
    .all() as Array<Record<string, unknown>>;
}
