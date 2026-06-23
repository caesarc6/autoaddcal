import { Router } from "express";
import { getUsersReadyToSync } from "../db/index.js";
import { requireCronSecret } from "../middleware/auth.js";
import { scheduledThursdaySyncUserSchedule } from "../services/sync-service.js";

export const cronRouter = Router();

cronRouter.get("/thursday-sync", requireCronSecret, async (_req, res) => {
  const users = await getUsersReadyToSync();
  const results: Array<{ userId: string; synced: boolean; reason: string }> = [];

  for (const user of users) {
    try {
      const outcome = await scheduledThursdaySyncUserSchedule(user.id);
      results.push({ userId: user.id, ...outcome });
    } catch (error) {
      results.push({
        userId: user.id,
        synced: false,
        reason: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  res.json({
    ok: true,
    usersChecked: users.length,
    synced: results.filter((r) => r.synced).length,
    results,
  });
});
