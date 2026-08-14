import type { Prisma } from "@prisma/client";
import type { AuditLogRepository } from "./audit-log.repository.js";

export interface RecordAuditActionInput {
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
}

/** Champs jamais persistés en clair dans un audit log, quelle que soit la ressource (CDC §57.1, §58 : "before/after expurgé"). */
const SENSITIVE_KEYS = new Set([
  "passwordHash",
  "password",
  "cardNumber",
  "cvc",
  "deviceKeyHash",
  "codeCiphertext",
  "codeIv",
  "sessionTokenHash",
  "token",
  "rawToken",
]);

function redact(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = SENSITIVE_KEYS.has(key) ? "[EXPURGE]" : val;
  }
  return result;
}

/**
 * CDC §58 — journal d'audit append-only. Aucune méthode de suppression/mise
 * à jour n'est exposée : une entrée écrite ne change plus jamais (cohérent
 * avec `AuditLog` qui n'a ni `updatedAt` ni cascade de suppression).
 */
export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  async record(input: RecordAuditActionInput): Promise<void> {
    await this.repo.create({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ipAddress: input.ipAddress,
      metadata: { before: redact(input.before) ?? null, after: redact(input.after) ?? null } as Prisma.InputJsonValue,
    });
  }

  async listForTarget(targetType: string, targetId: string) {
    return this.repo.listRecent({ targetType, targetId });
  }
}
