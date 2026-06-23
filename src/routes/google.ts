import { Router } from "express";
import { getUser, updateGoogleCalendar, updateGoogleEventColor } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  GOOGLE_EVENT_COLORS,
  listWritableGoogleCalendars,
} from "../services/google-calendar.js";
import { isValidGoogleEventColorId } from "../utils/google-colors.js";

export const googleRouter = Router();

googleRouter.get("/event-colors", (_req, res) => {
  res.json({ colors: GOOGLE_EVENT_COLORS, defaultColorId: "8" });
});

googleRouter.get("/calendars", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const accessToken = user.google_access_token;
    const refreshToken = user.google_refresh_token;
    if (!accessToken || !refreshToken) {
      res.status(400).json({ error: "Google Calendar not connected" });
      return;
    }

    const calendars = await listWritableGoogleCalendars(accessToken, refreshToken);
    res.json({
      calendars,
      selectedCalendarId: user.google_calendar_id ?? "primary",
      selectedCalendarName: user.google_calendar_name,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list calendars",
    });
  }
});

googleRouter.put("/calendar", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.google_refresh_token) {
      res.status(400).json({ error: "Google Calendar not connected" });
      return;
    }

    const calendarId = typeof req.body?.calendarId === "string" ? req.body.calendarId.trim() : "";
    const calendarName =
      typeof req.body?.calendarName === "string" ? req.body.calendarName.trim() : "";

    if (!calendarId || !calendarName) {
      res.status(400).json({ error: "calendarId and calendarName are required" });
      return;
    }

    await updateGoogleCalendar(req.userId!, calendarId, calendarName);
    res.json({
      ok: true,
      calendarId,
      calendarName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save calendar",
    });
  }
});

googleRouter.put("/color", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.google_refresh_token) {
      res.status(400).json({ error: "Google Calendar not connected" });
      return;
    }

    const colorId = typeof req.body?.colorId === "string" ? req.body.colorId.trim() : "";
    if (!isValidGoogleEventColorId(colorId)) {
      res.status(400).json({ error: "Invalid event color" });
      return;
    }

    await updateGoogleEventColor(req.userId!, colorId);
    const color = GOOGLE_EVENT_COLORS.find((entry) => entry.id === colorId);
    res.json({
      ok: true,
      colorId,
      colorName: color?.name ?? "Graphite",
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save color",
    });
  }
});
