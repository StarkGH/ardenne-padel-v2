import type { Prisma, PrismaClient } from "@prisma/client";

export class ZoneRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.ZoneCreateInput) {
    return this.db.zone.create({ data });
  }

  findByKey(key: string) {
    return this.db.zone.findUnique({ where: { key } });
  }

  listActive() {
    return this.db.zone.findMany({ where: { active: true }, orderBy: { key: "asc" }, include: { court: true } });
  }

  findById(id: string) {
    return this.db.zone.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.ZoneUpdateInput) {
    return this.db.zone.update({ where: { id }, data });
  }
}
