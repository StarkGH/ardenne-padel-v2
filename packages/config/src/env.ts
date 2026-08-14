import { z } from "zod";

/**
 * Validation stricte de la configuration au démarrage (CDC §63, §90).
 * Toute règle métier susceptible de changer est ici, jamais hardcodée dans
 * le domaine. Un flag absent en dev doit avoir une valeur par défaut sûre
 * (désactivé) plutôt qu'une hypothèse silencieuse.
 */

const boolFromString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  TIMEZONE_DISPLAY: z.string().default("Europe/Brussels"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL requis"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET doit faire au moins 16 caractères"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(48),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_FAILED_ATTEMPTS_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Legacy / Dual Run ---
  LEGACY_MODE: z.enum(["dual_run", "read_only", "disabled"]).default("dual_run"),
  LEGACY_SYNC_ENABLED: boolFromString.default("true"),
  LEGACY_WRITE_ENABLED: boolFromString.default("false"),
  LEGACY_ACCESS_IMPORT_ENABLED: boolFromString.default("false"),
  LEGACY_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  LEGACY_RECONCILIATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

  DOINSPORT_BASE_URL: z.string().default("https://api-principale.doinsport.club"),
  DOINSPORT_CLUB_LOGIN: z.string().optional(),
  DOINSPORT_CLUB_PASSWORD: z.string().optional(),
  DOINSPORT_CLUB_ID: z.string().optional(),
  // Valeur de repli/comparaison uniquement — CDC §13.1 : l'ID réellement
  // utilisé dans les appels est dérivé du JWT à l'authentification, jamais
  // hardcodé aveuglément. Voir userclub-resolver.ts (résout V-008).
  DOINSPORT_USERCLUB_ID: z.string().optional(),
  // CDC §11.3 : comparaison prix V2/Legacy pendant la migration. Le prix
  // facturé reste toujours celui de V2 — ceci ne fait que déclencher une
  // alerte en cas d'écart suspect, jamais une correction silencieuse.
  LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS: z.coerce.number().int().nonnegative().default(50),
  SPLIT_INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),

  // --- Stripe / paiement ---
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_TERMINAL_LOCATION_ID: z.string().optional(),
  TERMINAL_ENABLED: boolFromString.default("false"),
  QR_HANDOFF_ENABLED: boolFromString.default("false"),
  TAP_TO_PAY_ENABLED: boolFromString.default("false"),
  OFF_SESSION_GUARANTEE_ENABLED: boolFromString.default("false"),
  WALLET_GUARANTEE_ENABLED: boolFromString.default("false"),

  PAYMENT_SPLIT_ENABLED: boolFromString.default("false"),
  SPLIT_SERVICE_FEE_ENABLED: boolFromString.default("false"),
  SPLIT_SERVICE_FEE_CENTS: z.coerce.number().int().nonnegative().default(0),
  SPLIT_SERVICE_FEE_ALLOCATION: z.enum(["ORGANIZER", "PRO_RATA"]).default("ORGANIZER"),

  WALLET_ENABLED: boolFromString.default("false"),
  WALLET_TOPUP_ENABLED: boolFromString.default("false"),

  NOTIFICATION_PROVIDER: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().optional(),
  BOOKING_REMINDER_LEAD_MINUTES: z.coerce.number().int().positive().default(45),

  ACCESS_PROVIDER: z.string().optional(),
  V2_ACCESS_ENABLED: boolFromString.default("false"),
  ACCESS_ENABLED_BEFORE_MINUTES: z.coerce.number().int().nonnegative().default(15),
  ACCESS_ENABLED_AFTER_MINUTES: z.coerce.number().int().nonnegative().default(15),
  KIOSK_DEVICE_SECRET: z.string().optional(),
  KIOSK_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  KIOSK_OFFLINE_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(5),

  MIGRATION_INVITATIONS_ENABLED: boolFromString.default("false"),
  ADMIN_MOVE_ENABLED: boolFromString.default("false"),
  NATIVE_API_FUTURE: boolFromString.default("false"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/**
 * Point d'entrée unique de lecture de configuration. Fail-fast : une variable
 * mal formée arrête le démarrage plutôt que de propager une valeur invalide
 * en silence (CDC §111 — anti-pattern "remplacer une inconnue par une
 * hypothèse silencieuse").
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration invalide, démarrage annulé :\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Réservé aux tests : permet de forcer un rechargement avec un env différent. */
export function resetConfigCacheForTests(): void {
  cached = undefined;
}
