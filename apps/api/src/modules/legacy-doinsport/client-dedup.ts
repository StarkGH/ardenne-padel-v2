export interface DedupCandidateUser {
  id: string;
  email: string;
}

export type DedupDecision =
  | { migrationStatus: "MIGRATED"; linkedUserId: string }
  | { migrationStatus: "MERGE_REQUIRED"; mergeNote: string }
  | { migrationStatus: "LEGACY_ONLY" };

/**
 * CDC §7.5 — priorité de déduplication à l'import : (1) lien de migration
 * explicite, hors périmètre ici (porté par `ClientMigrationInvitation`,
 * traité au clic du joueur, pas à l'import) ; (2) e-mail exact normalisé —
 * seul signal suffisant pour lier automatiquement ; (3) revue admin
 * manuelle en cas de conflit ; (4) GSM comme signal secondaire uniquement
 * — jamais suffisant seul pour un lien automatique, toujours `MERGE_REQUIRED`.
 */
export function decideClientLink(input: {
  legacyEmail: string | null;
  legacyPhone: string | null;
  usersMatchingEmail: DedupCandidateUser[];
  usersMatchingPhone: DedupCandidateUser[];
}): DedupDecision {
  if (input.legacyEmail && input.usersMatchingEmail.length === 1) {
    return { migrationStatus: "MIGRATED", linkedUserId: input.usersMatchingEmail[0]!.id };
  }
  if (input.legacyEmail && input.usersMatchingEmail.length > 1) {
    return {
      migrationStatus: "MERGE_REQUIRED",
      mergeNote: `L'e-mail ${input.legacyEmail} correspond à ${input.usersMatchingEmail.length} comptes V2 distincts.`,
    };
  }
  if (input.legacyPhone && input.usersMatchingPhone.length >= 1) {
    return {
      migrationStatus: "MERGE_REQUIRED",
      mergeNote: `Le GSM ${input.legacyPhone} correspond à ${input.usersMatchingPhone.length} compte(s) V2 (${input.usersMatchingPhone
        .map((u) => u.email)
        .join(", ")}) — signal secondaire seul (CDC §7.5), à valider manuellement.`,
    };
  }
  return { migrationStatus: "LEGACY_ONLY" };
}
