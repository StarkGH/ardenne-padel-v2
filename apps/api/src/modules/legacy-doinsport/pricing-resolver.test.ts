import { describe, expect, it } from "vitest";
import {
  NoPriceForDurationError,
  NoTimetableBlockCoversTimeError,
  resolveBlockPrice,
  type TimetableBlockDto,
  type TimetableBlockPriceDto,
} from "./pricing-resolver.js";

/**
 * Tests de caractérisation de l'algorithme audité (CDC §13.5, §74) — fixtures
 * synthétiques mais représentatives du cas réel documenté dans
 * docs/API-CATALOG.md (terrain Padel 3, grilles qui se chevauchent).
 * Aucun appel réseau : c'est tout l'intérêt d'avoir isolé la logique pure.
 */

const block90MinRecent: TimetableBlockDto = {
  id: "block-recent-90min-only",
  startAt: "1970-01-01T17:00:00+00:00",
  endAt: "1970-01-01T23:00:00+00:00",
  createdAt: "2026-05-01T00:00:00.000Z",
  priceIds: ["price-90min"],
};

const block60MinOlder: TimetableBlockDto = {
  id: "block-older-60min",
  startAt: "1970-01-01T17:00:00+00:00",
  endAt: "1970-01-01T23:00:00+00:00",
  createdAt: "2026-01-01T00:00:00.000Z",
  priceIds: ["price-60min"],
};

const blockMorning: TimetableBlockDto = {
  id: "block-morning-90min",
  startAt: "1970-01-01T08:00:00+00:00",
  endAt: "1970-01-01T13:00:00+00:00",
  createdAt: "2025-09-14T00:00:00.000Z",
  priceIds: ["price-90min-morning"],
};

const prices: TimetableBlockPriceDto[] = [
  { id: "price-90min", pricePerParticipant: 800, duration: 5400 },
  { id: "price-60min", pricePerParticipant: 800, duration: 3600 },
  { id: "price-90min-morning", pricePerParticipant: 900, duration: 5400 },
];

describe("resolveBlockPrice (CDC §13.5 — grilles qui se chevauchent)", () => {
  it("picks the single block covering the requested time when unambiguous", () => {
    const result = resolveBlockPrice({
      blocks: [blockMorning],
      prices,
      startAt: `${today()}T11:00:00.000+02:00`,
      durationSeconds: 5400,
    });
    expect(result.block.id).toBe("block-morning-90min");
    expect(result.price.id).toBe("price-90min-morning");
  });

  it("prefers the most recently created block among overlapping candidates", () => {
    const result = resolveBlockPrice({
      blocks: [block60MinOlder, block90MinRecent],
      prices,
      startAt: `${today()}T19:00:00.000+02:00`,
      durationSeconds: 5400, // seule la grille récente propose 90 min
    });
    expect(result.block.id).toBe("block-recent-90min-only");
  });

  it("falls back to an older block when the most recent one lacks the requested duration", () => {
    const result = resolveBlockPrice({
      blocks: [block60MinOlder, block90MinRecent],
      prices,
      startAt: `${today()}T20:00:00.000+02:00`,
      durationSeconds: 3600, // le bloc récent n'a que du 90 min -> repli sur l'ancien
    });
    expect(result.block.id).toBe("block-older-60min");
    expect(result.price.id).toBe("price-60min");
  });

  it("throws NoTimetableBlockCoversTimeError when no block covers the requested time", () => {
    expect(() =>
      resolveBlockPrice({
        blocks: [blockMorning],
        prices,
        startAt: `${today()}T22:00:00.000+02:00`,
        durationSeconds: 5400,
      }),
    ).toThrow(NoTimetableBlockCoversTimeError);
  });

  it("throws NoPriceForDurationError when a block covers the time but no matching duration exists", () => {
    expect(() =>
      resolveBlockPrice({
        blocks: [blockMorning],
        prices,
        startAt: `${today()}T11:00:00.000+02:00`,
        durationSeconds: 1800, // 30 min non proposé dans la fixture
      }),
    ).toThrow(NoPriceForDurationError);
  });
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
