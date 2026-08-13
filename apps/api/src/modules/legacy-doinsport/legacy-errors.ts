import { AppError } from "@ardenne/shared";

/** CDC §87 — ne jamais envoyer le HTML/JSON brut Doinsport au client. */
export const LegacyErrorCodes = {
  LEGACY_AUTH_EXPIRED: "LEGACY_AUTH_EXPIRED",
  LEGACY_BAD_REQUEST: "LEGACY_BAD_REQUEST",
  LEGACY_FORBIDDEN: "LEGACY_FORBIDDEN",
  BOOKING_SLOT_UNAVAILABLE: "BOOKING_SLOT_UNAVAILABLE",
  LEGACY_RATE_LIMITED: "LEGACY_RATE_LIMITED",
  LEGACY_UNAVAILABLE: "LEGACY_UNAVAILABLE",
  LEGACY_TIMEOUT: "LEGACY_TIMEOUT",
  LEGACY_COURT_NOT_MAPPED: "LEGACY_COURT_NOT_MAPPED",
  LEGACY_PRICE_NOT_FOUND: "LEGACY_PRICE_NOT_FOUND",
} as const;

export class LegacyApiError extends Error {
  constructor(
    readonly httpStatus: number | "timeout",
    readonly rawBody: string,
  ) {
    super(`Doinsport API error ${httpStatus}`);
    this.name = "LegacyApiError";
  }
}

function isSlotOccupiedViolation(rawBody: string): boolean {
  // CDC §13.7 : 422 avec violation sur `playgrounds`.
  return rawBody.includes('"propertyPath":"playgrounds"') || rawBody.includes("n'est pas disponible");
}

/**
 * Traduit une erreur Legacy brute en `AppError` métier — c'est la seule
 * fonction du repository autorisée à lire le corps de réponse Doinsport.
 */
export function mapLegacyError(err: LegacyApiError): AppError {
  if (err.httpStatus === "timeout") {
    return new AppError(LegacyErrorCodes.LEGACY_TIMEOUT, "Le système de réservation ne répond pas.", 504);
  }

  switch (err.httpStatus) {
    case 401:
      return new AppError(LegacyErrorCodes.LEGACY_AUTH_EXPIRED, "Session Legacy expirée.", 502);
    case 400:
      return new AppError(LegacyErrorCodes.LEGACY_BAD_REQUEST, "Requête invalide côté système de réservation.", 502);
    case 403:
      return new AppError(LegacyErrorCodes.LEGACY_FORBIDDEN, "Accès refusé côté système de réservation.", 502);
    case 422:
      if (isSlotOccupiedViolation(err.rawBody)) {
        return new AppError(
          LegacyErrorCodes.BOOKING_SLOT_UNAVAILABLE,
          "Ce créneau vient d'être réservé. Veuillez sélectionner un autre horaire.",
          409,
        );
      }
      return new AppError(LegacyErrorCodes.LEGACY_BAD_REQUEST, "Requête invalide côté système de réservation.", 502);
    case 429:
      return new AppError(LegacyErrorCodes.LEGACY_RATE_LIMITED, "Trop de requêtes vers le système de réservation.", 503);
    default:
      if (typeof err.httpStatus === "number" && err.httpStatus >= 500) {
        return new AppError(LegacyErrorCodes.LEGACY_UNAVAILABLE, "Système de réservation temporairement indisponible.", 503);
      }
      return new AppError(LegacyErrorCodes.LEGACY_UNAVAILABLE, "Erreur inattendue du système de réservation.", 502);
  }
}
