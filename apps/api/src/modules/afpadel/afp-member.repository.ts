import type { PrismaClient } from "@prisma/client";
import type { AfpMemberListRow, AfpPlayerDetail } from "./afpadel-provider.js";

export class AfpMemberRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsertListRow(row: AfpMemberListRow) {
    return this.db.afpMember.upsert({
      where: { afpPlayerId: row.afpPlayerId },
      create: {
        afpPlayerId: row.afpPlayerId,
        fullName: row.fullName,
        gender: row.gender,
        category: row.category,
        points: row.points,
        rawListData: row.raw as object,
      },
      update: {
        fullName: row.fullName,
        gender: row.gender,
        category: row.category,
        points: row.points,
        rawListData: row.raw as object,
      },
    });
  }

  async saveDetail(afpPlayerId: number, detail: AfpPlayerDetail) {
    return this.db.afpMember.update({
      where: { afpPlayerId },
      data: { rawPlayerData: detail.raw as object, detailSyncedAt: new Date() },
    });
  }

  listAll() {
    return this.db.afpMember.findMany({ orderBy: { fullName: "asc" } });
  }
}
