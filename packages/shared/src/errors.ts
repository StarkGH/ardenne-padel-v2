/**
 * Format d'erreur structuré (CDC §42). Ne jamais renvoyer de stacktrace brute
 * ni la réponse Legacy brute au client (CDC §59.2, §87).
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, httpStatus = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function toErrorBody(error: AppError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    },
  };
}

// Codes d'erreur métier connus dès le Lot 1 (d'autres seront ajoutés lot par lot).
export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  TOKEN_INVALID_OR_EXPIRED: "TOKEN_INVALID_OR_EXPIRED",
  TOO_MANY_LOGIN_ATTEMPTS: "TOO_MANY_LOGIN_ATTEMPTS",

  // Automatisation (commandes manuelles Raspberry/LOGO!).
  AUTOMATION_DEVICE_OFFLINE: "AUTOMATION_DEVICE_OFFLINE",
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  COMMAND_NOT_FOUND: "COMMAND_NOT_FOUND",
  COMMAND_EXPIRED: "COMMAND_EXPIRED",
  COMMAND_ALREADY_PENDING: "COMMAND_ALREADY_PENDING",
} as const;
