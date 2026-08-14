import type { PrismaClient, Role } from "@prisma/client";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { WalletRepository } from "../wallet/wallet.repository.js";
import type { CrmRepository } from "./crm.repository.js";
import type { ClientNoteRepository } from "./client-note.repository.js";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * CDC §40 — fiche client admin complète. Ne jamais renvoyer de donnée
 * carte sensible (§40 : "Ne pas afficher de données carte sensibles") — les
 * champs Stripe exposés se limitent à des identifiants/statuts, jamais des
 * chiffres de carte (de toute façon jamais stockés côté V2 — CDC §21.1).
 */
export class CrmService {
  constructor(
    private readonly repo: CrmRepository,
    private readonly walletRepo: WalletRepository,
    private readonly noteRepo: ClientNoteRepository,
    private readonly auditLog: AuditLogService,
    private readonly db: Pick<PrismaClient, "user">,
  ) {}

  async search(query: string) {
    return this.repo.searchUsers(query);
  }

  async getClientFile(userId: string) {
    const profile = await this.repo.findUserProfile(userId);
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, "Client introuvable.", 404);

    const [legacyClient, bookings, payments, refunds, creditPackPurchases, notes, walletAccount] = await Promise.all([
      this.repo.findLegacyClientForUser(userId),
      this.repo.listBookingsForUser(userId, new Date()),
      this.repo.listPaymentsForUser(userId),
      this.repo.listRefundsForUser(userId),
      this.repo.listCreditPackPurchasesForUser(userId),
      this.noteRepo.listForUser(userId),
      this.walletRepo.findAccountByUserId(userId),
    ]);

    let wallet = null;
    if (walletAccount) {
      const [balanceCents, balanceByOrigin, reservedCents, activeHolds] = await Promise.all([
        this.walletRepo.getBalanceTotalCents(walletAccount.id),
        this.walletRepo.getBalanceByOrigin(walletAccount.id),
        this.walletRepo.getReservedCents(walletAccount.id),
        this.repo.listActiveHoldsForWallet(walletAccount.id),
      ]);
      wallet = {
        walletAccountId: walletAccount.id,
        balanceTotalCents: balanceCents,
        balanceByOrigin,
        balanceReservedCents: reservedCents,
        balanceAvailableCents: balanceCents - reservedCents,
        activeHolds,
      };
    }

    return {
      profile,
      legacyStatus: legacyClient
        ? { origin: "LEGACY_LINKED" as const, legacyClientId: legacyClient.externalId, migratedAt: legacyClient.linkedUserId ? legacyClient.lastSyncedAt : null }
        : { origin: "V2_ONLY" as const, legacyClientId: null, migratedAt: null },
      bookings,
      payments,
      refunds,
      creditPackPurchases,
      wallet,
      notes,
    };
  }

  async addNote(userId: string, authorUserId: string, body: string) {
    const profile = await this.repo.findUserProfile(userId);
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, "Client introuvable.", 404);

    const note = await this.noteRepo.create({ user: { connect: { id: userId } }, authorUserId, body });
    await this.auditLog.record({
      actorUserId: authorUserId,
      action: "CLIENT_NOTE_ADDED",
      targetType: "User",
      targetId: userId,
      after: { body },
    });
    return note;
  }

  /** CDC §58 ("rôle utilisateur") — changement de rôle, forcément audité (avant/après). */
  async changeRole(actorUserId: string, userId: string, newRole: Role, reason?: string) {
    const before = await this.repo.findUserProfile(userId);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Client introuvable.", 404);

    const after = await this.db.user.update({ where: { id: userId }, data: { role: newRole } });
    await this.auditLog.record({
      actorUserId,
      action: "USER_ROLE_CHANGED",
      targetType: "User",
      targetId: userId,
      before: { role: before.role },
      after: { role: after.role },
      reason,
    });
    return { id: after.id, role: after.role };
  }
}
