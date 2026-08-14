import { describe, expect, it } from "vitest";
import { computeSplitShares } from "./split-calculator.js";

describe("computeSplitShares (CDC §23.3, §24.2)", () => {
  it("splits an evenly divisible price across 4 participants with no fee", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 4800, participantCount: 4, serviceFeeCents: 0, allocation: "ORGANIZER" });
    expect(shares).toHaveLength(4);
    expect(shares.every((s) => s.baseAmountCents === 1200)).toBe(true);
    expect(shares.every((s) => s.totalAmountCents === 1200)).toBe(true);
    expect(shares[0]!.isOrganizer).toBe(true);
    expect(shares[1]!.isOrganizer).toBe(false);
  });

  it("distributes residual cents to the first shares, never losing or inventing a cent", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 1000, participantCount: 3, serviceFeeCents: 0, allocation: "ORGANIZER" });
    expect(shares.map((s) => s.baseAmountCents)).toEqual([334, 333, 333]);
    expect(shares.reduce((sum, s) => sum + s.baseAmountCents, 0)).toBe(1000);
  });

  it("puts the whole service fee on the organizer's share under ORGANIZER allocation (CDC §24.2)", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 4800, participantCount: 4, serviceFeeCents: 100, allocation: "ORGANIZER" });
    expect(shares[0]!.serviceFeeAmountCents).toBe(100);
    expect(shares[0]!.totalAmountCents).toBe(1300); // 1200 + 100
    expect(shares.slice(1).every((s) => s.serviceFeeAmountCents === 0)).toBe(true);
    expect(shares.slice(1).every((s) => s.totalAmountCents === 1200)).toBe(true);
  });

  it("spreads the service fee across all shares under PRO_RATA allocation", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 4800, participantCount: 4, serviceFeeCents: 100, allocation: "PRO_RATA" });
    expect(shares.map((s) => s.serviceFeeAmountCents)).toEqual([25, 25, 25, 25]);
    expect(shares.every((s) => s.totalAmountCents === 1225)).toBe(true);
  });

  it("never loses a cent on the service fee even when it doesn't divide evenly", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 4800, participantCount: 3, serviceFeeCents: 100, allocation: "PRO_RATA" });
    const totalFee = shares.reduce((sum, s) => sum + s.serviceFeeAmountCents, 0);
    expect(totalFee).toBe(100);
  });

  it("computes a valid single-share split (organizer alone, e.g. a simple court)", () => {
    const shares = computeSplitShares({ basePriceTotalCents: 2400, participantCount: 2, serviceFeeCents: 100, allocation: "ORGANIZER" });
    expect(shares).toHaveLength(2);
    expect(shares[0]!.totalAmountCents).toBe(1300);
    expect(shares[1]!.totalAmountCents).toBe(1200);
  });

  it("throws on an invalid participant count", () => {
    expect(() => computeSplitShares({ basePriceTotalCents: 4800, participantCount: 0, serviceFeeCents: 0, allocation: "ORGANIZER" })).toThrow();
  });
});
