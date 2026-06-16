import { Router } from "express";
import { getUser, updateGoogleCalendar, updateGoogleEventColor } from "../db/index.js";
import {
  GOOGLE_EVENT_COLORS,
  listWritableGoogleCalendars,
} from "../services/google-calendar.js";
import { isValidGoogleEventColorId } from "../utils/google-colors.js";

export const googleRouter = Router();

googleRouter.get("/event-colors", (_req, res) => {
  res.json({ colors: GOOGLE_EVENT_COLORS, defaultColorId: "8" });
});

googleRouter.get("/:userId/calendars", async (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const accessToken = user.google_access_token as string | null;
  const refreshToken = user.google_refresh_token as string | null;
  if (!accessToken || !refreshToken) {
    res.status(400).json({ error: "Google Calendar not connected" });
    return;
  }

  try {
    const calendars = await listWritableGoogleCalendars(accessToken, refreshToken);
    res.json({
      calendars,
      selectedCalendarId: (user.google_calendar_id as string | null) ?? "primary",
      selectedCalendarName: (user.google_calendar_name as string | null) ?? null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list calendars",
    });
  }
});

googleRouter.put("/:userId/calendar", (req, res) => {
  const user = getUser(req.params.userId);
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

  updateGoogleCalendar(req.params.userId, calendarId, calendarName);
  res.json({
    ok: true,
    calendarId,
    calendarName,
  });
});

googleRouter.put("/:userId/color", (req, res) => {
  const user = getUser(req.params.userId);
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

  updateGoogleEventColor(req.params.userId, colorId);
  const color = GOOGLE_EVENT_COLORS.find((entry) => entry.id === colorId);
  res.json({
    ok: true,
    colorId,
    colorName: color?.name ?? "Graphite",
  });
});
