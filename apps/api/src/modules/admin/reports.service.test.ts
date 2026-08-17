import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { ReportsService } from "./reports.service.js";

/** CDC V-018, docs/tva.md — chiffre d'affaires réservations pour la déclaration TVA. */
describe("ReportsService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-reports" },
      update: {},
      create: { slug: "test-padel-reports", name: "Test Padel Reports", courtType: "DOUBLE", capacity: 4, displayOrder: 89 },
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
      data: { email: `reports-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "R", lastName: "P", status: "ACTIVE" },
    });
    userId = user.id;
  });

  async function createBooking(priceTotalCents: number, status: "CONFIRMED" | "COMPLETED" | "CANCELED" | "DRAFT", confirmedAt: Date | null) {
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: priceTotalCents,
        priceTotalCents,
        status,
        confirmedAt: confirmedAt ?? undefined,
      },
    });
  }

  it("sums confirmed bookings by day and splits the total into TVAC/HTVA/TVA at the configured rate", async () => {
    const day1 = new Date("2026-06-01T10:00:00.000Z");
    const day1b = new Date("2026-06-01T18:00:00.000Z");
    const day2 = new Date("2026-06-02T10:00:00.000Z");

    await createBooking(4800, "CONFIRMED", day1);
    await createBooking(3600, "COMPLETED", day1b);
    await createBooking(2400, "CONFIRMED", day2);

    const service = new ReportsService(prisma, loadConfig());
    const report = await service.bookingsRevenue(new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-02T23:59:59.999Z"));

    expect(report.vatRatePercent).toBe(6);
    expect(report.days).toHaveLength(2);

    const [d1, d2] = report.days;
    expect(d1!.date).toBe("2026-06-01");
    expect(d1!.bookingsCount).toBe(2);
    expect(d1!.revenueTotalCents).toBe(8400);
    expect(d1!.revenueExVatCents + d1!.vatCents).toBe(8400);
    expect(d1!.revenueExVatCents).toBe(Math.round(8400 / 1.06));

    expect(d2!.date).toBe("2026-06-02");
    expect(d2!.bookingsCount).toBe(1);
    expect(d2!.revenueTotalCents).toBe(2400);

    expect(report.summary.bookingsCount).toBe(3);
    expect(report.summary.revenueTotalCents).toBe(10800);
    expect(report.summary.revenueExVatCents + report.summary.vatCents).toBe(10800);
  });

  it("excludes bookings outside the requested range, not yet confirmed, or canceled", async () => {
    await createBooking(4800, "CONFIRMED", new Date("2026-05-31T23:59:00.000Z")); // avant la fenêtre
    await createBooking(4800, "CONFIRMED", new Date("2026-06-03T00:01:00.000Z")); // après la fenêtre
    await createBooking(4800, "DRAFT", null); // jamais confirmée
    await createBooking(4800, "CANCELED", new Date("2026-06-01T10:00:00.000Z")); // annulée malgré confirmedAt (scénario défensif)

    const service = new ReportsService(prisma, loadConfig());
    const report = await service.bookingsRevenue(new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-02T23:59:59.999Z"));

    expect(report.days).toHaveLength(0);
    expect(report.summary.bookingsCount).toBe(0);
    expect(report.summary.revenueTotalCents).toBe(0);
  });

  it("returns an empty report for a range with no confirmed bookings", async () => {
    const service = new ReportsService(prisma, loadConfig());
    const report = await service.bookingsRevenue(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(report.days).toEqual([]);
    expect(report.summary).toEqual({ date: "TOTAL", bookingsCount: 0, revenueTotalCents: 0, revenueExVatCents: 0, vatCents: 0 });
  });
});
