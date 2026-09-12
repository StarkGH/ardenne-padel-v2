import type { AppConfig } from "@ardenne/config";
import type { AccessMarginsProvider } from "../access/access-margins-provider.js";
import type { ZoneRepository } from "./zone.repository.js";

/**
 * Implémente le port `AccessMarginsProvider` (module `access`) via les zones
 * `DOOR` du module `automation` — c'est ici, pas dans `access`, que vivent
 * les réglages par terrain (`/admin/automation`). Retombe sur les marges
 * globales quand aucune zone `DOOR` n'est liée au terrain, ou quand la zone
 * existe mais n'a pas de surcharge (`null`).
 */
export class ZoneAccessMarginsAdapter implements AccessMarginsProvider {
  constructor(
    private readonly zoneRepo: ZoneRepository,
    private readonly config: AppConfig,
  ) {}

  async getMarginsForCourt(courtId: string): Promise<{ beforeMinutes: number; afterMinutes: number }> {
    const zones = await this.zoneRepo.listActive();
    const zone = zones.find((z) => z.type === "DOOR" && z.courtId === courtId);
    return {
      beforeMinutes: zone?.doorBeforeMinutes ?? this.config.ACCESS_ENABLED_BEFORE_MINUTES,
      afterMinutes: zone?.doorAfterMinutes ?? this.config.ACCESS_ENABLED_AFTER_MINUTES,
    };
  }
}
