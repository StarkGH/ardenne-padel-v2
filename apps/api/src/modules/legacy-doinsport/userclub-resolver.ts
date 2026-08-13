import { logger } from "@ardenne/shared";

interface DoinsportJwtPayload {
  id?: string;
  roles?: string[];
  username?: string;
  exp?: number;
}

/**
 * Décodage du payload JWT (pas de vérification de signature : le token vient
 * de notre propre appel de login, on lui fait confiance comme réponse HTTP —
 * on ne fait que lire un claim, pas authentifier un tiers).
 */
export function decodeJwtPayload(token: string): DoinsportJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("decodeJwtPayload: JWT Doinsport malformé");
  }
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(json) as DoinsportJwtPayload;
}

/**
 * CDC §13.1 : "dériver préférentiellement l'identifiant du contexte
 * d'authentification confirmé ; ne pas hardcoder une valeur sans validation
 * au démarrage." Résout V-008 : le claim `id` du JWT est la source de
 * vérité ; la valeur `.env` (`DOINSPORT_USERCLUB_ID`) n'est utilisée que
 * comme repli si le JWT n'en contient pas, avec alerte si divergence.
 */
export function resolveUserClubId(token: string, configuredUserClubId: string | undefined): string {
  const payload = decodeJwtPayload(token);

  if (!payload.id) {
    if (!configuredUserClubId) {
      throw new Error(
        "resolveUserClubId: aucun claim `id` dans le JWT Doinsport et DOINSPORT_USERCLUB_ID absent — impossible de déterminer le userClubId.",
      );
    }
    logger.warn(
      { event: "LegacyUserClubIdFallback" },
      "JWT Doinsport sans claim id, repli sur DOINSPORT_USERCLUB_ID (.env)",
    );
    return configuredUserClubId;
  }

  if (configuredUserClubId && configuredUserClubId !== payload.id) {
    logger.warn(
      { event: "LegacyUserClubIdMismatch", jwtUserClubId: payload.id, configuredUserClubId },
      "divergence entre le userClubId du JWT et DOINSPORT_USERCLUB_ID (.env) — le JWT fait foi (CDC §13.1, V-008)",
    );
  }

  return payload.id;
}
