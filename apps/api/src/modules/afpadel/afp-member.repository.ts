import type { PrismaClient } from "@prisma/client";
import type { AfpMemberListRow, AfpPlayerDetail } from "./afpadel-provider.js";
import { readRawDate, readRawString } from "./afp-raw-field.js";

export class AfpMemberRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsertListRow(row: AfpMemberListRow) {
    const clubName = readRawString(row.raw, "club_name");
    const nationality = readRawString(row.raw, "nationality");
    const ageCategory = readRawString(row.raw, "age_category");
    return this.db.afpMember.upsert({
      where: { afpPlayerId: row.afpPlayerId },
      create: {
        afpPlayerId: row.afpPlayerId,
        fullName: row.fullName,
        gender: row.gender,
        category: row.category,
        points: row.points,
        clubName,
        nationality,
        ageCategory,
        rawListData: row.raw as object,
      },
      update: {
        fullName: row.fullName,
        gender: row.gender,
        category: row.category,
        points: row.points,
        clubName,
        nationality,
        ageCategory,
        rawListData: row.raw as object,
      },
    });
  }

  async saveDetail(afpPlayerId: number, detail: AfpPlayerDetail) {
    return this.db.afpMember.update({
      where: { afpPlayerId },
      data: {
        rawPlayerData: detail.raw as object,
        detailSyncedAt: new Date(),
        email: readRawString(detail.raw, "email"),
        phone: readRawString(detail.raw, "phone"),
        birthdate: readRawDate(detail.raw, "birthdate"),
        town: readRawString(detail.raw, "town"),
        address: readRawString(detail.raw, "address"),
        zip: readRawString(detail.raw, "zip"),
      },
    });
  }

  listAll() {
    return this.db.afpMember.findMany({ orderBy: { fullName: "asc" } });
  }
}
