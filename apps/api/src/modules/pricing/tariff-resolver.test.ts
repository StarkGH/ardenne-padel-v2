import { describe, expect, it } from "vitest";
import { NoTariffRuleFoundError, resolveTariff, type TariffRuleCandidate } from "./tariff-resolver.js";

const baseRule: TariffRuleCandidate = {
  id: "rule-normal",
  courtId: "court-3",
  courtType: null,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "17:00",
  durationMinutes: 90,
  priceTotalCents: 3600,
  pricePerParticipantCents: null,
  referenceCapacity: 4,
  priority: 10,
};

describe("resolveTariff (CDC §11.2 — résolution déterministe, priorité explicite)", () => {
  it("resolves total and per-participant price from a total-based rule", () => {
    const result = resolveTariff({
      courtId: "court-3",
      courtType: null,
      dayOfWeek: 3,
      startTime: "11:00",
      durationMinutes: 90,
      rules: [baseRule],
    });
    expect(result.priceTotalCents).toBe(3600);
    expect(result.pricePerParticipantCents).toBe(900); // 3600 / 4
    expect(result.ruleId).toBe("rule-normal");
  });

  it("resolves total price from a per-participant-based rule", () => {
    const perParticipantRule: TariffRuleCandidate = {
      ...baseRule,
      id: "rule-per-participant",
      priceTotalCents: null,
      pricePerParticipantCents: 800,
    };
    const result = resolveTariff({
      courtId: "court-3",
      courtType: null,
      dayOfWeek: 3,
      startTime: "11:00",
      durationMinutes: 90,
      rules: [perParticipantRule],
    });
    expect(result.pricePerParticipantCents).toBe(800);
    expect(result.priceTotalCents).toBe(3200); // 800 * 4
  });

  it("picks the highest explicit priority when rules overlap, never by createdAt", () => {
    const promoRule: TariffRuleCandidate = {
      ...baseRule,
      id: "rule-promo",
      priceTotalCents: 2000,
      priority: 50,
    };
    const result = resolveTariff({
      courtId: "court-3",
      courtType: null,
      dayOfWeek: 3,
      startTime: "11:00",
      durationMinutes: 90,
      rules: [baseRule, promoRule],
    });
    expect(result.ruleId).toBe("rule-promo");
    expect(result.priceTotalCents).toBe(2000);
  });

  it("does not match a rule outside its day-of-week", () => {
    expect(() =>
      resolveTariff({
        courtId: "court-3",
        courtType: null,
        dayOfWeek: 0, // dimanche, absent de daysOfWeek du baseRule
        startTime: "11:00",
        durationMinutes: 90,
        rules: [baseRule],
      }),
    ).toThrow(NoTariffRuleFoundError);
  });

  it("does not match a rule for a different court when courtId is set", () => {
    expect(() =>
      resolveTariff({
        courtId: "court-4",
        courtType: null,
        dayOfWeek: 3,
        startTime: "11:00",
        durationMinutes: 90,
        rules: [baseRule],
      }),
    ).toThrow(NoTariffRuleFoundError);
  });

  it("matches a court-agnostic rule (courtId null) restricted by courtType", () => {
    const typeRule: TariffRuleCandidate = {
      ...baseRule,
      id: "rule-double-generic",
      courtId: null,
      courtType: "DOUBLE",
      priceTotalCents: 4800,
    };
    const result = resolveTariff({
      courtId: "court-4",
      courtType: "DOUBLE",
      dayOfWeek: 3,
      startTime: "11:00",
      durationMinutes: 90,
      rules: [typeRule],
    });
    expect(result.ruleId).toBe("rule-double-generic");
  });

  it("throws NoTariffRuleFoundError when no rule covers the requested duration", () => {
    expect(() =>
      resolveTariff({
        courtId: "court-3",
        courtType: null,
        dayOfWeek: 3,
        startTime: "11:00",
        durationMinutes: 60, // baseRule ne propose que 90
        rules: [baseRule],
      }),
    ).toThrow(NoTariffRuleFoundError);
  });
});
