import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { FakeLegacyProvider } from "../legacy-doinsport/testing/fake-legacy-provider.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { PaymentsRepository } from "./payments.repository.js";
import { CheckoutService } from "./checkout.service.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";

/**
 * Orchestration paiement + Legacy (CDC §27.1) — validée avec de faux
 * providers (aucune clé Stripe / aucun réseau Doinsport requis, en attendant
 * un vrai compte Stripe pour Ardenne Padel).
 */
describe("CheckoutService — orchestration CDC §27.1", () => {
  let prisma: PrismaClient;
  let config: AppConfig;
  let courtId: string;
  let organizerCounter = 0;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
    config = loadConfig();

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-payments" },
      update: {},
      create: { slug: "test-padel-payments", name: "Test Padel Payments", courtType: "DOUBLE", capacity: 4, displayOrder: 97 },
    });
    courtId = court.id;

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test payments",
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
  beforeEach(async () => {
    organizerCounter += 1;
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: {
        email: `checkout-${organizerCounter}@example.com`,
        passwordHash: "irrelevant",
        firstName: "Test",
        lastName: "Checkout",
        status: "ACTIVE",
      },
    });
    organizerUserId = user.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  function buildServices(cfg: AppConfig, legacy: FakeLegacyProvider, payment: FakePaymentProvider) {
    const bookingsRepo = new BookingsRepository(prisma);
    const courtsRepo = new CourtsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = new BookingsService(bookingsRepo, courtsRepo, new PricingService(new PricingRepository(prisma)), legacy, cfg);
    const checkoutService = new CheckoutService(
      bookingsRepo,
      courtsRepo,
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      walletRepo,
      cfg,
    );
    return { bookingsService, checkoutService, bookingsRepo, walletService };
  }

  async function linkLegacyClient(userId: string, externalId: string) {
    await prisma.legacyClient.create({
      data: { externalId, firstName: "Legacy", lastName: "Client", lastSyncedAt: new Date(), linkedUserId: userId },
    });
  }

  function futureMondayIso(hour: number): string {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  it("confirms the booking and captures payment when Legacy is disabled (dev/test default)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(10), durationMinutes: 60 });
    expect(booking.status).toBe("CHECKOUT_PENDING");

    const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" });
    expect(result.requiresAction).toBe(false);
    expect(result.bookingStatus).toBe("CONFIRMED");

    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("SUCCEEDED");
    expect(payments[0]!.amountCents).toBe(4800);
  });

  it("rejects checkout from another user (not the organizer)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(11), durationMinutes: 60 });
    await expect(checkoutService.checkout({ bookingId: booking.id, userId: "someone-else", paymentMethodId: "pm_x" })).rejects.toThrow();
  });

  it("fails the booking without creating a Legacy booking when the card is declined", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    await linkLegacyClient(organizerUserId, "legacy-client-declined");
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "failed";
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(12), durationMinutes: 60 });
    await expect(checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_declined" })).rejects.toThrow();

    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("FAILED");
    expect(legacy.lastCreateBookingInput).toBeNull(); // jamais de création Legacy sans paiement autorisé
  });

  it("voids the Stripe authorization and fails the booking on a Legacy collision", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    await linkLegacyClient(organizerUserId, "legacy-client-collision");
    const legacy = new FakeLegacyProvider();
    legacy.createBookingResult = "COLLISION";
    const payment = new FakePaymentProvider();
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(13), durationMinutes: 60 });
    await expect(
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" }),
    ).rejects.toThrow(/vient d'être réservé|BOOKING_SLOT_UNAVAILABLE/);

    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("FAILED");
    expect(payment.voidCalls).toHaveLength(1); // autorisation libérée, jamais capturée
    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(payments[0]!.status).toBe("CANCELED");
  });

  it("goes to MANUAL_REVIEW without voiding the authorization on an ambiguous Legacy failure (CDC §16.2)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    await linkLegacyClient(organizerUserId, "legacy-client-error");
    const legacy = new FakeLegacyProvider();
    legacy.createBookingResult = "ERROR";
    const payment = new FakePaymentProvider();
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(14), durationMinutes: 60 });
    await expect(
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" }),
    ).rejects.toThrow();

    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("MANUAL_REVIEW");
    expect(payment.voidCalls).toHaveLength(0); // jamais d'hypothèse silencieuse -> pas de void aveugle

    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(payments[0]!.status).toBe("AUTHORIZED"); // argent bloqué, ni capturé ni libéré
  });

  it("goes to MANUAL_REVIEW without confirming when Legacy succeeds but the capture fails", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    await linkLegacyClient(organizerUserId, "legacy-client-capture-fail");
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.captureShouldFail = true;
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(15), durationMinutes: 60 });
    await expect(
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" }),
    ).rejects.toThrow();

    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("MANUAL_REVIEW");
    expect(legacy.lastCreateBookingInput).not.toBeNull(); // Legacy a bien été créé
  });

  it("holds the booking pending 3D Secure, then confirms once the webhook signals the authorization is confirmed", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "requires_action";
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(16), durationMinutes: 60 });
    const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_3ds" });

    expect(result.requiresAction).toBe(true);
    expect(result.clientSecret).toBeDefined();
    const midway = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(midway.status).toBe("CHECKOUT_PENDING"); // pas encore avancé, en attente du client

    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    const providerPaymentId = payments[0]!.providerPaymentId;

    // Simule la fin du 3DS côté client -> webhook payment_intent.amount_capturable_updated
    await checkoutService.continueAfterAuthorizationConfirmed(providerPaymentId);

    const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("is idempotent when the webhook is delivered twice (CDC §44 — never a second effect)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "requires_action";
    const { bookingsService, checkoutService } = buildServices(cfg, legacy, payment);

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(17), durationMinutes: 60 });
    await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_3ds" });
    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    const providerPaymentId = payments[0]!.providerPaymentId;

    await checkoutService.continueAfterAuthorizationConfirmed(providerPaymentId);
    await checkoutService.continueAfterAuthorizationConfirmed(providerPaymentId); // second appel, doit être un no-op

    const confirmedAtHistory = await prisma.payment.findUnique({ where: { providerPaymentId } });
    expect(confirmedAtHistory?.status).toBe("SUCCEEDED"); // pas de double capture, pas d'erreur
  });

  describe("paiement wallet (CDC §27.3, §28.7)", () => {
    it("confirms with 100% wallet and never creates a Stripe transaction (CDC §28.8)", async () => {
      const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
      const legacy = new FakeLegacyProvider();
      const payment = new FakePaymentProvider();
      const { bookingsService, checkoutService, walletService } = buildServices(cfg, legacy, payment);

      const wallet = await walletService.ensureAccount(organizerUserId);
      await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

      const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(9), durationMinutes: 60 });
      const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, applyWalletCents: 10000 });

      expect(result.requiresAction).toBe(false);
      expect(result.walletAppliedCents).toBe(4800);
      expect(result.bookingStatus).toBe("CONFIRMED");
      expect(result.paymentId).toBeUndefined(); // aucune transaction Stripe créée

      const balance = await walletService.getBalance(wallet.id);
      expect(balance.totalCents).toBe(10000 - 4800);
      expect(balance.reservedCents).toBe(0);
    });

    it("splits payment between wallet and card when the wallet balance is insufficient", async () => {
      const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
      const legacy = new FakeLegacyProvider();
      const payment = new FakePaymentProvider();
      const { bookingsService, checkoutService, walletService } = buildServices(cfg, legacy, payment);

      const wallet = await walletService.ensureAccount(organizerUserId);
      await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 2000, bonusCreditsCents: 0 });

      const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(9), durationMinutes: 60 });
      const result = await checkoutService.checkout({
        bookingId: booking.id,
        userId: organizerUserId,
        applyWalletCents: 2000,
        paymentMethodId: "pm_card_visa",
      });

      expect(result.walletAppliedCents).toBe(2000); // tout le disponible
      expect(result.bookingStatus).toBe("CONFIRMED");
      expect(result.paymentId).toBeDefined(); // le solde (2800) est passé par Stripe

      const balance = await walletService.getBalance(wallet.id);
      expect(balance.totalCents).toBe(0);

      const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
      expect(payments[0]!.amountCents).toBe(2800); // 4800 - 2000
      expect(payments[0]!.status).toBe("SUCCEEDED");
    });

    it("releases the wallet hold without spending credits on a Legacy collision", async () => {
      const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
      await linkLegacyClient(organizerUserId, "legacy-client-wallet-collision");
      const legacy = new FakeLegacyProvider();
      legacy.createBookingResult = "COLLISION";
      const payment = new FakePaymentProvider();
      const { bookingsService, checkoutService, walletService } = buildServices(cfg, legacy, payment);

      const wallet = await walletService.ensureAccount(organizerUserId);
      await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

      const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(9), durationMinutes: 60 });
      await expect(
        checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, applyWalletCents: 10000 }),
      ).rejects.toThrow();

      const balance = await walletService.getBalance(wallet.id);
      expect(balance.totalCents).toBe(10000); // rien dépensé
      expect(balance.reservedCents).toBe(0); // hold libéré, pas capturé
    });

    it("requires a payment method when the wallet does not cover the full amount", async () => {
      const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
      const legacy = new FakeLegacyProvider();
      const payment = new FakePaymentProvider();
      const { bookingsService, checkoutService, walletService } = buildServices(cfg, legacy, payment);

      const wallet = await walletService.ensureAccount(organizerUserId);
      await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 1000, bonusCreditsCents: 0 });

      const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(9), durationMinutes: 60 });
      await expect(
        checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, applyWalletCents: 1000 }),
      ).rejects.toThrow();

      // Le hold créé pour la tentative doit avoir été libéré, pas laissé en l'air.
      const balance = await walletService.getBalance(wallet.id);
      expect(balance.reservedCents).toBe(0);
      expect(balance.totalCents).toBe(1000);
    });
  });
});
