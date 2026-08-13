import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing (CDC §7.2 — algorithme moderne de dérivation robuste)", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("Sup3r-Secr3t!");
    expect(hash).not.toBe("Sup3r-Secr3t!");
    expect(await verifyPassword("Sup3r-Secr3t!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Sup3r-Secr3t!");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("never stores the plain password inside the hash string", async () => {
    const hash = await hashPassword("MyPlainTextPassword123");
    expect(hash).not.toContain("MyPlainTextPassword123");
  });
});
