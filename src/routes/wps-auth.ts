import { Router } from "express";
import { updateWpsSession } from "../db/index.js";
import { assertEncryptionKey } from "../config.js";
import { loginWithCredentials, serializeSession } from "../services/wps-client.js";

export const wpsAuthRouter = Router();

wpsAuthRouter.post("/login/:userId", async (req, res) => {
  const { employeeNumber, password } = req.body as {
    employeeNumber?: string;
    password?: string;
  };

  if (!employeeNumber?.trim() || !password) {
    res.status(400).json({ error: "employeeNumber and password are required" });
    return;
  }

  try {
    assertEncryptionKey();
    const session = await loginWithCredentials(employeeNumber.trim(), password);
    const serialized = serializeSession(session);

    updateWpsSession(req.params.userId, {
      employeeNumber: session.employeeNumber,
      staffName: session.staffName,
      storeName: session.storeName,
      sessionCookies: serialized,
    });

    res.json({
      connected: true,
      employeeNumber: session.employeeNumber,
      staffName: session.staffName,
      storeName: session.storeName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Sign-in failed",
    });
  }
});
