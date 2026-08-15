export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "PENDING_VERIFICATION" | "ACTIVE" | "DISABLED";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  pilotUser?: boolean;
}

export type CourtType = "SIMPLE" | "DOUBLE";

export interface Court {
  id: string;
  name: string;
  slug: string;
  courtType: CourtType;
  capacity: number;
  displayOrder: number;
}

export interface AvailabilitySlot {
  startTime: string; // "HH:mm"
  allowedDurationsMinutes: number[];
}

export interface PricingQuote {
  ruleId: string;
  priceTotalCents: number;
  pricePerParticipantCents: number;
  currency: "EUR";
}

export type BookingStatus =
  | "DRAFT"
  | "CHECKOUT_PENDING"
  | "LEGACY_HOLD_PENDING"
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "CANCEL_PENDING"
  | "CANCELED"
  | "FAILED"
  | "MANUAL_REVIEW"
  | "COMPLETED";

export type PaymentMode = "FULL" | "SPLIT";

export interface Booking {
  id: string;
  organizerUserId: string;
  courtId: string;
  court?: Court;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: BookingStatus;
  paymentStatus: string;
  paymentMode: PaymentMode;
  priceTotalCents: number;
  currency: string;
  cancellationDeadline: string | null;
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
}

export interface CheckoutResult {
  bookingId: string;
  bookingStatus: string;
  paymentId?: string;
  walletAppliedCents: number;
  requiresAction: boolean;
  clientSecret?: string;
}
