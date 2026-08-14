import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { AppConfig } from "@ardenne/config";

/**
 * CDC §34.4 — "code chiffré ou protégé" : le code d'accès `NNNN#` n'est
 * jamais stocké en clair. Plutôt qu'introduire un nouveau secret à
 * provisionner/faire tourner, la clé AES-256-GCM est dérivée de
 * `SESSION_SECRET` (déjà un secret durable de l'application) via scrypt avec
 * un contexte fixe — même logique que les tokens opaques (`identity/tokens.ts`)
 * qui réutilisent des primitives existantes plutôt que d'en multiplier.
 */
function deriveKey(config: AppConfig): Buffer {
  return scryptSync(config.SESSION_SECRET, "ardenne-access-code-v1", 32);
}

export function encryptAccessCode(config: AppConfig, plainCode: string): { ciphertext: string; iv: string } {
  const key = deriveKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainCode, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function decryptAccessCode(config: AppConfig, ciphertext: string, iv: string): string {
  const key = deriveKey(config);
  const raw = Buffer.from(ciphertext, "base64");
  const authTag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** CDC §34.1-§34.2 — format `NNNN#`, génération aléatoire cryptographiquement correcte. */
export function generateRandomAccessCode(): string {
  const n = randomBytes(2).readUInt16BE(0) % 10000;
  return `${n.toString().padStart(4, "0")}#`;
}
