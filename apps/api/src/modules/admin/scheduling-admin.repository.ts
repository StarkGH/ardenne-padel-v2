import type { Prisma, PrismaClient } from "@prisma/client";

/** CDC §10.1, §11.1, §39 — configuration tarifs/horaires/fermetures, réservée au back-office. */
export class SchedulingAdminRepository {
  constructor(private readonly db: PrismaClient) {}

  createTariffRule(data: Prisma.TariffRuleCreateInput) {
    return this.db.tariffRule.create({ data });
  }

  findTariffRuleById(id: string) {
    return this.db.tariffRule.findUnique({ where: { id } });
  }

  updateTariffRule(id: string, data: Prisma.TariffRuleUpdateInput) {
    return this.db.tariffRule.update({ where: { id }, data });
  }

  deactivateTariffRule(id: string) {
    return this.db.tariffRule.update({ where: { id }, data: { active: false } });
  }

  listTariffRules(courtId?: string) {
    return this.db.tariffRule.findMany({ where: courtId ? { courtId } : undefined, orderBy: [{ active: "desc" }, { priority: "desc" }] });
  }

  createOpeningRule(data: Prisma.OpeningRuleCreateInput) {
    return this.db.openingRule.create({ data });
  }

  findOpeningRuleById(id: string) {
    return this.db.openingRule.findUnique({ where: { id } });
  }

  updateOpeningRule(id: string, data: Prisma.OpeningRuleUpdateInput) {
    return this.db.openingRule.update({ where: { id }, data });
  }

  deactivateOpeningRule(id: string) {
    return this.db.openingRule.update({ where: { id }, data: { active: false } });
  }

  listOpeningRules(courtId?: string) {
    return this.db.openingRule.findMany({ where: courtId ? { courtId } : undefined, orderBy: { dayOfWeek: "asc" } });
  }

  createCourtClosure(data: Prisma.CourtClosureCreateInput) {
    return this.db.courtClosure.create({ data });
  }

  findCourtClosureById(id: string) {
    return this.db.courtClosure.findUnique({ where: { id } });
  }

  deleteCourtClosure(id: string) {
    return this.db.courtClosure.delete({ where: { id } });
  }

  listCourtClosures(courtId?: string) {
    return this.db.courtClosure.findMany({ where: courtId ? { courtId } : undefined, orderBy: { startAt: "asc" } });
  }
}
