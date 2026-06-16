import { Router } from "express";
import {
  clearUserConnections,
  createUser,
  getUser,
  updateAutoSyncEnabled,
} from "../db/index.js";
import { config } from "../config.js";

export const userRouter = Router();

userRouter.post("/", (_req, res) => {
  const id = createUser();
  res.json({ id });
});

userRouter.get("/:id", (req, res) => {
  const user = getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
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
      email: (user.google_email as string | null) ?? null,
      connectedAt: user.google_connected_at,
      calendarId: (user.google_calendar_id as string | null) ?? "primary",
      calendarName: (user.google_calendar_name as string | null) ?? null,
      eventColorId: (user.google_event_color_id as string | null) ?? "8",
    },
    sync: {
      lastSyncAt: user.last_sync_at,
      lastSyncStatus: user.last_sync_status,
      lastSyncError: user.last_sync_error,
      autoSyncEnabled: Boolean(user.auto_sync_enabled ?? 1),
    },
  });
});

userRouter.post("/:id/logout", (req, res) => {
  const user = getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  clearUserConnections(req.params.id);
  res.json({ ok: true });
});

userRouter.put("/:id/auto-sync", (req, res) => {
  const user = getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }

  updateAutoSyncEnabled(req.params.id, enabled);
  res.json({ ok: true, enabled });
});

userRouter.get("/:id/status", (req, res) => {
  const user = getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const ready =
    Boolean(user.wps_session_cookies) && Boolean(user.google_refresh_token);

  res.json({
    ready,
    baseUrl: config.baseUrl,
    wpsConnected: Boolean(user.wps_session_cookies),
    googleConnected: Boolean(user.google_refresh_token),
  });
});
