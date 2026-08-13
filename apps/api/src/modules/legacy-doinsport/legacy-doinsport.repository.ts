import type { PrismaClient } from "@prisma/client";

export class LegacyDoinsportRepository {
  constructor(private readonly db: PrismaClient) {}

  async storeToken(token: string): Promise<void> {
    await this.db.legacyAuthToken.create({ data: { token } });
  }

  async getLatestToken(): Promise<string | null> {
    const row = await this.db.legacyAuthToken.findFirst({ orderBy: { createdAt: "desc" } });
    return row?.token ?? null;
  }

  async listActiveCourtMappings() {
    return this.db.legacyCourtMapping.findMany({
      where: { active: true },
      include: { court: true },
    });
  }

  async findCourtMappingByLocalCourtId(courtId: string) {
    return this.db.legacyCourtMapping.findUnique({ where: { courtId }, include: { court: true } });
  }

  async findCourtMappingByLegacyPlaygroundId(legacyPlaygroundId: string) {
    return this.db.legacyCourtMapping.findUnique({ where: { legacyPlaygroundId }, include: { court: true } });
  }

  async upsertLegacyClient(input: {
    externalId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  }) {
    return this.db.legacyClient.upsert({
      where: { externalId: input.externalId },
      create: { ...input, lastSyncedAt: new Date() },
      update: { ...input, lastSyncedAt: new Date() },
    });
  }

  async findLegacyClientByExternalId(externalId: string) {
    return this.db.legacyClient.findUnique({ where: { externalId } });
  }
}
