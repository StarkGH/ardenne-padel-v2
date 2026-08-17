import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { buildTestNotificationService } from "../../testing/build-notification-service.js";
import { buildTestAccessGrantService } from "../../testing/build-access-grant-service.js";
import { FakeLegacyProvider } from "../legacy-doinsport/testing/fake-legacy-provider.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { BookingGuaranteeRepository } from "../bookings/booking-guarantee.repository.js";
import { BookingGuaranteeService } from "../bookings/booking-guarantee.service.js";
import { BookingShareRepository } from "../bookings/booking-share.repository.js";
import { BookingShareService } from "../bookings/booking-share.service.js";
import type { EmailSender } from "../identity/email-sender.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { PaymentsRepository } from "./payments.repository.js";
import { SplitCheckoutService } from "./split-checkout.service.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";

/**
 * CDC §26/§25 — paiement partagé, garanties et invitations, validé avec de
 * faux providers (pas de clé Stripe / réseau Doinsport requis).
 */
class CapturingEmailSender implements EmailSender {
  shareUrls: string[] = [];
  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendEmailChangeConfirmation(): Promise<void> {}
  async sendSplitInvitationEmail(_to: string, url: string): Promise<void> {
    this.shareUrls.push(url);
  }
  async sendMigrationInvitation(): Promise<void> {}
  async sendTemplatedEmail(): Promise<void> {}
}

function tokenFromUrl(url: string): string {
  return url.split("/booking-shares/")[1]!;
}

