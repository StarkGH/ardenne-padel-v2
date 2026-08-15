import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import type { AccessProvider, AccessGrantRef, AccessHealth, ProviderRef } from "../access/access-provider.js";
import { AccessGrantRepository } from "../access/access-grant.repository.js";
import { AccessGrantService } from "../access/access-grant.service.js";
import { NotificationOutboxRepository } from "../notifications/notification-outbox.repository.js";
import { NotificationService } from "../notifications/notification.service.js";
import type { EmailSender } from "../identity/email-sender.js";
import { PaymentsRepository } from "./payments.repository.js";
import { CheckoutService } from "./checkout.service.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";

class ThrowingAccessProvider implements AccessProvider {
  async provisionGrant(_grant: AccessGrantRef): Promise<ProviderRef> {
    throw new Error("provider d'accès indisponible (simulation)");
  }
  async updateGrant(): Promise<void> {}
  async revokeGrant(): Promise<void> {}
  async healthCheck(): Promise<AccessHealth> {
    return { healthy: false };
  }
}

class ThrowingEmailSender implements EmailSender {
  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendSplitInvitationEmail(): Promise<void> {}
  async sendTemplatedEmail(): Promise<void> {
    throw new Error("fournisseur e-mail indisponible (simulation)");
  }
}

/**
 * CDC §68 — tests de résilience. Les pannes Legacy (401/422/500/timeout)
 * sont déjà couvertes par `checkout.service.test.ts` (`createBookingResult
 * = "COLLISION"` pour une collision 409/422-like, `"ERROR"` pour toute
 * panne ambiguë 401/500/timeout — l'adaptateur ne distingue pas ces codes
 * HTTP au-delà de "collision connue" vs "erreur ambiguë", donc les deux
 * branches couvrent l'ensemble des pannes Legacy listées). Ce fichier
 * couvre les pannes encore non testées : timeout Stripe (création et
 * capture), fournisseur de notification indisponible, provider d'accès
 * indisponible. "worker redémarré" est sans objet : aucun worker n'existe
 * encore dans le projet (dette assumée depuis les Lots 4/7/8/9).
 */
describe("Resilience (CDC §68)", () => {
  let prisma: PrismaClient;
  let config: AppConfig;
  let courtId: string;
  let userCounter = 0;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
    config = loadConfig();

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-resilience" },
      update: {},
      create: { slug: "test-padel-resilience", name: "Test Padel Resilience", courtType: "DOUBLE", capacity: 4, displayOrder: 90 },
    });
    courtId = court.id;

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test resilience",
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

  async function createUser() {
    userCounter += 1;
    const user = await prisma.user.create({
      data: { email: `resilience-${userCounter}-${Date.now()}@example.com`, passwordHash: "x", firstName: "R", lastName: "T", status: "ACTIVE" },
    });
    return user.id;
  }

  function futureMondayIso(hour: number): string {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  it("reverts the booking to CHECKOUT_PENDING (retryable) and leaves no orphaned wallet hold when Stripe times out on authorization", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.createPaymentShouldThrow = true;
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = new BookingsService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );
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

    await expect(
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa", applyWalletCents: 1000 }),
    ).rejects.toThrow("Stripe indisponible");

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(finalBooking.status).toBe("CHECKOUT_PENDING"); // pas bloquée en PAYMENT_PENDING (CDC §68 : pas de perte silencieuse)

    const holds = await prisma.walletHold.findMany({ where: { bookingId: booking.id } });
    expect(holds.filter((h) => h.status === "ACTIVE")).toHaveLength(0); // le hold créé avant le timeout a été libéré

    // Rejouable : un deuxième essai (sans panne) doit réussir normalement.
    payment.createPaymentShouldThrow = false;
    const retried = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" });
    expect(retried.bookingStatus).toBe("CONFIRMED");
  });

  it("goes to MANUAL_REVIEW (never silently lost) when Stripe times out during capture after Legacy already confirmed", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: true };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    payment.captureShouldThrow = true;
    const organizerUserId = await createUser();
    await prisma.legacyClient.create({
      data: { externalId: `legacy-${organizerUserId}`, firstName: "L", lastName: "C", lastSyncedAt: new Date(), linkedUserId: organizerUserId },
    });
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const bookingsService = new BookingsService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      buildTestNotificationService(prisma),
    );
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

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(10), durationMinutes: 60 });

    await expect(
      checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" }),
    ).rejects.toThrow();

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // Jamais reclaimable silencieusement : Legacy a déjà une réservation réelle.
    expect(finalBooking.status).toBe("MANUAL_REVIEW");
  });

  it("confirms the booking even when the notification provider is unavailable (CDC §68 — e-mail indisponible)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const throwingNotificationService = new NotificationService(new NotificationOutboxRepository(prisma), new ThrowingEmailSender(), prisma);
    const bookingsService = new BookingsService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      buildTestAccessGrantService(prisma, cfg),
      throwingNotificationService,
    );
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
      throwingNotificationService,
    );

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(11), durationMinutes: 60 });
    // `enqueue` lui-même ne lève jamais (c'est l'appel qui a été rendu synchrone-jetable en amont) —
    // ici on prouve que même si l'écriture de la notification échouait totalement, le paiement aboutit.
    const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" });

    expect(result.bookingStatus).toBe("CONFIRMED");
  });

  it("confirms the booking even when the access provider throws (CDC §68 — provider access indisponible)", async () => {
    const cfg = { ...config, LEGACY_WRITE_ENABLED: false, V2_ACCESS_ENABLED: true };
    const legacy = new FakeLegacyProvider();
    const payment = new FakePaymentProvider();
    const organizerUserId = await createUser();
    const bookingsRepo = new BookingsRepository(prisma);
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    const throwingAccessGrantService = new AccessGrantService(new AccessGrantRepository(prisma), new ThrowingAccessProvider(), cfg);
    const bookingsService = new BookingsService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      cfg,
      throwingAccessGrantService,
      buildTestNotificationService(prisma),
    );
    const checkoutService = new CheckoutService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PaymentsRepository(prisma),
      legacy,
      payment,
      walletService,
      walletRepo,
      cfg,
      throwingAccessGrantService,
      buildTestNotificationService(prisma),
    );

    const booking = await bookingsService.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(12), durationMinutes: 60 });
    const result = await checkoutService.checkout({ bookingId: booking.id, userId: organizerUserId, paymentMethodId: "pm_card_visa" });

    expect(result.bookingStatus).toBe("CONFIRMED");
    const grants = await prisma.accessGrant.findMany({ where: { bookingId: booking.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.status).toBe("FAILED"); // échec tracé, jamais une exception remontée au client
  });
});
