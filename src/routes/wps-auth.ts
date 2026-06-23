import { Router } from "express";
import { updateWpsCredentialPrefs, updateWpsSession } from "../db/index.js";
import { assertEncryptionKey } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { loginWithCredentials, serializeSession } from "../services/wps-client.js";

export const wpsAuthRouter = Router();

wpsAuthRouter.post("/login", requireAuth, async (req, res) => {
  const { employeeNumber, password, saveEmployeeId, savePassword } = req.body as {
    employeeNumber?: string;
    password?: string;
    saveEmployeeId?: boolean;
    savePassword?: boolean;
  };

  if (!employeeNumber?.trim() || !password) {
    res.status(400).json({ error: "employeeNumber and password are required" });
    return;
  }

  try {
    assertEncryptionKey();
    const session = await loginWithCredentials(employeeNumber.trim(), password);
    const serialized = serializeSession(session);

    await updateWpsSession(req.userId!, {
      employeeNumber: session.employeeNumber,
      staffName: session.staffName,
      storeName: session.storeName,
      sessionCookies: serialized,
    });

    await updateWpsCredentialPrefs(req.userId!, {
      saveEmployeeId: Boolean(saveEmployeeId),
      savePassword: Boolean(savePassword),
      password: savePassword ? password : undefined,
    });

    res.json({
      connected: true,
      employeeNumber: session.employeeNumber,
      staffName: session.staffName,
      storeName: session.storeName,
      profile: {
        saveEmployeeId: Boolean(saveEmployeeId),
        savePassword: Boolean(savePassword),
        hasSavedPassword: Boolean(savePassword),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Sign-in failed",
    });
  }
});

/** @deprecated Use POST /auth/wps/login with session cookie */
wpsAuthRouter.post("/login/:userId", async (req, res) => {
  res.status(410).json({
    error: "This endpoint is deprecated. Sign in with Google first, then connect WPS.",
  });
});
