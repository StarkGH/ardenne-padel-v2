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

/** CDC §55 écran 12 — vue admin, inclut aussi les packs désactivés. */
export interface AdminCreditPack extends CreditPack {
  active: boolean;
  salesChannels: Array<"ONLINE" | "KIOSK" | "TERMINAL">;
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
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CANCEL_PENDING" | "CANCELED" | "CONFIRMATION_UNKNOWN";
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface AdminBooking extends Booking {
  organizer: { id: string; firstName: string; lastName: string; email: string } | null;
  legacyBookingMapping?: LegacyBookingMapping | null;
}

export interface LegacyOccupationParticipant {
  firstName: string;
  lastName: string;
  /** Réservations non annulées connues de ce joueur (calculé à l'import, pas à l'affichage). */
  activeBookingsCount: number;
}

/** CDC §55 écran 3 — occupation Doinsport-only affichée sur le planning (jamais créée/annulable depuis V2, voir ADR-0038 addendum). */
export interface LegacyOccupation {
  id: string;
  courtId: string;
  startAt: string;
  endAt: string;
  clientName: string | null;
  /** Total encaissé >= total dû (agrégé au niveau de la réservation, pas par participant — voir ADR-0038 addendum). */
  fullyPaid: boolean;
  participants: LegacyOccupationParticipant[];
  /** Note Doinsport de la réservation (`comment`), affichée en italique sur le planning. */
  comment: string | null;
}

export type ClientSearchResult =
  | {
      source: "V2";
      id: string;
      email: string;
      phone: string | null;
      firstName: string;
      lastName: string;
      role: Role;
      status: UserStatus;
      createdAt: string;
    }
  | {
      source: "LEGACY";
      id: string;
      externalId: string;
      email: string | null;
      phone: string | null;
      firstName: string;
      lastName: string;
      migrationStatus: ClientMigrationStatus;
    };

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
  status: "PENDING" | "REQUIRES_ACTION" | "AUTHORIZED" | "SUCCEEDED" | "FAILED" | "CANCELED";
  purpose: string;
  providerFeeCents: number | null;
  providerNetCents: number | null;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
  refunds?: AdminRefund[];
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
  status: "PENDING" | "PAID" | "CREDITED" | "FAILED";
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
  creditPack?: { id: string; name: string };
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

// --- Écran 8 : tarifs ---
export interface TariffRule {
  id: string;
  name: string;
  active: boolean;
  courtId: string | null;
  courtType: CourtType | null;
  validFrom: string;
  validUntil: string | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  priceTotalCents: number | null;
  pricePerParticipantCents: number | null;
  referenceCapacity: number;
  priority: number;
  tags: string[];
}

// --- Écran 9 : horaires / fermetures ---
export interface OpeningRule {
  id: string;
  courtId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
}

export type ClosureType = "MAINTENANCE" | "EVENT" | "ADMIN_BLOCK";

export interface CourtClosure {
  id: string;
  courtId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  closureType: ClosureType;
}

// --- Écrans 10-11-14 : wallet admin ---
export interface AdminWalletTransaction extends WalletTransaction {
  createdBy: string | null;
}

// --- Écran 19 : kiosques ---
export interface AdminKioskDevice {
  id: string;
  name: string;
  location: string | null;
  capabilities: Array<"TERMINAL" | "QR_HANDOFF">;
  lastSeenAt: string | null;
}

// --- Écran 20 : terminaux Stripe ---
export interface AdminTerminalDevice {
  id: string;
  provider: string;
  providerDeviceId: string;
  name: string;
  location: string | null;
  status: "ACTIVE" | "OFFLINE" | "REVOKED";
  capabilities: string[];
  lastSeenAt: string | null;
  createdAt: string;
}

// --- Écran 22 : accès ---
export interface AdminAccessGrant {
  id: string;
  bookingId: string;
  origin: "V2_GENERATED" | "LEGACY_IMPORTED";
  scope: string;
  status: "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "FAILED";
  validFrom: string;
  validUntil: string;
  provisionedAt: string | null;
  revokedAt: string | null;
  providerReference: string | null;
  createdAt: string;
  booking: { startAt: string; court: { name: string }; organizer: { firstName: string; lastName: string; email: string } };
}

// --- Écran 24 : audit log ---
export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata: { before: Record<string, unknown> | null; after: Record<string, unknown> | null } | null;
  createdAt: string;
}

// --- Écrans 17-18-25 : paramètres (lecture seule) ---
export interface AdminSettings {
  split: {
    paymentSplitEnabled: boolean;
    serviceFeeEnabled: boolean;
    serviceFeeCents: number;
    serviceFeeAllocation: "ORGANIZER" | "PRO_RATA";
    invitationTtlHours: number;
  };
  wallet: { enabled: boolean; topupEnabled: boolean; holdStaleHours: number };
  payments: {
    terminalEnabled: boolean;
    qrHandoffEnabled: boolean;
    tapToPayEnabled: boolean;
    offSessionGuaranteeEnabled: boolean;
    walletGuaranteeEnabled: boolean;
  };
  access: { v2AccessEnabled: boolean; enabledBeforeMinutes: number; enabledAfterMinutes: number };
  kiosk: { sessionTtlMinutes: number; offlineThresholdMinutes: number };
  legacy: { mode: string; syncEnabled: boolean; writeEnabled: boolean };
  pilot: { pilotModeEnabled: boolean };
}

export interface LegacySyncRunEntry {
  id: string;
  kind: "CLIENTS" | "BOOKINGS";
  status: "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";
  startedAt: string;
  finishedAt: string | null;
  itemsSeen: number;
  itemsChanged: number;
  errorSummary: string | null;
}

export interface RevenueDay {
  date: string;
  bookingsCount: number;
  revenueTotalCents: number;
  revenueExVatCents: number;
  vatCents: number;
}

export interface BookingsRevenueReport {
  from: string;
  to: string;
  vatRatePercent: number;
  days: RevenueDay[];
  summary: RevenueDay;
}

export type ClientMigrationStatus = "LEGACY_ONLY" | "INVITED" | "MIGRATION_PENDING" | "MIGRATED" | "DISABLED" | "MERGE_REQUIRED";

export interface LegacyClientMigrationEntry {
  id: string;
  externalId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  migrationStatus: ClientMigrationStatus;
  mergeNote: string | null;
  linkedUserId: string | null;
  linkedUser: { id: string; email: string; firstName: string; lastName: string } | null;
  lastSyncedAt: string;
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
