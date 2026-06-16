import express from "express";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { userRouter } from "./routes/users.js";
import { googleAuthRouter } from "./routes/google-auth.js";
import { wpsAuthRouter } from "./routes/wps-auth.js";
import { googleRouter } from "./routes/google.js";
import { syncRouter } from "./routes/sync.js";
import { getUsersReadyToSync } from "./db/index.js";
import { scheduledThursdaySyncUserSchedule } from "./services/sync-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");

const app = express();

app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(express.static(publicDir));

app.use("/api/users", userRouter);
app.use("/auth/google", googleAuthRouter);
app.use("/auth/wps", wpsAuthRouter);
app.use("/api/sync", syncRouter);
app.use("/api/google", googleRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

for (const cronExpr of config.thursdaySyncCrons) {
  if (!cron.validate(cronExpr)) {
    console.warn(`Invalid THURSDAY_SYNC_CRONS entry skipped: ${cronExpr}`);
    continue;
  }

  cron.schedule(
    cronExpr,
    async () => {
      const users = getUsersReadyToSync();
      for (const user of users) {
        try {
          await scheduledThursdaySyncUserSchedule(user.id as string);
        } catch (error) {
          console.error(`Thursday sync failed for ${user.id}:`, error);
        }
      }
    },
    { timezone: config.syncTimezone },
  );
  console.log(`Thursday sync scheduled: ${cronExpr} (${config.syncTimezone})`);
}

app.listen(config.port, () => {
  console.log(`autaddcal running at ${config.baseUrl}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
