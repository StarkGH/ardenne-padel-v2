import type { Prisma, PrismaClient } from "@prisma/client";

export class ClientNoteRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.ClientNoteCreateInput) {
    return this.db.clientNote.create({ data });
  }

  listForUser(userId: string) {
    return this.db.clientNote.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }
}
