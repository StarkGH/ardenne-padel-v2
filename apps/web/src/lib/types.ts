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

export type BookingParticipantStatus = "INVITED" | "CONFIRMED" | "REMOVED";

export interface BookingParticipant {
  id: string;
  bookingId: string;
  userId: string | null;
  legacyClientId: string | null;
  invitedEmail: string | null;
  displayName: string;
  role: "ORGANIZER" | "PLAYER";
  status: BookingParticipantStatus;
}

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
  bookingBasePriceCents: number;
  priceTotalCents: number;
  currency: string;
  cancellationDeadline: string | null;
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  participants?: BookingParticipant[];
}

export interface CheckoutResult {
  bookingId: string;
  bookingStatus: string;
  paymentId?: string;
  walletAppliedCents: number;
  requiresAction: boolean;
  clientSecret?: string;
}

export type GuaranteeType = "CARD_OFF_SESSION" | "WALLET_RESERVE";

export interface SplitCheckoutResult {
  bookingId: string;
  bookingStatus: string;
  organizerShareCents: number;
  guaranteedCents: number;
  shareCount: number;
}

export interface SplitShare {
  isOrganizer: boolean;
  baseAmountCents: number;
  serviceFeeAmountCents: number;
  totalAmountCents: number;
}

export interface SplitPreview {
  shares: SplitShare[];
  organizerShareCents: number;
  guaranteedCents: number;
  shareCount: number;
  currency: string;
}

export type BookingShareStatus = "OPEN" | "INVITED" | "PAYMENT_PENDING" | "PAID" | "COVERED_BY_ORGANIZER" | "CANCELED" | "REFUNDED";

export interface BookingShare {
  id: string;
  participantUserId: string | null;
  invitedEmail: string | null;
  baseAmountCents: number;
  serviceFeeAmountCents: number;
  totalAmountCents: number;
  status: BookingShareStatus;
  paidAt: string | null;
}

export interface InvitationShare {
  id: string;
  bookingId: string;
  baseAmountCents: number;
  serviceFeeAmountCents: number;
  totalAmountCents: number;
  status: BookingShareStatus;
}
