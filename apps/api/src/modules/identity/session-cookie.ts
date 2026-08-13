import type { Request, Response } from "express";
import type { AppConfig } from "@ardenne/config";

export const SESSION_COOKIE_NAME = "ap_session";

export function setSessionCookie(res: Response, config: AppConfig, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function readSessionToken(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE_NAME];
}
