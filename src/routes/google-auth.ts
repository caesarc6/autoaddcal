import { Router } from "express";
import {
  createUser,
  findUserByGoogleAccountId,
  getUser,
  updateGoogleTokens,
} from "../db/index.js";
import { assertGoogleConfig } from "../config.js";
import {
  exchangeGoogleCode,
  fetchGoogleAccount,
  getGoogleAuthUrl,
} from "../services/google-calendar.js";

export const googleAuthRouter = Router();

googleAuthRouter.get("/login", (_req, res) => {
  try {
    assertGoogleConfig();
    res.redirect(getGoogleAuthUrl());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Google OAuth not configured",
    });
  }
});

/** @deprecated Use /auth/google/login */
googleAuthRouter.get("/connect/:userId", (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    assertGoogleConfig();
    res.redirect(getGoogleAuthUrl(req.params.userId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Google OAuth not configured",
    });
  }
});

googleAuthRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const legacyUserId = req.query.state as string | undefined;

  if (!code) {
    res.status(400).send("Missing OAuth code");
    return;
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const account = await fetchGoogleAccount(tokens.accessToken);

    let userId: string | undefined;
    const existing = findUserByGoogleAccountId(account.id);
    if (existing) {
      userId = existing.id as string;
    } else if (legacyUserId && legacyUserId !== "login") {
      const legacyUser = getUser(legacyUserId);
      userId = legacyUser ? legacyUserId : undefined;
    }

    if (!userId) {
      userId = createUser();
    }

    updateGoogleTokens(
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiryDate,
      account,
    );
    res.redirect(`/?user=${userId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google OAuth failed";
    res.redirect(`/?google=error&message=${encodeURIComponent(message)}`);
  }
});
