import pino from "pino";

/**
 * Logger structuré (CDC §57.1).
 * Ne jamais logguer : mot de passe, token complet, CVC, carte complète,
 * magic link complet, QR checkout token complet, JWT.
 * `redact` protège contre les oublis sur les clés connues à risque.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "authorization",
      "req.headers.authorization",
      "*.cvc",
      "*.cardNumber",
      "*.jwt",
      "*.magicLink",
      "*.qrToken",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
