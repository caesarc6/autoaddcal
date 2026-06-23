-- Run in Supabase SQL Editor (Dashboard → SQL → New query)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  google_account_id TEXT UNIQUE,
  google_email TEXT,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry BIGINT,
  google_connected_at TIMESTAMPTZ,
  google_calendar_id TEXT DEFAULT 'primary',
  google_calendar_name TEXT,
  google_event_color_id TEXT DEFAULT '8',
  wps_employee_number TEXT,
  wps_staff_name TEXT,
  wps_store_name TEXT,
  wps_session_cookies TEXT,
  wps_connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  last_week_sync_from TEXT,
  last_week_sync_fingerprint TEXT,
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS synced_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  google_event_id TEXT NOT NULL,
  segment_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_synced_events_user ON synced_events(user_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE synced_events ENABLE ROW LEVEL SECURITY;

-- Server uses service role key; block anon/authenticated direct access.
CREATE POLICY "service_role_only_users" ON users
  FOR ALL USING (false);

CREATE POLICY "service_role_only_synced_events" ON synced_events
  FOR ALL USING (false);
