import { describe, expect, it } from "vitest";
import { addCents, assertCents, centsToDisplayString, splitEvenly, subtractCents } from "./money.js";

describe("money (CDC §80, §23.3 — centimes entiers, jamais de float)", () => {
  it("rejects non-integer amounts", () => {
    expect(() => assertCents(14.5, "test")).toThrow();
    expect(() => assertCents("1450", "test")).toThrow();
    expect(() => assertCents(1450, "test")).not.toThrow();
  });

  it("adds and subtracts integer cents", () => {
    expect(addCents(1200, 800, 100)).toBe(2100);
    expect(subtractCents(2100, 100)).toBe(2000);
  });

  describe("splitEvenly — répartition avec centimes résiduels distribués aux premières parts", () => {
    it("splits an amount evenly divisible", () => {
      expect(splitEvenly(4800, 4)).toEqual([1200, 1200, 1200, 1200]);
    });

    it("distributes the remainder to the first parts (double 48€ / 4, not evenly divisible variant)", () => {
      expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
      const total = splitEvenly(1000, 3).reduce((a, b) => a + b, 0);
      expect(total).toBe(1000);
    });

    it("never loses or invents a cent regardless of parts count", () => {
      for (const parts of [1, 2, 3, 4, 5, 7]) {
        const shares = splitEvenly(9999, parts);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(9999);
        expect(shares).toHaveLength(parts);
      }
    });
  });

  it("formats cents as a currency string", () => {
    expect(centsToDisplayString(1450)).toContain("14");
    expect(centsToDisplayString(1450)).toContain("50");
  });
});
