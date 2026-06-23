-- Profile preferences and optional saved WPS credentials for auto re-login

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS save_employee_id BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS save_wps_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wps_saved_password TEXT;
