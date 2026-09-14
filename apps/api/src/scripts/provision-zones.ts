import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Crée automatiquement, pour chaque terrain actif, une zone DOOR et une
 * zone LIGHT liées à ce terrain (courtId) — condition nécessaire pour que
 * `AutomationService.buildSnapshot` route les grants/lightIntervals de ce
 * terrain vers le Raspberry (Phase 1, jusqu'ici aucune zone n'existait en
 * prod). Idempotent — upsert par `key` (déterministe à partir du slug du
 * terrain), rejouable sans risque si de nouveaux terrains sont ajoutés.
 *
 * Usage : npm run provision:zones --workspace apps/api
 */

async function main() {
  const prisma = new PrismaClient();
  const courts = await prisma.court.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } });

  if (courts.length === 0) {
    console.log("Aucun terrain actif trouvé — rien à faire.");
    await prisma.$disconnect();
    return;
  }

  for (const court of courts) {
    const doorKey = `door_${court.slug}`;
    const lightKey = `light_${court.slug}`;

    const door = await prisma.zone.upsert({
      where: { key: doorKey },
      create: { key: doorKey, type: "DOOR", label: `${court.name} — Porte`, courtId: court.id },
      update: { label: `${court.name} — Porte`, courtId: court.id },
    });
    const light = await prisma.zone.upsert({
      where: { key: lightKey },
      create: { key: lightKey, type: "LIGHT", label: `${court.name} — Lumière`, courtId: court.id },
      update: { label: `${court.name} — Lumière`, courtId: court.id },
    });

    console.log(`${court.name} : zones prêtes (${door.key}, ${light.key})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
