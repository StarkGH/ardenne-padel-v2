import { DateTime } from "luxon";
import { DISPLAY_TIMEZONE } from "@ardenne/shared";
import type { Court } from "@prisma/client";
import type { PricingRepository } from "./pricing.repository.js";
import { resolveTariff, type ResolvedTariff } from "./tariff-resolver.js";

export class PricingService {
  constructor(private readonly repo: PricingRepository) {}

  /** `startAtIso` : instant UTC de début de la réservation demandée. */
  async quote(court: Court, startAtIso: string, durationMinutes: number): Promise<ResolvedTariff> {
    const local = DateTime.fromISO(startAtIso, { setZone: true }).setZone(DISPLAY_TIMEZONE);
    if (!local.isValid) throw new Error(`quote: startAt invalide "${startAtIso}" (${local.invalidReason})`);

    const rules = await this.repo.findActiveRules(court.id, court.courtType, local.startOf("day").toJSDate());

    return resolveTariff({
      courtId: court.id,
      courtType: court.courtType,
      dayOfWeek: local.weekday % 7,
      startTime: local.toFormat("HH:mm"),
      durationMinutes,
      rules: rules.map((r) => ({
        id: r.id,
        courtId: r.courtId,
        courtType: r.courtType,
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        durationMinutes: r.durationMinutes,
        priceTotalCents: r.priceTotalCents,
        pricePerParticipantCents: r.pricePerParticipantCents,
        referenceCapacity: r.referenceCapacity,
        priority: r.priority,
      })),
    });
  }
}
