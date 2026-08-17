import type { PrismaClient } from "@prisma/client";

/**
 * Nettoyage complet inter-tests, dans l'ordre imposé par les contraintes de
 * clé étrangère (CDC §46 : jamais de cascade delete sur les tables
 * financières en production — donc l'ordre doit être explicite ici plutôt
 * que de compter sur `onDelete: Cascade`). Utilisé par tous les fichiers de
 * test d'intégration pour éviter les interférences entre fichiers (voir
 * `fileParallelism: false` dans vitest.config.ts).
 */
export async function resetIntegrationTestData(prisma: PrismaClient): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.legacySyncRun.deleteMany();
  await prisma.legacyBooking.deleteMany();
  await prisma.clientMigrationInvitation.deleteMany(); // référence legacyClient -> avant legacyClient
  await prisma.clientNote.deleteMany(); // référence user -> avant user
  await prisma.notificationOutbox.deleteMany();
  await prisma.accessGrant.deleteMany(); // référence booking -> avant booking
  await prisma.kioskCheckoutSession.deleteMany(); // référence kioskDevice -> avant kioskDevice
  await prisma.kioskDevice.deleteMany();
  await prisma.terminalDevice.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.creditPackPurchase.deleteMany(); // référence payment -> avant payment
  await prisma.payment.deleteMany();
  await prisma.legacyBookingMapping.deleteMany();
  await prisma.bookingParticipant.deleteMany();
  await prisma.bookingShare.deleteMany(); // référence booking -> avant booking
  await prisma.bookingGuarantee.deleteMany(); // référence booking -> avant booking
  await prisma.booking.deleteMany();
  await prisma.walletTransaction.deleteMany(); // référence walletAccount -> avant walletAccount
  await prisma.walletHold.deleteMany();
  await prisma.walletAccount.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.emailChangeToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.legacyClient.deleteMany();
  await prisma.user.deleteMany();
}
