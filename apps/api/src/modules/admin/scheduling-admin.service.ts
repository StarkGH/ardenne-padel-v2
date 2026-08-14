import { AppError, ErrorCodes } from "@ardenne/shared";
import type { SchedulingAdminRepository } from "./scheduling-admin.repository.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface CreateTariffRuleInput {
  name: string;
  courtId?: string;
  courtType?: "SIMPLE" | "DOUBLE";
  validFrom: string;
  validUntil?: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  priceTotalCents?: number;
  pricePerParticipantCents?: number;
  referenceCapacity: number;
  priority: number;
  tags?: string[];
}

export interface CreateOpeningRuleInput {
  courtId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil?: string;
}

export interface CreateCourtClosureInput {
  courtId: string;
  startAt: string;
  endAt: string;
  reason?: string;
  closureType: "MAINTENANCE" | "EVENT" | "ADMIN_BLOCK";
}

/**
 * CDC §39.2 ("configuration tarifs/horaires/fermetures") + §58 : chaque
 * mutation est auditée (changement tarif / modification horaire), avant/
 * après capturés pour traçabilité.
 */
export class SchedulingAdminService {
  constructor(
    private readonly repo: SchedulingAdminRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async listTariffRules(courtId?: string) {
    return this.repo.listTariffRules(courtId);
  }

  async createTariffRule(actorUserId: string, input: CreateTariffRuleInput) {
    const rule = await this.repo.createTariffRule({
      name: input.name,
      court: input.courtId ? { connect: { id: input.courtId } } : undefined,
      courtType: input.courtType,
      validFrom: new Date(input.validFrom),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      daysOfWeek: input.daysOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      durationMinutes: input.durationMinutes,
      priceTotalCents: input.priceTotalCents,
      pricePerParticipantCents: input.pricePerParticipantCents,
      referenceCapacity: input.referenceCapacity,
      priority: input.priority,
      tags: input.tags ?? [],
    });
    await this.auditLog.record({ actorUserId, action: "TARIFF_RULE_CREATED", targetType: "TariffRule", targetId: rule.id, after: rule });
    return rule;
  }

  async deactivateTariffRule(actorUserId: string, id: string, reason?: string) {
    const before = await this.repo.findTariffRuleById(id);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Règle tarifaire introuvable.", 404);
    const after = await this.repo.deactivateTariffRule(id);
    await this.auditLog.record({ actorUserId, action: "TARIFF_RULE_DEACTIVATED", targetType: "TariffRule", targetId: id, before, after, reason });
    return after;
  }

  async listOpeningRules(courtId?: string) {
    return this.repo.listOpeningRules(courtId);
  }

  async createOpeningRule(actorUserId: string, input: CreateOpeningRuleInput) {
    const rule = await this.repo.createOpeningRule({
      court: input.courtId ? { connect: { id: input.courtId } } : undefined,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      validFrom: new Date(input.validFrom),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    });
    await this.auditLog.record({ actorUserId, action: "OPENING_RULE_CREATED", targetType: "OpeningRule", targetId: rule.id, after: rule });
    return rule;
  }

  async deactivateOpeningRule(actorUserId: string, id: string, reason?: string) {
    const before = await this.repo.findOpeningRuleById(id);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Règle d'horaire introuvable.", 404);
    const after = await this.repo.deactivateOpeningRule(id);
    await this.auditLog.record({ actorUserId, action: "OPENING_RULE_DEACTIVATED", targetType: "OpeningRule", targetId: id, before, after, reason });
    return after;
  }

  async listCourtClosures(courtId?: string) {
    return this.repo.listCourtClosures(courtId);
  }

  async createCourtClosure(actorUserId: string, input: CreateCourtClosureInput) {
    const closure = await this.repo.createCourtClosure({
      court: { connect: { id: input.courtId } },
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      reason: input.reason,
      closureType: input.closureType,
    });
    await this.auditLog.record({ actorUserId, action: "COURT_CLOSURE_CREATED", targetType: "CourtClosure", targetId: closure.id, after: closure });
    return closure;
  }

  async deleteCourtClosure(actorUserId: string, id: string, reason?: string) {
    const before = await this.repo.findCourtClosureById(id);
    if (!before) throw new AppError(ErrorCodes.NOT_FOUND, "Fermeture introuvable.", 404);
    await this.repo.deleteCourtClosure(id);
    await this.auditLog.record({ actorUserId, action: "COURT_CLOSURE_DELETED", targetType: "CourtClosure", targetId: id, before, reason });
  }
}
