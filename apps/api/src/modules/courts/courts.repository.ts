import type { PrismaClient } from "@prisma/client";

export class CourtsRepository {
  constructor(private readonly db: PrismaClient) {}

  listActive() {
    return this.db.court.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } });
  }

  findById(id: string) {
    return this.db.court.findUnique({ where: { id } });
  }
}
