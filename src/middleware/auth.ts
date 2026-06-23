import type { CookieOptions, Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export const SESSION_COOKIE = "autaddcal_uid";

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    signed: true,
    secure: config.baseUrl.startsWith("https"),
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  };
}

export function setSessionUser(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, userId, sessionCookieOptions());
}

export function clearSessionUser(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

export function getSessionUserId(req: Request): string | undefined {
  const value = req.signedCookies?.[SESSION_COOKIE];
  return typeof value === "string" ? value : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.userId = userId;
  next();
}

export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = config.cronSecret;
  if (!secret) {
    res.status(503).json({ error: "Cron is not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const headerSecret = req.headers["x-cron-secret"];

  if (bearer !== secret && headerSecret !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
