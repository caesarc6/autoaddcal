import { Router } from "express";
import { getUsersReadyToSync } from "../db/index.js";
import { requireAuth, requireCronSecret } from "../middleware/auth.js";
import { previewUserSchedule, syncUserSchedule } from "../services/sync-service.js";

export const syncRouter = Router();

syncRouter.get("/preview", requireAuth, async (req, res) => {
  try {
    const preview = await previewUserSchedule(req.userId!);
    res.json({ ok: true, preview });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Preview failed",
    });
  }
});

syncRouter.post("/", requireAuth, async (req, res) => {
  try {
    const result = await syncUserSchedule(req.userId!);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    });
  }
});

/** Sync all connected users — cron / ops only */
syncRouter.post("/all", requireCronSecret, async (_req, res) => {
  const users = await getUsersReadyToSync();
  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];

  for (const user of users) {
    try {
      await syncUserSchedule(user.id);
      results.push({ userId: user.id, ok: true });
    } catch (error) {
      results.push({
        userId: user.id,
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  res.json({ synced: results.filter((r) => r.ok).length, results });
});
