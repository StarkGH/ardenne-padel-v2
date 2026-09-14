import type { AppConfig } from "@ardenne/config";

/**
 * Import de l'effectif du club depuis mon.afpadel.be (demande explicite
 * 2026-09-14). Interface volontairement minimale — le reste de l'app ne
 * doit jamais dépendre d'une implémentation concrète (même principe que
 * `AccessProvider`/`AfPadelProvider` dans le projet `tournament`, où ce
 * connecteur a déjà été validé en conditions réelles).
 */

/**
 * Champs confirmés réels le 2026-09-14 (inspection directe de la réponse
 * JSON de mon.afpadel.be/club, props.players[]) : `sex` ("H"/"F"),
 * `license_name` (catégorie de licence — "Junior" observé), `points`.
 */
export interface AfpMemberListRow {
  afpPlayerId: number;
  fullName: string;
  gender: string | null;
  category: string | null;
  points: number | null;
  raw: unknown;
}

export interface AfpPlayerDetail {
  raw: unknown;
}

export interface AfpadelProvider {
  authenticate(): Promise<void>;
  listClubMembers(): Promise<AfpMemberListRow[]>;
  getPlayerDetail(afpPlayerId: number): Promise<AfpPlayerDetail>;
}

const NOT_CONFIGURED_MESSAGE =
  "Synchronisation AFPadel non configurée : AFPADEL_URL_LOGIN, AFPADEL_URL_CLUB, AFPADEL_LOGIN et AFPADEL_PASSWORD sont requis.";

/** Tant que la config AFPadel est incomplète — jamais d'échec au démarrage (même principe que les LEGACY_*). */
export class NullAfpadelProvider implements AfpadelProvider {
  async authenticate(): Promise<void> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  async listClubMembers(): Promise<AfpMemberListRow[]> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  async getPlayerDetail(): Promise<AfpPlayerDetail> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
}

export function isAfpadelConfigured(config: AppConfig): boolean {
  return Boolean(config.AFPADEL_URL_LOGIN && config.AFPADEL_URL_CLUB && config.AFPADEL_LOGIN && config.AFPADEL_PASSWORD);
}
