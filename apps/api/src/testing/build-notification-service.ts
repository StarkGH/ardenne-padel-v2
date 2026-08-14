import type { PrismaClient } from "@prisma/client";
import { NotificationOutboxRepository } from "../modules/notifications/notification-outbox.repository.js";
import { NotificationService } from "../modules/notifications/notification.service.js";
import { DevConsoleEmailSender } from "../modules/identity/email-sender.js";

/** Instance réelle (contre la vraie base) pour les tests de services qui n'exercent pas eux-mêmes l'outbox. */
export function buildTestNotificationService(prisma: PrismaClient): NotificationService {
  return new NotificationService(new NotificationOutboxRepository(prisma), new DevConsoleEmailSender(), prisma);
}
