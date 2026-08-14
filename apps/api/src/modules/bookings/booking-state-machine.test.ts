import { describe, expect, it } from "vitest";
import {
  InvalidBookingTransitionError,
  assertTransition,
  canTransition,
  isTerminalStatus,
  type BookingStatus,
} from "./booking-state-machine.js";

describe("booking state machine (CDC §17)", () => {
  it("allows the happy path DRAFT -> CHECKOUT_PENDING -> PAYMENT_PENDING -> CONFIRMED -> COMPLETED", () => {
    const path: BookingStatus[] = ["DRAFT", "CHECKOUT_PENDING", "PAYMENT_PENDING", "CONFIRMED", "COMPLETED"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows cancellation from CONFIRMED", () => {
    expect(canTransition("CONFIRMED", "CANCEL_PENDING")).toBe(true);
    expect(canTransition("CANCEL_PENDING", "CANCELED")).toBe(true);
  });

  it("rejects skipping straight from DRAFT to CONFIRMED", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(false);
    expect(() => assertTransition("DRAFT", "CONFIRMED")).toThrow(InvalidBookingTransitionError);
  });

  it("rejects any transition out of a terminal state", () => {
    for (const terminal of ["CANCELED", "COMPLETED", "FAILED"] as const) {
      expect(isTerminalStatus(terminal)).toBe(true);
      expect(canTransition(terminal, "CONFIRMED")).toBe(false);
    }
  });

  it("allows MANUAL_REVIEW to be resolved by an admin towards CONFIRMED, CANCELED or FAILED", () => {
    expect(canTransition("MANUAL_REVIEW", "CONFIRMED")).toBe(true);
    expect(canTransition("MANUAL_REVIEW", "CANCELED")).toBe(true);
    expect(canTransition("MANUAL_REVIEW", "FAILED")).toBe(true);
  });

  it("never leaves an unresolved state without an explicit path to MANUAL_REVIEW or a terminal state", () => {
    const nonTerminal: BookingStatus[] = ["DRAFT", "CHECKOUT_PENDING", "LEGACY_HOLD_PENDING", "PAYMENT_PENDING", "CONFIRMED", "CANCEL_PENDING"];
    for (const status of nonTerminal) {
      expect(canTransition(status, "FAILED") || canTransition(status, "MANUAL_REVIEW") || canTransition(status, "CANCELED")).toBe(true);
    }
  });
});
