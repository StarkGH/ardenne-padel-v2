import type { Prisma, PrismaClient } from "@prisma/client";
import type { BookingStatus } from "./booking-state-machine.js";

export class BookingsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.BookingCreateInput) {
    return this.db.booking.create({ data });
  }

  findById(id: string) {
    return this.db.booking.findUnique({
      where: { id },
      include: { participants: true, legacyBookingMapping: true, court: true },
    });
  }

  findByOrganizer(organizerUserId: string) {
    return this.db.booking.findMany({
      where: { organizerUserId },
      orderBy: { startAt: "desc" },
      include: { participants: true },
    });
  }

  updateStatus(id: string, status: BookingStatus, extra: Prisma.BookingUpdateInput = {}) {
    return this.db.booking.update({ where: { id }, data: { status, ...extra } });
  }

  createLegacyMapping(bookingId: string, correlationMarker: string) {
    return this.db.legacyBookingMapping.create({ data: { bookingId, correlationMarker } });
  }

  updateLegacyMapping(bookingId: string, data: Prisma.LegacyBookingMappingUpdateInput) {
    return this.db.legacyBookingMapping.update({ where: { bookingId }, data });
  }

  findLegacyClientLinkedToUser(userId: string) {
    return this.db.legacyClient.findFirst({ where: { linkedUserId: userId } });
  }

  addParticipant(data: Prisma.BookingParticipantCreateInput) {
    return this.db.bookingParticipant.create({ data });
  }

  removeParticipant(id: string) {
    return this.db.bookingParticipant.update({ where: { id }, data: { status: "REMOVED" } });
  }
}
