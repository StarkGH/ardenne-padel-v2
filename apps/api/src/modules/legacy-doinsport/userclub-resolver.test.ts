import { describe, expect, it } from "vitest";
import { decodeJwtPayload, resolveUserClubId } from "./userclub-resolver.js";

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return [b64({ alg: "HS256" }), b64(payload), "fake-signature"].join(".");
}

describe("userclub-resolver (CDC §13.1 — résolution robuste du userClubId, V-008)", () => {
  it("decodes the JWT payload", () => {
    const token = fakeJwt({ id: "abc-123", roles: ["ROLE_CLUB"] });
    expect(decodeJwtPayload(token).id).toBe("abc-123");
  });

  it("prefers the JWT claim over the configured env value when both are present and agree", () => {
    const token = fakeJwt({ id: "same-id" });
    expect(resolveUserClubId(token, "same-id")).toBe("same-id");
  });

  it("prefers the JWT claim even when it diverges from the configured env value (does not throw)", () => {
    const token = fakeJwt({ id: "jwt-id" });
    expect(resolveUserClubId(token, "env-id")).toBe("jwt-id");
  });

  it("falls back to the configured env value when the JWT has no id claim", () => {
    const token = fakeJwt({ roles: ["ROLE_CLUB"] });
    expect(resolveUserClubId(token, "env-id")).toBe("env-id");
  });

  it("throws when neither the JWT nor the env provide a userClubId", () => {
    const token = fakeJwt({ roles: ["ROLE_CLUB"] });
    expect(() => resolveUserClubId(token, undefined)).toThrow();
  });
});
