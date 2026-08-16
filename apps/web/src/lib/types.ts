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
export type BookingSource = "WEB" | "PWA" | "ADMIN" | "MIGRATION" | "LEGACY_SYNC";

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
  source: BookingSource;
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

export interface WalletBalance {
  walletAccountId: string;
  currency: string;
  totalCents: number;
  reservedCents: number;
  availableCents: number;
  byOrigin: { PAID: number; BONUS: number; ADMIN_COMP: number };
}

export type WalletTransactionType =
  | "CREDIT_PACK_PURCHASE"
  | "CREDIT_PACK_BONUS"
  | "CREDIT_ADMIN"
  | "DEBIT_BOOKING"
  | "REFUND_BOOKING"
  | "HOLD_CREATED"
  | "HOLD_RELEASED"
  | "HOLD_CAPTURED"
  | "ADJUSTMENT"
  | "BONUS_EXPIRY";

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amountCents: number;
  creditOrigin: "PAID" | "BONUS" | "ADMIN_COMP" | null;
  bookingId: string | null;
  creditPackPurchaseId: string | null;
  reference: string | null;
  createdAt: string;
}

export interface CreditPack {
  id: string;
  name: string;
  purchaseAmountCents: number;
  paidCreditsCents: number;
  bonusCreditsCents: number;
  displayOrder: number;
}

export interface CreditPackPurchaseResult {
  purchaseId: string;
  requiresAction: boolean;
  clientSecret?: string;
}

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  pilotUser: boolean;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

// --- Admin (CDC §55) ---

export interface LegacyBookingMapping {
  id: string;
  bookingId: string;
  legacyBookingId: string | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CANCEL_PENDING" | "CANCELED";
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface AdminBooking extends Booking {
  organizer: { id: string; firstName: string; lastName: string; email: string } | null;
  legacyBookingMapping?: LegacyBookingMapping | null;
}

export interface ClientSearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface ClientProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  pilotUser: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ClientLegacyStatus {
  origin: "LEGACY_LINKED" | "V2_ONLY";
  legacyClientId: string | null;
  migratedAt: string | null;
}

export interface AdminPayment {
  id: string;
  bookingId: string | null;
  userId: string;
  provider: string;
  providerPaymentId: string;
  paymentChannel: "ONLINE" | "QR_HANDOFF" | "TERMINAL";
  paymentMethodType: string | null;
  amountCents: number;
  currency: string;
  status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "CANCELED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  purpose: string;
  providerFeeCents: number | null;
  providerNetCents: number | null;
  createdAt: string;
}

export interface AdminRefund {
  id: string;
  paymentId: string;
  providerRefundId: string | null;
  amountCents: number;
  fundingSource: "EXTERNAL" | "WALLET";
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  reason: string | null;
  createdAt: string;
}

export interface AdminCreditPackPurchase {
  id: string;
  creditPackId: string;
  userId: string;
  purchaseAmountCents: number;
  paidCreditsCents: number;
  bonusCreditsCents: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  createdAt: string;
}

export interface AdminWalletHold {
  id: string;
  walletAccountId: string;
  bookingId: string | null;
  amountCents: number;
  status: "ACTIVE" | "RELEASED" | "CAPTURED" | "EXPIRED";
  expiresAt: string | null;
  createdAt: string;
}

export interface ClientWallet {
  walletAccountId: string;
  balanceTotalCents: number;
  balanceByOrigin: { PAID: number; BONUS: number; ADMIN_COMP: number };
  balanceReservedCents: number;
  balanceAvailableCents: number;
  activeHolds: AdminWalletHold[];
}

export interface AdminClientNote {
  id: string;
  userId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface ClientFile {
  profile: ClientProfile;
  legacyStatus: ClientLegacyStatus;
  bookings: { future: AdminBooking[]; past: AdminBooking[] };
  payments: AdminPayment[];
  refunds: AdminRefund[];
  creditPackPurchases: AdminCreditPackPurchase[];
  wallet: ClientWallet | null;
  notes: AdminClientNote[];
}

export interface HealthIndicators {
  lastLegacySyncAt: string | null;
  legacySyncErrors: number;
  bookingsManualReview: number;
  paymentsFailed: number;
  walletHoldsStale: number;
  creditPacksPaidNotCredited: number;
  kioskDevicesOffline: number;
  terminalDevicesUnavailable: number;
  accessGrantsFailed: number;
  notificationsFailed: number;
}

export interface AlertEntry {
  code: string;
  severity: "warning" | "critical";
  message: string;
  count: number;
}

export type KioskSessionStatus = "PENDING" | "CLAIMED" | "COMPLETED" | "EXPIRED" | "CANCELED";

export interface KioskCheckoutSessionCreated {
  id: string;
  token: string;
  expiresAt: string;
}

export interface KioskCheckoutSessionStatus {
  status: KioskSessionStatus;
  bookingId?: string;
  bookingStatus?: BookingStatus | null;
}

export type KioskCheckoutSessionPreview =
  | { claimed: true; booking: Booking }
  | {
      claimed: false;
      courtId: string;
      startAt: string;
      durationMinutes: number;
      paymentMode: PaymentMode;
      status: KioskSessionStatus;
    };
