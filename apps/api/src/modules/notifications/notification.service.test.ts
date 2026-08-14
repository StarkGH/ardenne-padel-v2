import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import type { EmailSender } from "../identity/email-sender.js";
import { NotificationOutboxRepository } from "./notification-outbox.repository.js";
import { NotificationService } from "./notification.service.js";

class CapturingEmailSender implements EmailSender {
  sent: Array<{ to: string; template: string; payload: Record<string, unknown> }> = [];
  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendSplitInvitationEmail(): Promise<void> {}
  async sendTemplatedEmail(to: string, template: string, payload: Record<string, unknown>): Promise<void> {
    this.sent.push({ to, template, payload });
  }
}

/**
 * CDC §37.3 — outbox durable : `enqueue` persiste toujours, `dispatchDue`
 * est une tentative d'envoi séparée dont l'échec n'affecte jamais
 * l'écriture d'origine. Contre une vraie base (jamais de mock du domaine).
 */
describe("NotificationService", () => {
  const prisma = new PrismaClient();
  let userId: string;

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `notif-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "N", lastName: "T", status: "ACTIVE" },
    });
    userId = user.id;
  });

  it("enqueues a notification as PENDING even before any dispatch attempt", async () => {
    const repo = new NotificationOutboxRepository(prisma);
    const service = new NotificationService(repo, new CapturingEmailSender(), prisma);

    await service.enqueue({ template: "BOOKING_CONFIRMATION", recipientUserId: userId, payload: { bookingId: "b1" } });

    const due = await repo.findDue(new Date(), 10);
    expect(due).toHaveLength(1);
    expect(due[0]!.status).toBe("PENDING");
  });

  it("dispatches a due notification, resolving the recipient e-mail from the user id at send time", async () => {
    const repo = new NotificationOutboxRepository(prisma);
    const sender = new CapturingEmailSender();
    const service = new NotificationService(repo, sender, prisma);
    await service.enqueue({ template: "BOOKING_CONFIRMATION", recipientUserId: userId, payload: { bookingId: "b1" } });

    const result = await service.dispatchDue();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sender.sent).toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(sender.sent[0]!.to).toBe(user.email);
    expect(sender.sent[0]!.template).toBe("BOOKING_CONFIRMATION");
  });

  it("uses recipientEmail directly for recipients without a user account (e.g. SPLIT invitees)", async () => {
    const repo = new NotificationOutboxRepository(prisma);
    const sender = new CapturingEmailSender();
    const service = new NotificationService(repo, sender, prisma);
    await service.enqueue({ template: "PARTICIPANT_INVITATION", recipientEmail: "guest@example.com", payload: {} });

    await service.dispatchDue();

    expect(sender.sent[0]!.to).toBe("guest@example.com");
  });

  it("does not pick up a notification scheduled in the future", async () => {
    const repo = new NotificationOutboxRepository(prisma);
    const sender = new CapturingEmailSender();
    const service = new NotificationService(repo, sender, prisma);
    const inOneHour = new Date(Date.now() + 3600_000);
    await service.enqueue({ template: "BOOKING_REMINDER", recipientUserId: userId, payload: {}, scheduledFor: inOneHour });

    const result = await service.dispatchDue();

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sender.sent).toHaveLength(0);
  });

  it("marks a notification FAILED and records the error when the recipient cannot be resolved, without throwing", async () => {
    const repo = new NotificationOutboxRepository(prisma);
    const sender = new CapturingEmailSender();
    const service = new NotificationService(repo, sender, prisma);
    await service.enqueue({ template: "BOOKING_CONFIRMATION", recipientUserId: "00000000-0000-0000-0000-000000000000", payload: {} });

    const result = await service.dispatchDue();

    expect(result).toEqual({ sent: 0, failed: 1 });
    const due = await repo.findDue(new Date(), 10);
    // Toujours PENDING (pas d'infra de retry/backoff au Lot 8 — voir ADR-0016),
    // mais `attempts`/`lastError` tracent l'échec pour une reprise manuelle.
    expect(due).toHaveLength(1);
    expect(due[0]!.attempts).toBe(1);
    expect(due[0]!.lastError).toBeTruthy();
  });
});
