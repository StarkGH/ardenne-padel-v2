import { Prisma, type PrismaClient } from "@prisma/client";

export interface DoinsportAccessCodeEntry {
  scope: string;
  code: string;
  validFrom: Date;
  validUntil: Date;
}

/**
 * Codes d'accès des réservations purement Doinsport (jamais passées par le
 * checkout V2, donc sans `AccessGrant`) — demande explicite (2026-09-12) :
 * le Raspberry doit aussi les stocker/valider, pas seulement l'admin.
 *
 * Exclut systématiquement toute réservation déjà mappée V2 (Dual Run,
 * `LegacyBookingMapping.legacyBookingId` renseigné) : celle-là a déjà son
 * `AccessGrant` (origin `LEGACY_IMPORTED`) via le module `access` — ne
 * jamais exposer le même code deux fois avec deux origines différentes.
 *
 * IMPORTANT (vérifié sur données réelles le 2026-09-13) : le champ
 * `accessCodes[].playgroundName` renvoyé par Doinsport contient en réalité
 * le(s) nom(s) du/des participant(s) ("Coenen", "Fernandes / Coenen"...),
 * **jamais** le nom du terrain — contrairement à ce que son nom suggère et à
 * l'hypothèse déjà en place ailleurs (`AccessGrantService.importLegacyGrant`,
 * module `access`, qui utilise ce même champ pour le scope des grants
 * `LEGACY_IMPORTED` — bug pré-existant, hors scope ici, à corriger
 * séparément). Ce repository utilise donc systématiquement `booking.court.name`
 * (résolu de façon fiable via le mapping playground↔terrain de la synchro),
 * jamais `playgroundName`.
 */
export class DoinsportAccessCodeRepository {
  constructor(private readonly db: PrismaClient) {}

  async findActiveForScopesWindow(scopes: Set<string>, from: Date, to: Date): Promise<DoinsportAccessCodeEntry[]> {
    if (scopes.size === 0) return [];

    const mappings = await this.db.legacyBookingMapping.findMany({
      where: { legacyBookingId: { not: null } },
      select: { legacyBookingId: true },
    });
    const dualRunExternalIds = new Set(mappings.map((m) => m.legacyBookingId));

    const bookings = await this.db.legacyBooking.findMany({
      where: { canceled: false, startAt: { lt: to }, endAt: { gt: from }, accessCodes: { not: Prisma.JsonNull } },
      select: { externalId: true, startAt: true, endAt: true, accessCodes: true, court: { select: { name: true } } },
    });

    const out: DoinsportAccessCodeEntry[] = [];
    for (const booking of bookings) {
      if (dualRunExternalIds.has(booking.externalId)) continue;
      if (!scopes.has(booking.court.name)) continue;
      const codes = Array.isArray(booking.accessCodes) ? (booking.accessCodes as Array<{ code?: string }>) : [];
      for (const c of codes) {
        if (!c.code) continue;
        out.push({ scope: booking.court.name, code: c.code, validFrom: booking.startAt, validUntil: booking.endAt });
      }
    }
    return out;
  }
}
