import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { FakeLegacyProvider } from "./testing/fake-legacy-provider.js";
import { LegacyDoinsportRepository } from "./legacy-doinsport.repository.js";
import { LegacySyncScheduler } from "./legacy-sync-scheduler.js";
import type { DateRange } from "./types.js";
import { AccessGrantRepository } from "../access/access-grant.repository.js";
import { AccessGrantService } from "../access/access-grant.service.js";
import { LocalAccessProvider } from "../access/local-access-provider.js";
import { encryptAccessCode } from "../access/access-code-crypto.js";
import { hashPassword } from "../identity/password.js";

/** CDC §15.3 — scheduler de synchro Doinsport (sync fréquente + réconciliation). */
describe("LegacySyncScheduler", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetConfigCacheForTests();
  });

  function buildConfig(overrides: Partial<AppConfig>): AppConfig {
    return { ...loadConfig(), ...overrides };
  }

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  let createdCourtIds: string[] = [];

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    createdCourtIds = [];
  });

  afterEach(async () => {
    // Court/LegacyCourtMapping ne sont pas purgés par resetIntegrationTestData
    // (données quasi-statiques, comme les autres tests d'availability) —
    // nettoyage explicite de ce que ce fichier crée, cascade sur le mapping.
    for (const courtId of createdCourtIds) {
      await prisma.court.delete({ where: { id: courtId } }).catch(() => {});
    }
  });

  async function createCourtWithMapping(legacyPlaygroundId = `pg-${Date.now()}-${Math.random()}`) {
    const slug = `test-scheduler-court-${Date.now()}-${Math.random()}`;
    const court = await prisma.court.create({
      data: { slug, name: `Court ${slug}`, courtType: "DOUBLE", capacity: 4, displayOrder: 99 },
    });
    createdCourtIds.push(court.id);
    await prisma.legacyCourtMapping.create({
      data: { courtId: court.id, legacyPlaygroundId, legacyActivityId: "activity-1" },
    });
    return { court, legacyPlaygroundId };
  }

  /** Double contrôlable : renvoie une réservation fixe, avec un frein optionnel pour tester la garde anti-chevauchement. */
  class ControllableProvider extends FakeLegacyProvider {
    bookings: { id: string; startAt: string; endAt: string; playgroundIds: string[]; raw?: unknown; canceled?: boolean }[] = [];
    blocker: Promise<void> = Promise.resolve();

    override async listBookings(_range: DateRange) {
      await this.blocker;
      return this.bookings.map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt, canceled: b.canceled ?? false }));
    }
    override async getBooking(id: string) {
      const b = this.bookings.find((x) => x.id === id)!;
      return {
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        canceled: b.canceled ?? false,
        comment: null,
        playgroundIds: b.playgroundIds,
        accessCodes: [],
        bookingOwnerClientId: null,
        raw: b.raw ?? null,
      };
    }
  }

  function buildScheduler(provider: ControllableProvider) {
    const repo = new LegacyDoinsportRepository(prisma);
    const config = buildConfig({});
    const accessGrantService = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    return { scheduler: new LegacySyncScheduler(config, prisma, provider, repo, accessGrantService), repo };
  }

  it("runFastSync importe les réservations proches et trace un LegacySyncRun BOOKINGS", async () => {
    const { legacyPlaygroundId } = await createCourtWithMapping();
    const provider = new ControllableProvider();
    provider.bookings = [{ id: "b1", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600_000).toISOString(), playgroundIds: [legacyPlaygroundId] }];
    const { scheduler } = buildScheduler(provider);

    await scheduler.runFastSync();

    const runs = await prisma.legacySyncRun.findMany({ where: { kind: "BOOKINGS" } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("SUCCESS");
    const booking = await prisma.legacyBooking.findFirst({ where: { externalId: "b1" } });
    expect(booking).not.toBeNull();
  });

  it("importBookings écrit les participants dénormalisés (nom + compteur de réservations actives) et le statut de paiement (CDC §55 écran 3)", async () => {
    const { legacyPlaygroundId } = await createCourtWithMapping();
    const provider = new ControllableProvider();
    provider.bookings = [
      {
        id: "b-participants-1",
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 3600_000).toISOString(),
        playgroundIds: [legacyPlaygroundId],
        raw: {
          participants: [
            { client: { id: "client-alain-1", firstName: "Alain", lastName: "Monfort" }, canceled: false, price: 1200 },
            { client: { id: "client-alain-2", firstName: "Alain", lastName: "Samray" }, canceled: false, price: 1200 },
          ],
          payments: [{ payment: { status: "succeeded", amountReceived: 1200 } }], // ne couvre qu'un des deux participants
        },
      },
    ];
    // Compteur interrogé en direct auprès de Doinsport (countActiveBookingsForClient),
    // jamais recalculé depuis les lignes locales — voir ADR-0038 addendum "Planning enrichi".
    provider.activeBookingsCountByClient = { "client-alain-1": 101, "client-alain-2": 80 };
    const { scheduler } = buildScheduler(provider);

    await scheduler.runFastSync();

    const booking = await prisma.legacyBooking.findFirstOrThrow({ where: { externalId: "b-participants-1" } });
    expect(booking.fullyPaid).toBe(false);
    expect(booking.priceDueCents).toBe(2400);
    expect(booking.priceReceivedCents).toBe(1200);
    const participants = await prisma.legacyBookingParticipant.findMany({ where: { legacyBookingId: booking.id } });
    expect(participants).toHaveLength(2);
    expect(participants.find((p) => p.legacyClientId === "client-alain-1")?.activeBookingsCount).toBe(101);
    expect(participants.find((p) => p.legacyClientId === "client-alain-2")?.activeBookingsCount).toBe(80);
    expect(participants.every((p) => p.priceCents === 1200)).toBe(true);
    expect(participants.map((p) => p.lastName).sort()).toEqual(["Monfort", "Samray"]);
  });

  it("runReconciliation trace un run CLIENTS puis un run BOOKINGS", async () => {
    const provider = new ControllableProvider();
    const { scheduler } = buildScheduler(provider);

    await scheduler.runReconciliation();

    const clientRuns = await prisma.legacySyncRun.findMany({ where: { kind: "CLIENTS" } });
    const bookingRuns = await prisma.legacySyncRun.findMany({ where: { kind: "BOOKINGS" } });
    expect(clientRuns).toHaveLength(1);
    expect(bookingRuns).toHaveLength(1);
  });

  it("ignore une sync fréquente déclenchée pendant qu'une précédente est encore en cours", async () => {
    const { legacyPlaygroundId } = await createCourtWithMapping();
    const provider = new ControllableProvider();
    provider.bookings = [{ id: "b2", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600_000).toISOString(), playgroundIds: [legacyPlaygroundId] }];
    let release!: () => void;
    provider.blocker = new Promise((resolve) => { release = resolve; });
    const { scheduler } = buildScheduler(provider);

    const first = scheduler.runFastSync();
    const second = scheduler.runFastSync();
    release();
    await Promise.all([first, second]);

    const runs = await prisma.legacySyncRun.findMany({ where: { kind: "BOOKINGS" } });
    expect(runs).toHaveLength(1);
  });

  /**
   * Gap trouvé le 2026-09-11 : une réservation Dual Run annulée directement
   * côté Doinsport (staff utilisant encore l'ancien back-office) laissait
   * jusque-là le code d'accès V2 actif indéfiniment — seul le sens
   * V2 -> Doinsport (BookingsService.cancel) révoquait le code.
   */
  it("révoque le code d'accès d'une réservation Dual Run annulée directement côté Doinsport", async () => {
    const { court, legacyPlaygroundId } = await createCourtWithMapping();
    const config = buildConfig({});
    const accessGrantRepo = new AccessGrantRepository(prisma);
    const accessGrantService = new AccessGrantService(accessGrantRepo, new LocalAccessProvider(), config);

    const user = await prisma.user.create({
      data: { email: `scheduler-revoke-${Date.now()}@example.com`, passwordHash: await hashPassword("MotDePasseSolide123"), firstName: "T", lastName: "U", status: "ACTIVE" },
    });
    const startAt = new Date(Date.now() + 24 * 3600_000);
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: user.id } },
        court: { connect: { id: court.id } },
        startAt,
        endAt: new Date(startAt.getTime() + 3600_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });
    await prisma.legacyBookingMapping.create({
      data: { bookingId: booking.id, legacyBookingId: "legacy-dual-run-1", correlationMarker: `marker-${Date.now()}`, syncStatus: "CONFIRMED" },
    });
    const { ciphertext, iv } = encryptAccessCode(config, "4242#");
    const grant = await accessGrantRepo.create({
      booking: { connect: { id: booking.id } },
      codeCiphertext: ciphertext,
      codeIv: iv,
      origin: "LEGACY_IMPORTED",
      scope: court.id,
      status: "ACTIVE",
      validFrom: startAt,
      validUntil: new Date(startAt.getTime() + 3600_000),
    });

    const provider = new ControllableProvider();
    provider.bookings = [
      { id: "legacy-dual-run-1", startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 3600_000).toISOString(), playgroundIds: [legacyPlaygroundId], canceled: true },
    ];
    const repo = new LegacyDoinsportRepository(prisma);
    const scheduler = new LegacySyncScheduler(config, prisma, provider, repo, accessGrantService);

    await scheduler.runReconciliation();

    const reloaded = await accessGrantRepo.findById(grant.id);
    expect(reloaded!.status).toBe("REVOKED");
    expect(reloaded!.revokedAt).not.toBeNull();
  });

  it("ne démarre aucun minuteur quand la synchro est désactivée en configuration", () => {
    const provider = new ControllableProvider();
    const repo = new LegacyDoinsportRepository(prisma);
    const config = buildConfig({ LEGACY_SYNC_ENABLED: false });
    const accessGrantService = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const scheduler = new LegacySyncScheduler(config, prisma, provider, repo, accessGrantService);

    expect(() => scheduler.start()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("ne démarre aucun minuteur si les identifiants Doinsport sont absents", () => {
    const provider = new ControllableProvider();
    const repo = new LegacyDoinsportRepository(prisma);
    const config = buildConfig({
      LEGACY_SYNC_ENABLED: true,
      DOINSPORT_CLUB_LOGIN: undefined,
      DOINSPORT_CLUB_PASSWORD: undefined,
      DOINSPORT_CLUB_ID: undefined,
    });
    const accessGrantService = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const scheduler = new LegacySyncScheduler(config, prisma, provider, repo, accessGrantService);

    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
  });
});
