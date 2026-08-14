import type { NotificationTemplate, Prisma, PrismaClient } from "@prisma/client";
import { logger } from "@ardenne/shared";
import type { EmailSender } from "../identity/email-sender.js";
import type { NotificationOutboxRepository } from "./notification-outbox.repository.js";

export interface EnqueueNotificationInput {
  template: NotificationTemplate;
  recipientUserId?: string;
  recipientEmail?: string;
  payload: Record<string, unknown>;
  /** Différé (rappel avant réservation) — par défaut immédiat. */
  scheduledFor?: Date;
}

const DEFAULT_DISPATCH_BATCH_SIZE = 50;
/** Au-delà, on arrête de réessayer automatiquement (pas d'infra de backoff au Lot 8) — reprise manuelle via l'outbox. */
const MAX_DISPATCH_ATTEMPTS = 5;

/**
 * CDC §37.3 — outbox durable : `enqueue` persiste toujours la notification
 * avant de tenter quoi que ce soit d'autre, jamais l'inverse. `dispatchDue`
 * est une tentative d'envoi best-effort séparée : son échec (SMTP
 * indisponible) ne fait jamais rejouer ni annuler la transaction métier qui
 * a appelé `enqueue`. Comme pour le webhook Stripe (ADR-0010 §5) et le
 * QR handoff (ADR-0014), aucune infrastructure de job durable (pg-boss)
 * n'est encore introduite : `dispatchDue` doit être invoqué explicitement
 * (route admin `POST /admin/notifications/dispatch-due`) plutôt que par un
 * scheduler — dette assumée, documentée dans PLAN_ACTION.md.
 */
export class NotificationService {
  constructor(
    private readonly repo: NotificationOutboxRepository,
    private readonly emailSender: EmailSender,
    private readonly prisma: Pick<PrismaClient, "user">,
  ) {}

  async enqueue(input: EnqueueNotificationInput): Promise<void> {
    if (!input.recipientUserId && !input.recipientEmail) {
      throw new Error("enqueue: recipientUserId ou recipientEmail requis");
    }
    await this.repo.create({
      template: input.template,
      recipientUserId: input.recipientUserId,
      recipientEmail: input.recipientEmail,
      payload: input.payload as Prisma.InputJsonValue,
      scheduledFor: input.scheduledFor ?? new Date(),
    });
  }

  /** Traite les notifications dues (`scheduledFor <= now`, statut `PENDING`). Retourne le nombre envoyé/échoué. */
  async dispatchDue(limit = DEFAULT_DISPATCH_BATCH_SIZE): Promise<{ sent: number; failed: number }> {
    const due = await this.repo.findDue(new Date(), limit);
    let sent = 0;
    let failed = 0;

    for (const notification of due) {
      try {
        const email = await this.resolveRecipientEmail(notification.recipientUserId, notification.recipientEmail);
        if (!email) {
          throw new Error(`destinataire introuvable (userId=${notification.recipientUserId ?? "n/a"})`);
        }
        await this.emailSender.sendTemplatedEmail(email, notification.template, notification.payload as Record<string, unknown>);
        await this.repo.markSent(notification.id);
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = notification.attempts + 1;
        await this.repo.markFailed(notification.id, attempts, message, attempts >= MAX_DISPATCH_ATTEMPTS);
        logger.error({ event: "NotificationDispatchFailed", notificationId: notification.id, template: notification.template, err }, "échec d'envoi de notification");
        failed++;
      }
    }
    return { sent, failed };
  }

  private async resolveRecipientEmail(userId: string | null, directEmail: string | null): Promise<string | undefined> {
    if (directEmail) return directEmail;
    if (!userId) return undefined;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.email;
  }
}
