/**
 * Nettoyage complet inter-tests, dans l'ordre imposé par les contraintes de
 * clé étrangère (CDC §46 : jamais de cascade delete sur les tables
 * financières en production — donc l'ordre doit être explicite ici plutôt
 * que de compter sur `onDelete: Cascade`). Utilisé par tous les fichiers de
 * test d'intégration pour éviter les interférences entre fichiers (voir
 * `fileParallelism: false` dans vitest.config.ts).
 */
export async function resetIntegrationTestData(prisma) {
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.legacyBookingMapping.deleteMany();
    await prisma.bookingParticipant.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.loginAttempt.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.legacyClient.deleteMany();
    await prisma.user.deleteMany();
}
//# sourceMappingURL=reset-db.js.map