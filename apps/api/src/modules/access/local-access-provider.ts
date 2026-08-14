import type { AccessGrantRef, AccessHealth, AccessProvider, ProviderRef } from "./access-provider.js";

/**
 * Implémentation par défaut tant qu'aucun vendeur de matériel de contrôle
 * d'accès n'est choisi (`ACCESS_PROVIDER` non configuré) — contrairement à
 * Stripe/Terminal (ADR-0010, ADR-0014), un code `NNNN#` reste utilisable
 * manuellement par le personnel du club sans intégration matérielle : ce
 * n'est donc pas un stub d'erreur (`UnconfiguredXxxProvider`) mais une
 * implémentation fonctionnelle et définitive tant que le MVP n'a pas de
 * lecteur/serrure connecté (CDC §34.5 : ne jamais coupler le domaine à un
 * matériel spécifique).
 */
export class LocalAccessProvider implements AccessProvider {
  async provisionGrant(grant: AccessGrantRef): Promise<ProviderRef> {
    return { providerReference: `local:${grant.id}` };
  }

  async updateGrant(): Promise<void> {
    // Rien à propager tant qu'aucun matériel n'est connecté.
  }

  async revokeGrant(): Promise<void> {
    // Rien à propager tant qu'aucun matériel n'est connecté.
  }

  async healthCheck(): Promise<AccessHealth> {
    return { healthy: true, detail: "provider local (aucun matériel connecté)" };
  }
}
