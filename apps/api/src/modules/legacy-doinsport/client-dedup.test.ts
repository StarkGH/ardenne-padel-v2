import { describe, expect, it } from "vitest";
import { decideClientLink } from "./client-dedup.js";

describe("decideClientLink (CDC §7.5 — déduplication à l'import)", () => {
  it("links automatically on a single exact e-mail match", () => {
    const result = decideClientLink({
      legacyEmail: "jean@example.com",
      legacyPhone: null,
      usersMatchingEmail: [{ id: "user-1", email: "jean@example.com" }],
      usersMatchingPhone: [],
    });
    expect(result).toEqual({ migrationStatus: "MIGRATED", linkedUserId: "user-1" });
  });

  it("flags MERGE_REQUIRED when the e-mail matches more than one V2 account", () => {
    const result = decideClientLink({
      legacyEmail: "jean@example.com",
      legacyPhone: null,
      usersMatchingEmail: [
        { id: "user-1", email: "jean@example.com" },
        { id: "user-2", email: "jean@example.com" },
      ],
      usersMatchingPhone: [],
    });
    expect(result.migrationStatus).toBe("MERGE_REQUIRED");
  });

  it("never auto-links on GSM alone — always MERGE_REQUIRED, even with a single candidate", () => {
    const result = decideClientLink({
      legacyEmail: null,
      legacyPhone: "0470123456",
      usersMatchingEmail: [],
      usersMatchingPhone: [{ id: "user-1", email: "jean@example.com" }],
    });
    expect(result.migrationStatus).toBe("MERGE_REQUIRED");
    expect((result as { mergeNote: string }).mergeNote).toContain("0470123456");
  });

  it("prefers the e-mail signal over GSM when both are present and email matches exactly one account", () => {
    const result = decideClientLink({
      legacyEmail: "jean@example.com",
      legacyPhone: "0470123456",
      usersMatchingEmail: [{ id: "user-1", email: "jean@example.com" }],
      usersMatchingPhone: [{ id: "user-2", email: "autre@example.com" }],
    });
    expect(result).toEqual({ migrationStatus: "MIGRATED", linkedUserId: "user-1" });
  });

  it("stays LEGACY_ONLY when neither e-mail nor GSM match anything", () => {
    const result = decideClientLink({
      legacyEmail: "inconnu@example.com",
      legacyPhone: "0499999999",
      usersMatchingEmail: [],
      usersMatchingPhone: [],
    });
    expect(result).toEqual({ migrationStatus: "LEGACY_ONLY" });
  });

  it("stays LEGACY_ONLY when the Legacy client has neither e-mail nor phone on file", () => {
    const result = decideClientLink({ legacyEmail: null, legacyPhone: null, usersMatchingEmail: [], usersMatchingPhone: [] });
    expect(result).toEqual({ migrationStatus: "LEGACY_ONLY" });
  });
});
