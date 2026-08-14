import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Booking } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AccessGrantRepository } from "./access-grant.repository.js";
import { AccessGrantService } from "./access-grant.service.js";
import { LocalAccessProvider } from "./local-access-provider.js";

/**
 * CDC §34-§36 — génération/révocation de codes d'accès V2, coexistence avec
 * les codes Legacy (§35/§78), contre une vraie base (jamais de mock du
 * domaine).
 */
describe("AccessGrantService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-access" },
      update: {},
      create: { slug: "test-padel-access", name: "Test Padel Access", courtType: "DOUBLE", capacity: 4, displayOrder: 96 },
    });
    courtId = court.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `access-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "B", status: "ACTIVE" },
    });
    userId = user.id;
  });

  function buildConfig(overrides: Partial<AppConfig>): AppConfig {
    return { ...loadConfig(), ...overrides };
  }

  async function createBookingRow(hour: number): Promise<Booking> {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: start,
        endAt: end,
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
      },
    });
  }

  it("does nothing when V2_ACCESS_ENABLED is false (default)", async () => {
    const config = buildConfig({ V2_ACCESS_ENABLED: false });
    const service = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const booking = await createBookingRow(9);

    await service.provisionOrImportForBooking(booking);

    const grants = await service.revealForBooking(booking.id);
    expect(grants).toHaveLength(0);
  });

  it("generates and provisions a V2 code when enabled, revealable to the organizer", async () => {
    const config = buildConfig({ V2_ACCESS_ENABLED: true });
    const service = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const booking = await createBookingRow(10);

    await service.provisionOrImportForBooking(booking);

    const grants = await service.revealForBooking(booking.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.origin).toBe("V2_GENERATED");
    expect(grants[0]!.status).toBe("ACTIVE");
    expect(grants[0]!.code).toMatch(/^\d{4}#$/);
  });

  it("imports Legacy codes instead of generating a V2 one when LEGACY_ACCESS_IMPORT_ENABLED (CDC §35/§78)", async () => {
    const config = buildConfig({ V2_ACCESS_ENABLED: true, LEGACY_ACCESS_IMPORT_ENABLED: true });
    const service = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const booking = await createBookingRow(11);

    await service.provisionOrImportForBooking(booking, [{ code: "7777#", playgroundName: "Padel 1" }]);

    const grants = await service.revealForBooking(booking.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.origin).toBe("LEGACY_IMPORTED");
    expect(grants[0]!.code).toBe("7777#");
  });

  it("never shows two concurrent codes for the same booking (Legacy import skips V2 generation)", async () => {
    const config = buildConfig({ V2_ACCESS_ENABLED: true, LEGACY_ACCESS_IMPORT_ENABLED: true });
    const service = new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
    const booking = await createBookingRow(12);

    await service.provisionOrImportForBooking(booking, [{ code: "1111#" }]);
    const grants = await service.revealForBooking(booking.id);
    expect(grants).toHaveLength(1);
  });

  it("revokes an active grant on cancellation", async () => {
    const config = buildConfig({ V2_ACCESS_ENABLED: true });
    const repo = new AccessGrantRepository(prisma);
    const service = new AccessGrantService(repo, new LocalAccessProvider(), config);
    const booking = await createBookingRow(13);
    await service.provisionOrImportForBooking(booking);

    await service.revokeForBooking(booking.id);

    const grants = await repo.findByBookingId(booking.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.status).toBe("REVOKED");
    expect(grants[0]!.revokedAt).not.toBeNull();

    // Un grant révoqué ne doit plus être exposé à l'organisateur.
    expect(await service.revealForBooking(booking.id)).toHaveLength(0);
  });
});
