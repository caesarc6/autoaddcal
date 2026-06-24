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
import { cronRouter } from "./routes/cron.js";
import { getUsersReadyToSync } from "./db/index.js";
import { scheduledThursdaySyncUserSchedule } from "./services/sync-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.VERCEL
  ? join(process.cwd(), "public")
  : join(__dirname, "../public");

const app = express();

app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(express.static(publicDir));

app.use("/api/users", userRouter);
app.use("/auth/google", googleAuthRouter);
app.use("/auth/wps", wpsAuthRouter);
app.use("/api/sync", syncRouter);
app.use("/api/google", googleRouter);
app.use("/api/cron", cronRouter);

app.get("/health", (_req, res) => {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    res.status(503).json({ ok: false, missing });
    return;
  }
  res.json({ ok: true });
});

if (!process.env.VERCEL) {
  for (const cronExpr of config.thursdaySyncCrons) {
    if (!cron.validate(cronExpr)) {
      console.warn(`Invalid THURSDAY_SYNC_CRONS entry skipped: ${cronExpr}`);
      continue;
    }

    cron.schedule(
      cronExpr,
      async () => {
        const users = await getUsersReadyToSync();
        for (const user of users) {
          try {
            await scheduledThursdaySyncUserSchedule(user.id);
          } catch (error) {
            console.error(`Thursday sync failed for ${user.id}:`, error);
          }
        }
      },
      { timezone: config.syncTimezone },
    );
    console.log(`Thursday sync scheduled: ${cronExpr} (${config.syncTimezone})`);
  }
}

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/auth")) {
    next();
    return;
  }

  res.sendFile(join(publicDir, "index.html"), (error) => {
    if (error) next(error);
  });
});

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`autaddcal running at ${config.baseUrl}`);
  });
}

export default app;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
