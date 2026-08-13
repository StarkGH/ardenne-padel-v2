import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hachage de mot de passe avec scrypt (CDC §7.2 : "algorithme moderne de
 * dérivation robuste"). Choix documenté dans ADR-0001 : scrypt via
 * node:crypto plutôt qu'argon2, pour éviter une dépendance à compilation
 * native au Lot 1 — réversible si un besoin de migration vers argon2 apparaît
 * (le format préfixé permet de faire cohabiter plusieurs algorithmes).
 *
 * Wrapper manuel plutôt que util.promisify : l'overload de node:crypto avec
 * des options (N/r/p) n'est pas correctement inféré par promisify.
 */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(plainPassword, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const derivedKey = await scryptAsync(plainPassword, salt, expected.length, { N, r, p });
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}
