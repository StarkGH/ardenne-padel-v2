import type { Prisma, PrismaClient } from "@prisma/client";

export class PaymentsRepository {
  constructor(private readonly db: PrismaClient) {}

  createPayment(data: Prisma.PaymentCreateInput) {
    return this.db.payment.create({ data });
  }

  updatePaymentStatus(id: string, data: Prisma.PaymentUpdateInput) {
    return this.db.payment.update({ where: { id }, data });
  }

  findPaymentByProviderPaymentId(providerPaymentId: string) {
    return this.db.payment.findUnique({ where: { providerPaymentId } });
  }

  async findPurposeByProviderPaymentId(providerPaymentId: string) {
    const payment = await this.db.payment.findUnique({ where: { providerPaymentId }, select: { purpose: true } });
    return payment?.purpose ?? null;
  }

  findPaymentById(id: string) {
    return this.db.payment.findUnique({ where: { id } });
  }

  updateUserStripeCustomerId(userId: string, stripeCustomerId: string) {
    return this.db.user.update({ where: { id: userId }, data: { stripeCustomerId } });
  }

  findUserForPayment(userId: string) {
    return this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, stripeCustomerId: true } });
  }

  createRefund(data: Prisma.RefundCreateInput) {
    return this.db.refund.create({ data });
  }

  // --- Déduplication webhook (CDC §44) ---

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const existing = await this.db.webhookEvent.findUnique({ where: { eventId } });
    return Boolean(existing?.processedAt);
  }

  recordEventSeen(eventId: string, eventType: string) {
    return this.db.webhookEvent.upsert({
      where: { eventId },
      update: {},
      create: { eventId, eventType },
    });
  }

  markEventProcessed(eventId: string) {
    return this.db.webhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
  }

  markEventFailed(eventId: string, error: string) {
    return this.db.webhookEvent.update({ where: { eventId }, data: { lastError: error } });
  }
}
