import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { decryptAccessCode, encryptAccessCode, generateRandomAccessCode } from "./access-code-crypto.js";

describe("access-code-crypto (CDC §34.1-§34.4)", () => {
  let config: AppConfig;
  beforeAll(() => {
    resetConfigCacheForTests();
    config = loadConfig();
  });

  it("generates a code in the NNNN# format", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomAccessCode()).toMatch(/^\d{4}#$/);
    }
  });

  it("encrypts and decrypts a code round-trip", () => {
    const code = "4821#";
    const { ciphertext, iv } = encryptAccessCode(config, code);
    expect(ciphertext).not.toContain(code);
    expect(decryptAccessCode(config, ciphertext, iv)).toBe(code);
  });

  it("produces a different ciphertext each time (random IV) even for the same code", () => {
    const a = encryptAccessCode(config, "1234#");
    const b = encryptAccessCode(config, "1234#");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with a tampered ciphertext (authenticated encryption)", () => {
    const { ciphertext, iv } = encryptAccessCode(config, "9999#");
    const tampered = Buffer.from(ciphertext, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => decryptAccessCode(config, tampered.toString("base64"), iv)).toThrow();
  });
});
