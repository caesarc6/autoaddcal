import { Router } from "express";
import { getUsersReadyToSync } from "../db/index.js";
import { previewUserSchedule, syncUserSchedule } from "../services/sync-service.js";

export const syncRouter = Router();

syncRouter.get("/:userId/preview", async (req, res) => {
  try {
    const preview = await previewUserSchedule(req.params.userId);
    res.json({ ok: true, preview });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Preview failed",
    });
  }
});

syncRouter.post("/:userId", async (req, res) => {
  try {
    const result = await syncUserSchedule(req.params.userId);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    });
  }
});

syncRouter.post("/", async (_req, res) => {
  const users = getUsersReadyToSync();
  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];

  for (const user of users) {
    const userId = user.id as string;
    try {
      await syncUserSchedule(userId);
      results.push({ userId, ok: true });
    } catch (error) {
      results.push({
        userId,
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  res.json({ synced: results.filter((r) => r.ok).length, results });
});
