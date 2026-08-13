import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens opaques à usage unique (vérification e-mail, reset mot de passe,
 * sessions). Seul le hash SHA-256 est stocké en base ; le token brut n'existe
 * que le temps de la réponse HTTP / de l'e-mail envoyé, et n'est jamais loggé
 * (CDC §57.1).
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
