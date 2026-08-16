import { AppError, ErrorCodes } from "@ardenne/shared";
import type { CreditPacksRepository } from "../credit-packs/credit-packs.repository.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface CreateCreditPackInput {
  name: string;
  purchaseAmountCents: number;
  paidCreditsCents: number;
  bonusCreditsCents?: number;
  salesChannels: Array<"ONLINE" | "KIOSK" | "TERMINAL">;
  validFrom?: string;
  validUntil?: string;
  displayOrder: number;
}

export interface UpdateCreditPackInput {
  name?: string;
  purchaseAmountCents?: number;
  paidCreditsCents?: number;
  bonusCreditsCents?: number;
  displayOrder?: number;
}

/** CDC §39.2 ("credit packs"), §58 ("changement de credit pack") — CRUD admin auditée, distincte du parcours d'achat client. */
export class CreditPackAdminService {
  constructor(
    private readonly repo: CreditPacksRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async listAll() {
    return this.repo.listAll();
  }

  /** CDC §55 écran 13 — achats de crédits, tous clients confondus. */
  async listPurchases() {
    return this.repo.listAllPurchases();
  }

  async create(actorUserId: string, input: CreateCreditPackInput) {
    const pack = await this.repo.create({
      name: input.name,
      purchaseAmountCents: input.purchaseAmountCents,
      paidCreditsCents: input.paidCreditsCents,
      bonusCreditsCents: input.bonusCreditsCents ?? 0,
      salesChannels: input.salesChannels,
      validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      displayOrder: input.displayOrder,
    });
    await this.auditLog.record({ actorUserId, action: "CREDIT_PACK_CREATED", targetType: "CreditPack", targetId: pack.id, after: pack });
    return pack;
  }

  async update(actorUserId: string, id: string, input: UpdateCreditPackInput) {
    const before = await this.repo.findById(id);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Pack de crédits introuvable.", 404);
    const after = await this.repo.update(id, input);
    await this.auditLog.record({ actorUserId, action: "CREDIT_PACK_UPDATED", targetType: "CreditPack", targetId: id, before, after });
    return after;
  }

  async deactivate(actorUserId: string, id: string, reason?: string) {
    const before = await this.repo.findById(id);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Pack de crédits introuvable.", 404);
    const after = await this.repo.deactivate(id);
    await this.auditLog.record({ actorUserId, action: "CREDIT_PACK_DEACTIVATED", targetType: "CreditPack", targetId: id, before, after, reason });
    return after;
  }
}
