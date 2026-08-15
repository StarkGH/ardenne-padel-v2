import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { buildTestNotificationService } from "../../testing/build-notification-service.js";
import { buildTestAccessGrantService } from "../../testing/build-access-grant-service.js";
import { FakeLegacyProvider } from "../legacy-doinsport/testing/fake-legacy-provider.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { BookingGuaranteeRepository } from "../bookings/booking-guarantee.repository.js";
import { BookingGuaranteeService } from "../bookings/booking-guarantee.service.js";
import { BookingShareRepository } from "../bookings/booking-share.repository.js";
import { BookingShareService } from "../bookings/booking-share.service.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { DevConsoleEmailSender } from "../identity/email-sender.js";
import { generateOpaqueToken } from "../identity/tokens.js";
import { PaymentsRepository } from "./payments.repository.js";
import { CheckoutService } from "./checkout.service.js";
import { SplitCheckoutService } from "./split-checkout.service.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";

/**
 * CDC §67 — tests de concurrence. Chaque scénario déclenche deux requêtes
 * réellement simultanées (`Promise.all`, jamais séquentielles) contre la
 * vraie base, et vérifie qu'une seule transition métier a un effet — jamais
 * un test qui suppose l'atomicité, un test qui la prouve.
 */
describe("Concurrency (CDC §67)", () => {
  let prisma: PrismaClient;
  let config: AppConfig;
  let courtId: string;
  let userCounter = 0;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
    config = loadConfig();

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-concurrency" },
      update: {},
      create: { slug: "test-padel-concurrency", name: "Test Padel Concurrency", courtType: "DOUBLE", capacity: 4, displayOrder: 91 },
    });
    courtId = court.id;

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test concurrency",
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

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  async function createUser(role: "organizer" | "participant" = "organizer") {
    userCounter += 1;
    const user = await prisma.user.create({
      data: { email: `concurrency-${role}-${userCounter}-${Date.now()}@example.com`, passwordHash: "x", firstName: "C", lastName: role, status: "ACTIVE" },
    });
    return user.id;
  }

  function futureMondayIso(hour: number): string {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  function buildBookingsService(cfg: AppConfig, legacy: FakeLegacyProvider) {
    return new BookingsService(
      new BookingsRepository(prisma),
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );
  }

  it("double-clicking FULL checkout produces exactly one wallet hold and one confirmed booking", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = buildBookingsService(cfg, legacy);
    const checkoutService = new CheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      walletRepo,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );

    const wallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });
    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(9), durationMinutes: 60 });

    const attempt = () =>
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", applyWalletCents: 1000 });
    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const holds = await prisma.walletHold.findMany({ where: { bookingId: booking.id } });
    expect(holds).toHaveLength(1);
    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(payments).toHaveLength(1);
    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(finalBooking.status).toBe("CONFIRMED");
  });

  it("double-clicking SPLIT checkout produces exactly one set of shares", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const participantId = await createUser("participant");
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const guaranteeService = new BookingGuaranteeService(new BookingGuaranteeRepository(prisma), walletService, payment);
    const shareService = new BookingShareService(
      new BookingShareRepository(prisma),
      bookingsRepo,
      new PaymentsRepository(prisma),
      walletService,
      payment,
      guaranteeService,
      new DevConsoleEmailSender(),
      cfg,
      buildTestNotificationService(prisma),
    );
    const bookingsService = buildBookingsService(cfg, legacy);
    const splitCheckoutService = new SplitCheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      guaranteeService,
      shareService,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );

    const organizerWallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: organizerWallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });
    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(10), durationMinutes: 60, paymentMode: "SPLIT" });
    await bookingsService.addParticipant({ bookingId: booking.id, requestedByUserId: organizerUserId, userId: participantId, displayName: "P" });

    const attempt = () =>
      splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" });
    const results = await Promise.allSettled([attempt(), attempt()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const shares = await prisma.bookingShare.findMany({ where: { bookingId: booking.id } });
    expect(shares).toHaveLength(2); // organisateur + 1 participant, une seule fois
  });

  it("two concurrent payments of the same SPLIT share result in exactly one PAID share and one wallet debit", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, SPLIT_SERVICE_FEE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const participantId = await createUser("participant");
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const guaranteeService = new BookingGuaranteeService(new BookingGuaranteeRepository(prisma), walletService, payment);
    const shareRepo = new BookingShareRepository(prisma);
    const shareService = new BookingShareService(
      shareRepo,
      bookingsRepo,
      new PaymentsRepository(prisma),
      walletService,
      payment,
      guaranteeService,
      new DevConsoleEmailSender(),
      cfg,
      buildTestNotificationService(prisma),
    );
    const bookingsService = buildBookingsService(cfg, legacy);
    const splitCheckoutService = new SplitCheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      guaranteeService,
      shareService,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );

    const organizerWallet = await walletService.ensureAccount(organizerUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: organizerWallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });
    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(11), durationMinutes: 60, paymentMode: "SPLIT" });
    await bookingsService.addParticipant({ bookingId: booking.id, requestedByUserId: organizerUserId, userId: participantId, displayName: "P" });
    await splitCheckoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", guaranteeType: "WALLET_RESERVE" });

    const shares = await shareRepo.findByBookingId(booking.id);
    const participantShare = shares.find((s) => s.participantUserId === participantId)!;
    // Génère un jeton d'invitation directement (le service ne l'expose que par e-mail en temps normal).
    const { raw, hash } = generateOpaqueToken();
    await prisma.bookingShare.update({
      where: { id: participantShare.id },
      data: { invitationTokenHash: hash, invitationExpiresAt: new Date(Date.now() + 3600_000) },
    });

    const wallet = await walletService.ensureAccount(participantId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 10000, bonusCreditsCents: 0 });

    const attempt = () => shareService.payShare({ rawToken: raw, payerUserId: participantId, fundingSource: "WALLET" });
    const results = await Promise.allSettled([attempt(), attempt()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const finalShare = await shareRepo.findById(participantShare.id);
    expect(finalShare!.status).toBe("PAID");
    const debits = await prisma.walletTransaction.findMany({ where: { walletAccountId: wallet.id, type: "DEBIT_BOOKING" } });
    expect(debits).toHaveLength(1);
  });

  it("concurrent cancellation of the same booking produces exactly one CANCELED transition", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = buildBookingsService(cfg, legacy);
    const checkoutService = new CheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      walletRepo,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(12), durationMinutes: 60 });
    await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" });

    const attempt = () => bookingsService.cancelBooking(booking.id, organizerUserId);
    const results = await Promise.allSettled([attempt(), attempt()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(finalBooking.status).toBe("CANCELED");
    expect(finalBooking.canceledAt).not.toBeNull();
  });

  it("a webhook confirmation arriving concurrently with a duplicate webhook delivery has a single effect (CDC §44)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "requires_action";
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = buildBookingsService(cfg, legacy);
    const checkoutService = new CheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      walletRepo,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(13), durationMinutes: 60 });
    const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_3ds" });
    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    const providerPaymentId = payments[0]!.providerPaymentId;
    expect(result.requiresAction).toBe(true);

    // Stripe livre le même événement deux fois (retry réseau) — traité "en même temps".
    await Promise.allSettled([
      checkoutService.continueAfterAuthorizationConfirmed(providerPaymentId),
      checkoutService.continueAfterAuthorizationConfirmed(providerPaymentId),
    ]);

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(finalBooking.status).toBe("CONFIRMED");
    const finalPayments = await prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(finalPayments).toHaveLength(1);
    expect(finalPayments[0]!.status).toBe("SUCCEEDED");
  });
});
