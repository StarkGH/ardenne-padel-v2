/**
 * Machine à états réservation (CDC §17). Transitions volontairement
 * conservatrices pour le Lot 3 — un état "impossible" doit toujours être
 * explicite (`MANUAL_REVIEW`) plutôt que silencieux (CDC §111).
 */

export type BookingStatus =
  | "DRAFT"
  | "CHECKOUT_PENDING"
  | "LEGACY_HOLD_PENDING"
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "CANCEL_PENDING"
  | "CANCELED"
  | "COMPLETED"
  | "FAILED"
  | "MANUAL_REVIEW";

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["CHECKOUT_PENDING", "FAILED"],
  CHECKOUT_PENDING: ["LEGACY_HOLD_PENDING", "PAYMENT_PENDING", "FAILED", "MANUAL_REVIEW"],
  LEGACY_HOLD_PENDING: ["PAYMENT_PENDING", "FAILED", "MANUAL_REVIEW"],
  PAYMENT_PENDING: ["CONFIRMED", "FAILED", "MANUAL_REVIEW"],
  CONFIRMED: ["CANCEL_PENDING", "COMPLETED", "MANUAL_REVIEW"],
  CANCEL_PENDING: ["CANCELED", "MANUAL_REVIEW"],
  CANCELED: [],
  COMPLETED: [],
  FAILED: [],
  MANUAL_REVIEW: ["CONFIRMED", "CANCELED", "FAILED"],
};

export class InvalidBookingTransitionError extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(`Transition de réservation invalide : ${from} -> ${to}`);
    this.name = "InvalidBookingTransitionError";
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidBookingTransitionError(from, to);
  }
}

export function isTerminalStatus(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