describe("SplitCheckoutService — orchestration CDC §26", () => {
  let prisma: PrismaClient;
  let config: AppConfig;
  let courtId: string;
  let counter = 0;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
    config = loadConfig();

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-split" },
      update: {},
      create: { slug: "test-padel-split", name: "Test Padel Split", courtType: "DOUBLE", capacity: 4, displayOrder: 96 },
    });
    courtId = court.id;

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test split",
        courtId,
        validFrom: new Date("2020-01-01"),
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "00:00",
        endTime: "23:59",
        durationMinutes: 60,
        priceTotalCents: 4800,
        referenceCapacity: 4,
        priority: 10,
        tags: [],
      },
    });
  });

  let organizerUserId: string;
  let participant1Id: string;
  let participant2Id: string;
  let participant3Id: string;

  beforeEach(async () => {
    counter += 1;
    await resetIntegrationTestData(prisma);

    const organizer = await prisma.user.create({
      data: { email: `split-organizer-${counter}@example.com`, passwordHash: "x", firstName: "O", lastName: "T", status: "ACTIVE" },
    });
    organizerUserId = organizer.id;

    const p1 = await prisma.user.create({
      data: { email: `split-p1-${counter}@example.com`, passwordHash: "x", firstName: "P1", lastName: "T", status: "ACTIVE" },
    });
    participant1Id = p1.id;
    const p2 = await prisma.user.create({
      data: { email: `split-p2-${counter}@example.com`, passwordHash: "x", firstName: "P2", lastName: "T", status: "ACTIVE" },
    });
    participant2Id = p2.id;
    const p3 = await prisma.user.create({
      data: { email: `split-p3-${counter}@example.com`, passwordHash: "x", firstName: "P3", lastName: "T", status: "ACTIVE" },
    });
    participant3Id = p3.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  function buildServices(cfg: AppConfig, legacy: FakeLegacyProvider, payment: FakePaymentProvider, emailSender: EmailSender) {
    const bookingsRepo = new BookingsRepository(prisma);
    const courtsRepo = new CourtsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const paymentsRepo = new PaymentsRepository(prisma);
    const guaranteeRepo = new BookingGuaranteeRepository(prisma);
    const guaranteeService = new BookingGuaranteeService(guaranteeRepo, walletService, payment);
    const shareRepo = new BookingShareRepository(prisma);
    const shareService = new BookingShareService(
      shareRepo,
      bookingsRepo,
      paymentsRepo,
      walletService,
      payment,
      guaranteeService,
      emailSender,
      cfg,
      buildTestNotificationService(prisma),
    );
    const bookingsService = new BookingsService(
      bookingsRepo,
      courtsRepo,
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );
    const splitCheckoutService = new SplitCheckoutService(
      bookingsRepo,
      courtsRepo,
      paymentsRepo,
      legacy,
      payment,
      walletService,
      guaranteeService,
      shareService,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );
    return { bookingsService, splitCheckoutService, shareService, guaranteeService, guaranteeRepo, walletService, bookingsRepo };
  }

  async function createSplitBookingWith3Participants(bookingsService: BookingsService, hour: number, invitedEmails?: string[]) {
    const booking = await bookingsService.createBooking({
      organizerUserId,
      courtId,
      startAt: futureMondayIso(hour),
      durationMinutes: 60,
      paymentMode: "SPLIT",
    });
    const ids = [participant1Id, participant2Id, participant3Id];
    for (let i = 0; i < ids.length; i++) {
      await bookingsService.addParticipant({
        bookingId: booking.id,
        requestedByUserId: organizerUserId,
        userId: invitedEmails ? undefined : ids[i],
        invitedEmail: invitedEmails ? invitedEmails[i] : undefined,
        displayName: "Participant",
      });
    }
    return booking;
  }

  function futureMondayIso(hour: number): string {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  it("confirms with a wallet guarantee, splits the price across 4 shares, and shows the fee before validation (CDC §24.5)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: true, SPLIT_SERVICE_FEE_CENTS: 100, SPLIT_SERVICE_FEE_ALLOCATION: "ORGANIZER" as const };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, shareService, walletService } = buildServices(cfg, legacy, payment, emailSender);

    const wallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const booking = await createSplitBookingWith3Participants(bookingsService, 9, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    const result = await splitCheckoutService.checkout({
      bookingId: booking.id,
      userId: organizerUserId,
      paymentMethodId: "pm_card_visa",
      guaranteeType: "WALLET_RESERVE",
    });

    expect(result.bookingStatus).toBe("CONFIRMED");
    expect(result.shareCount).toBe(4);
    expect(result.organizerShareCents).toBe(1300); // 1200 (4800/4) + 100 frais
    expect(result.guaranteedCents).toBe(3600); // 3 x 1200

    const shares = await shareService.listForBooking(booking.id);
    expect(shares).toHaveLength(4);
    expect(shares[0]!.status).toBe("PAID"); // organisateur déjà réglé
    expect(shares.slice(1).every((s) => s.status === "INVITED")).toBe(true);
    expect(shares.slice(1).every((s) => s.totalAmountCents === 1200)).toBe(true);
    expect(emailSender.shareUrls).toHaveLength(3); // une invitation par participant restant
  });

  it("previews the shares and fee without any side effect (CDC §24.5, §54 écran 23)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: true, SPLIT_SERVICE_FEE_CENTS: 100, SPLIT_SERVICE_FEE_ALLOCATION: "ORGANIZER" as const };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, shareService, bookingsRepo } = buildServices(cfg, legacy, payment, emailSender);

    const booking = await createSplitBookingWith3Participants(bookingsService, 9, ["p1@example.com", "p2@example.com", "p3@example.com"]);

    const preview = await splitCheckoutService.previewShares(booking.id, organizerUserId);
    expect(preview.shareCount).toBe(4);
    expect(preview.organizerShareCents).toBe(1300);
    expect(preview.guaranteedCents).toBe(3600);
    expect(preview.shares).toHaveLength(4);

    // Aucun effet de bord : ni claim, ni parts créées, ni e-mail envoyé.
    const untouched = await bookingsRepo.findById(booking.id);
    expect(untouched!.status).toBe("CHECKOUT_PENDING");
    expect(await shareService.listForBooking(booking.id)).toHaveLength(0);
    expect(emailSender.shareUrls).toHaveLength(0);
  });

  it("rejects previewing shares for someone other than the organizer", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService } = buildServices(cfg, legacy, payment, emailSender);

    const booking = await createSplitBookingWith3Participants(bookingsService, 9, ["p1@example.com", "p2@example.com", "p3@example.com"]);

    await expect(splitCheckoutService.previewShares(booking.id, participant1Id)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("lists shares for the organizer after checkout, rejecting a non-organizer", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, shareService, walletService } = buildServices(cfg, legacy, payment, emailSender);

    const wallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });
    const booking = await createSplitBookingWith3Participants(bookingsService, 10, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    await splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" });

    const shares = await shareService.listSharesForOrganizer(booking.id, organizerUserId);
    expect(shares).toHaveLength(4);
    expect(shares[0]!.status).toBe("PAID");

    await expect(shareService.listSharesForOrganizer(booking.id, participant1Id)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("releases the wallet guarantee proportionally as a participant pays their own share via the invitation link", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, shareService, walletService, guaranteeRepo } = buildServices(cfg, legacy, payment, emailSender);

    const organizerWallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: organizerWallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const booking = await createSplitBookingWith3Participants(bookingsService, 10, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    await splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" });

    expect((await guaranteeRepo.findByBookingId(booking.id))?.remainingGuaranteedCents).toBe(3600);
    expect((await walletService.getBalance(organizerWallet.id)).reservedCents).toBe(3600);

    const p1Wallet = await walletService.ensureAccount(participant1Id);
    await walletService.creditFromPackPurchase({ walletAccountId: p1Wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 5000, bonusCreditsCents: 0 });

    const rawToken = tokenFromUrl(emailSender.shareUrls[0]!);
    const paid = await shareService.payShare({ rawToken, payerUserId: participant1Id, fundingSource: "WALLET" });
    expect(paid?.status).toBe("PAID");

    const guaranteeAfter = await guaranteeRepo.findByBookingId(booking.id);
    expect(guaranteeAfter?.remainingGuaranteedCents).toBe(2400); // 3600 - 1200
    expect(guaranteeAfter?.status).toBe("PARTIALLY_RELEASED");
    expect((await walletService.getBalance(organizerWallet.id)).reservedCents).toBe(2400);
    expect((await walletService.getBalance(p1Wallet.id)).totalCents).toBe(5000 - 1200);

    // Rejouer le même lien doit échouer (CDC §26.2 : inutilisable après paiement).
    await expect(shareService.payShare({ rawToken, payerUserId: participant1Id, fundingSource: "WALLET" })).rejects.toThrow();
  });

  it("fully releases the wallet guarantee once every share is paid", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, shareService, walletService, guaranteeRepo } = buildServices(cfg, legacy, payment, emailSender);

    const organizerWallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: organizerWallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const booking = await createSplitBookingWith3Participants(bookingsService, 11, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    await splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" });

    for (const [i, participantId] of [participant1Id, participant2Id, participant3Id].entries()) {
      const w = await walletService.ensureAccount(participantId);
      await walletService.creditFromPackPurchase({ walletAccountId: w.id, creditPackPurchaseId: "seed", paidCreditsCents: 5000, bonusCreditsCents: 0 });
      const rawToken = tokenFromUrl(emailSender.shareUrls[i]!);
      await shareService.payShare({ rawToken, payerUserId: participantId, fundingSource: "WALLET" });
    }

    const guarantee = await guaranteeRepo.findByBookingId(booking.id);
    expect(guarantee?.remainingGuaranteedCents).toBe(0);
    expect(guarantee?.status).toBe("RELEASED");
    expect((await walletService.getBalance(organizerWallet.id)).reservedCents).toBe(0);
  });

  it("captures the remaining card guarantee at régularisation for unpaid shares (CDC §25.1)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, guaranteeService, guaranteeRepo } = buildServices(cfg, legacy, payment, emailSender);

    const booking = await createSplitBookingWith3Participants(bookingsService, 12, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    await splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "CARD_OFF_SESSION" });

    expect((await guaranteeRepo.findByBookingId(booking.id))?.type).toBe("CARD_OFF_SESSION");

    // Aucun participant ne paie -> régularisation à l'échéance.
    const customer = await prisma.user.findUniqueOrThrow({ where: { id: organizerUserId } });
    const result = await guaranteeService.captureRemaining(booking.id, customer.stripeCustomerId ?? "cus_fallback");

    expect(result.capturedCents).toBe(3600);
    const guarantee = await guaranteeRepo.findByBookingId(booking.id);
    expect(guarantee?.status).toBe("CONSUMED");
    expect(guarantee?.remainingGuaranteedCents).toBe(0);
  });

  it("voids the organizer authorization and releases the guarantee on a Legacy collision", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    await prisma.legacyClient.create({
      data: { externalId: `legacy-split-collision-${counter}`, firstName: "L", lastName: "C", lastSyncedAt: new Date(), linkedUserId: organizerUserId },
    });
    const legacy = new FakeLegacyProvider();
    legacy.createBookingResult = "COLLISION";
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, walletService } = buildServices(cfg, legacy, payment, emailSender);

    const wallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const booking = await createSplitBookingWith3Participants(bookingsService, 13, ["p1@example.com", "p2@example.com", "p3@example.com"]);
    await expect(
      splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" }),
    ).rejects.toThrow();

    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("FAILED");
    expect(payment.voidCalls).toHaveLength(1);

    const balance = await walletService.getBalance(wallet.id);
    expect(balance.reservedCents).toBe(0); // garantie libérée, rien capturé
    expect(balance.totalCents).toBe(10000);
  });

  it("rejects a SPLIT checkout with fewer than 2 shares", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const emailSender = new CapturingEmailSender();
    const { bookingsService, splitCheckoutService, walletService } = buildServices(cfg, legacy, payment, emailSender);

    const wallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const booking = await bookingsService.createBooking({
      organizerUserId,
      courtId,
      startAt: futureMondayIso(14),
      durationMinutes: 60,
      paymentMode: "SPLIT",
    });
    await expect(
      splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" }),
    ).rejects.toThrow();
  });
});
