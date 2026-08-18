import { describe, expect, it } from "vitest";
import { computeDueCents, computeFullyPaid, computeReceivedCents, extractParticipants } from "./booking-participants.js";

describe("extractParticipants", () => {
  it("extracts name, canceled flag and price from raw participants", () => {
    const raw = {
      participants: [
        { client: { id: "c1", firstName: "Alain", lastName: "Monfort" }, canceled: false, price: 1200 },
        { client: { id: "c2", firstName: "Alain", lastName: "Samray" }, canceled: true, price: 1500 },
      ],
    };
    expect(extractParticipants(raw)).toEqual([
      { firstName: "Alain", lastName: "Monfort", legacyClientId: "c1", canceled: false, priceCents: 1200 },
      { firstName: "Alain", lastName: "Samray", legacyClientId: "c2", canceled: true, priceCents: 1500 },
    ]);
  });

  it("returns an empty list for missing/malformed raw", () => {
    expect(extractParticipants(null)).toEqual([]);
    expect(extractParticipants({})).toEqual([]);
    expect(extractParticipants({ participants: "not-an-array" })).toEqual([]);
  });

  it("defaults to null legacyClientId, empty names and zero price when the client/price is missing", () => {
    const raw = { participants: [{ canceled: false }] };
    expect(extractParticipants(raw)).toEqual([
      { firstName: "", lastName: "", legacyClientId: null, canceled: false, priceCents: 0 },
    ]);
  });
});

describe("computeDueCents / computeReceivedCents", () => {
  it("sums non-canceled participants' price and succeeded payments separately", () => {
    const raw = {
      participants: [{ price: 1200, canceled: false }, { price: 1500, canceled: true }],
      payments: [
        { payment: { status: "succeeded", amountReceived: 1000 } },
        { payment: { status: "processing", amountReceived: 0 } },
      ],
    };
    expect(computeDueCents(raw)).toBe(1200);
    expect(computeReceivedCents(raw)).toBe(1000);
  });
});

describe("computeFullyPaid", () => {
  it("is true when received payments cover the non-canceled participants' total price", () => {
    const raw = {
      participants: [{ price: 1200, canceled: false }, { price: 1200, canceled: false }],
      payments: [
        { payment: { status: "succeeded", amountReceived: 1200 } },
        { payment: { status: "succeeded", amountReceived: 1200 } },
      ],
    };
    expect(computeFullyPaid(raw)).toBe(true);
  });

  it("is false when a participant's share was never paid", () => {
    const raw = {
      participants: [{ price: 1200, canceled: false }, { price: 1200, canceled: false }],
      payments: [{ payment: { status: "succeeded", amountReceived: 1200 } }],
    };
    expect(computeFullyPaid(raw)).toBe(false);
  });

  it("ignores canceled participants when computing the amount due", () => {
    const raw = {
      participants: [{ price: 1200, canceled: false }, { price: 1200, canceled: true }],
      payments: [{ payment: { status: "succeeded", amountReceived: 1200 } }],
    };
    expect(computeFullyPaid(raw)).toBe(true);
  });

  it("ignores payments that have not succeeded yet (processing, failed)", () => {
    const raw = {
      participants: [{ price: 1200, canceled: false }],
      payments: [{ payment: { status: "processing", amountReceived: 0 } }],
    };
    expect(computeFullyPaid(raw)).toBe(false);
  });

  it("is true when nothing is due (e.g. free/comp booking)", () => {
    expect(computeFullyPaid({ participants: [], payments: [] })).toBe(true);
  });
});
