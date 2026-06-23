import { Router } from "express";
import {
  clearUserConnections,
  getUser,
  toUserResponse,
  updateAutoSyncEnabled,
  updateWpsCredentialPrefs,
  userCanAutoSyncWps,
} from "../db/index.js";
import { config } from "../config.js";
import { clearSessionUser, requireAuth } from "../middleware/auth.js";

export const userRouter = Router();

userRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(toUserResponse(user));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load user",
    });
  }
});

userRouter.post("/logout", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await clearUserConnections(req.userId!);
    clearSessionUser(res);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Logout failed",
    });
  }
});

userRouter.put("/me/auto-sync", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    await updateAutoSyncEnabled(req.userId!, enabled);
    res.json({ ok: true, enabled });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update auto-sync",
    });
  }
});

userRouter.put("/me/profile", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const saveEmployeeId =
      typeof req.body?.saveEmployeeId === "boolean" ? req.body.saveEmployeeId : undefined;
    const savePassword =
      typeof req.body?.savePassword === "boolean" ? req.body.savePassword : undefined;
    const password = typeof req.body?.password === "string" ? req.body.password : undefined;

    if (saveEmployeeId === undefined && savePassword === undefined) {
      res.status(400).json({ error: "No profile fields to update" });
      return;
    }

    if (savePassword && !password && !user.wps_saved_password) {
      res.status(400).json({ error: "password is required when enabling saved password" });
      return;
    }

    await updateWpsCredentialPrefs(req.userId!, {
      saveEmployeeId: saveEmployeeId ?? user.save_employee_id,
      savePassword: savePassword ?? user.save_wps_password,
      password: savePassword ? password : undefined,
    });

    const updated = await getUser(req.userId!);
    res.json({ ok: true, profile: toUserResponse(updated!).profile });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update profile",
    });
  }
});

userRouter.get("/me/status", requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      ready:
        userCanAutoSyncWps(user) && Boolean(user.google_refresh_token),
      baseUrl: config.baseUrl,
      wpsConnected: Boolean(user.wps_session_cookies),
      googleConnected: Boolean(user.google_refresh_token),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load status",
    });
  }
});
