import { describe, expect, it } from "vitest";
import { LegacyApiError, LegacyErrorCodes, mapLegacyError } from "./legacy-errors.js";

describe("mapLegacyError (CDC §87 — jamais de payload Legacy brut au client)", () => {
  it("maps 401 to LEGACY_AUTH_EXPIRED", () => {
    expect(mapLegacyError(new LegacyApiError(401, "")).code).toBe(LegacyErrorCodes.LEGACY_AUTH_EXPIRED);
  });

  it("maps a 422 slot-occupied violation to BOOKING_SLOT_UNAVAILABLE with a user-facing message", () => {
    const body = JSON.stringify({
      violations: [{ propertyPath: "playgrounds", message: "Le terrain : Padel 3 n'est pas disponible." }],
    });
    const error = mapLegacyError(new LegacyApiError(422, body));
    expect(error.code).toBe(LegacyErrorCodes.BOOKING_SLOT_UNAVAILABLE);
    expect(error.message).not.toContain("violations"); // jamais le JSON brut Doinsport
  });

  it("maps a generic 422 (not a slot conflict) to LEGACY_BAD_REQUEST", () => {
    const body = JSON.stringify({ violations: [{ propertyPath: "startAt", message: "invalid" }] });
    expect(mapLegacyError(new LegacyApiError(422, body)).code).toBe(LegacyErrorCodes.LEGACY_BAD_REQUEST);
  });

  it("maps 429 to LEGACY_RATE_LIMITED", () => {
    expect(mapLegacyError(new LegacyApiError(429, "")).code).toBe(LegacyErrorCodes.LEGACY_RATE_LIMITED);
  });

  it("maps 5xx to LEGACY_UNAVAILABLE", () => {
    expect(mapLegacyError(new LegacyApiError(503, "")).code).toBe(LegacyErrorCodes.LEGACY_UNAVAILABLE);
  });

  it("maps a network timeout to LEGACY_TIMEOUT", () => {
    expect(mapLegacyError(new LegacyApiError("timeout", "")).code).toBe(LegacyErrorCodes.LEGACY_TIMEOUT);
  });

  it("never leaks the raw Doinsport body in the mapped error message", () => {
    const body = "<html>Some raw Doinsport error page with secrets</html>";
    const error = mapLegacyError(new LegacyApiError(500, body));
    expect(error.message).not.toContain("secrets");
  });
});
