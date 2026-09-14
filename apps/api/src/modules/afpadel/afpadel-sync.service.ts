import { logger } from "@ardenne/shared";
import type { AfpadelProvider } from "./afpadel-provider.js";
import type { AfpMemberRepository } from "./afp-member.repository.js";

export interface AfpadelSyncResult {
  membersFound: number;
  detailsSynced: number;
  errors: string[];
}

/**
 * Orchestre l'import complet : liste des membres du club, puis fiche
 * détaillée de chacun (/player/{id}). Tourne en tâche de fond (déclenché
 * par un endpoint admin) — une centaine de pages à charger via Playwright,
 * bien trop long pour un cycle requête/réponse HTTP classique. Un échec sur
 * un joueur individuel n'interrompt jamais le reste de la synchro (CDC-like
 * §41 : une intégration externe qui échoue partiellement doit continuer au
 * mieux, pas tout bloquer).
 */
export class AfpadelSyncService {
  private syncing = false;
  private lastResult: AfpadelSyncResult | null = null;
  private lastRunAt: Date | null = null;

  constructor(
    private readonly provider: AfpadelProvider,
    private readonly repo: AfpMemberRepository,
    private readonly delayBetweenPlayersMs = 500,
  ) {}

  isSyncing(): boolean {
    return this.syncing;
  }

  getStatus(): { syncing: boolean; lastRunAt: Date | null; lastResult: AfpadelSyncResult | null } {
    return { syncing: this.syncing, lastRunAt: this.lastRunAt, lastResult: this.lastResult };
  }

  /** Ne bloque jamais l'appelant : à consommer en fire-and-forget depuis la route admin. */
  async runInBackground(): Promise<void> {
    if (this.syncing) {
      logger.warn({ event: "AfpadelSyncAlreadyRunning" }, "synchro AFPadel déjà en cours, requête ignorée");
      return;
    }
    this.syncing = true;
    try {
      this.lastResult = await this.syncAll();
    } catch (err) {
      logger.error({ event: "AfpadelSyncFailed", err }, "synchro AFPadel interrompue");
      this.lastResult = { membersFound: 0, detailsSynced: 0, errors: [(err as Error).message] };
    } finally {
      this.syncing = false;
      this.lastRunAt = new Date();
    }
  }

  private async syncAll(): Promise<AfpadelSyncResult> {
    await this.provider.authenticate();
    const members = await this.provider.listClubMembers();
    logger.info({ event: "AfpadelMembersListed", count: members.length }, "liste des membres AFPadel récupérée");

    for (const member of members) {
      await this.repo.upsertListRow(member);
    }

    const errors: string[] = [];
    let detailsSynced = 0;
    for (const member of members) {
      try {
        const detail = await this.provider.getPlayerDetail(member.afpPlayerId);
        await this.repo.saveDetail(member.afpPlayerId, detail);
        detailsSynced++;
      } catch (err) {
        errors.push(`Joueur ${member.afpPlayerId} (${member.fullName}) : ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.delayBetweenPlayersMs));
    }

    return { membersFound: members.length, detailsSynced, errors };
  }
}
