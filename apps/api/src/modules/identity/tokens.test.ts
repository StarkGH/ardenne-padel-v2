import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken } from "./tokens.js";

describe("tokens opaques (vérification e-mail / reset — CDC §57.1 : ne jamais stocker le token brut)", () => {
  it("generates a raw token distinct from its hash", () => {
    const { raw, hash } = generateOpaqueToken();
    expect(raw).not.toBe(hash);
    expect(raw.length).toBeGreaterThan(20);
  });

  it("hashing the same raw token is deterministic", () => {
    const { raw, hash } = generateOpaqueToken();
    expect(hashToken(raw)).toBe(hash);
  });

  it("generates unique tokens across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateOpaqueToken().raw));
    expect(tokens.size).toBe(50);
  });
});
