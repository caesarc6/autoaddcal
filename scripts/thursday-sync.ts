/**
 * Standalone Thursday sync — run locally or in GitHub Actions (Playwright works there).
 * Uses the same logic as GET /api/cron/thursday-sync on Vercel.
 */
import { assertSupabaseConfig } from "../src/config.js";
import { getUsersReadyToSync } from "../src/db/index.js";
import { scheduledThursdaySyncUserSchedule } from "../src/services/sync-service.js";

assertSupabaseConfig();

const users = await getUsersReadyToSync();
const results: Array<{ userId: string; synced: boolean; reason: string }> = [];

for (const user of users) {
  try {
    const outcome = await scheduledThursdaySyncUserSchedule(user.id);
    results.push({ userId: user.id, ...outcome });
    console.log(`[${user.id}] synced=${outcome.synced} — ${outcome.reason}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Sync failed";
    results.push({ userId: user.id, synced: false, reason });
    console.error(`[${user.id}] failed — ${reason}`);
  }
}

const synced = results.filter((r) => r.synced).length;
console.log(JSON.stringify({ ok: true, usersChecked: users.length, synced, results }, null, 2));

if (results.some((r) => !r.synced && !r.reason.includes("unchanged"))) {
  process.exitCode = 1;
}
