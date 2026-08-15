import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "@ardenne/config";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { IdentityService } from "./identity.service.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie.js";
import { requireAuth } from "../../http/auth-middleware.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });
const resendVerificationSchema = z.object({ email: z.string().email() });
const forgotPasswordSchema = z.object({ email: z.string().email() });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(1) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

function parseOrThrow<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return result.data;
}

export function createIdentityRouter(identityService: IdentityService, config: AppConfig): Router {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const input = parseOrThrow(registerSchema, req.body);
      const user = await identityService.register(input);
      res.status(201).json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  router.post("/verify-email", async (req, res, next) => {
    try {
      const { token } = parseOrThrow(verifyEmailSchema, req.body);
      const user = await identityService.verifyEmail(token);
      res.status(200).json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  router.post("/verify-email/resend", async (req, res, next) => {
    try {
      const { email } = parseOrThrow(resendVerificationSchema, req.body);
      await identityService.resendVerificationEmail(email);
      // Réponse identique quel que soit l'état réel du compte (anti-énumération).
      res.status(202).json({ data: { accepted: true } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const input = parseOrThrow(loginSchema, req.body);
      const result = await identityService.login({
        ...input,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      setSessionCookie(res, config, result.sessionToken, result.expiresAt);
      res.status(200).json({ data: result.user });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) await identityService.logout(token);
      clearSessionCookie(res);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout-all", requireAuth, async (req, res, next) => {
    try {
      await identityService.logoutAll(req.authUser!.id);
      clearSessionCookie(res);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/password/forgot", async (req, res, next) => {
    try {
      const { email } = parseOrThrow(forgotPasswordSchema, req.body);
      await identityService.requestPasswordReset(email);
      res.status(202).json({ data: { accepted: true } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/password/reset", async (req, res, next) => {
    try {
      const { token, newPassword } = parseOrThrow(resetPasswordSchema, req.body);
      await identityService.resetPassword(token, newPassword);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ data: req.authUser });
  });

  /** Changement de mot de passe authentifié (CDC §54 écran 18) — distinct de `/password/reset` (jeton par e-mail). */
  router.post("/password/change", requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, req.body);
      await identityService.changePassword(req.authUser!.id, currentPassword, newPassword);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
