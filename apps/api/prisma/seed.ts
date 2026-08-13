import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/identity/password.js";

/**
 * Seed de développement (CDC §93). Étendu lot par lot : terrains, tarifs,
 * horaires, bookings arriveront avec les modules correspondants.
 * Aucune donnée personnelle réelle ici.
 */
const prisma = new PrismaClient();

async function main() {
  const devPassword = await hashPassword("DevPassword123!");

  await prisma.user.upsert({
    where: { email: "admin@dev.ardenne-padel.local" },
    update: {},
    create: {
      email: "admin@dev.ardenne-padel.local",
      passwordHash: devPassword,
      firstName: "Admin",
      lastName: "Dev",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  await prisma.user.upsert({
    where: { email: "joueur1@dev.ardenne-padel.local" },
    update: {},
    create: {
      email: "joueur1@dev.ardenne-padel.local",
      passwordHash: devPassword,
      firstName: "Joueur",
      lastName: "Un",
      role: "CUSTOMER",
      status: "ACTIVE",
    },
  });

  // Terrains + mapping Legacy (CDC §9, §14). UUID vérifiés en direct contre
  // l'API Doinsport de production (GET /clubs/playgrounds) le 2026-08-13 —
  // voir docs/CAHIER_DES_CHARGES_V1.1.md et l'historique de cette session.
  const courtsSeed = [
    {
      slug: "padel-1",
      name: "Padel 1",
      courtType: "SIMPLE" as const,
      capacity: 2,
      displayOrder: 1,
      legacyPlaygroundId: "299a4ddb-1e78-4f19-832a-263a4c0dc36e",
      legacyActivityId: "782d895f-9257-4f1a-ac80-20558f067411", // Padel simple
    },
    {
      slug: "padel-2",
      name: "Padel 2",
      courtType: "SIMPLE" as const,
      capacity: 2,
      displayOrder: 2,
      legacyPlaygroundId: "ad93e11b-bf96-4fe1-abc9-214613a2c0b2",
      legacyActivityId: "782d895f-9257-4f1a-ac80-20558f067411",
    },
    {
      slug: "padel-3",
      name: "Padel 3",
      courtType: "DOUBLE" as const,
      capacity: 4,
      displayOrder: 3,
      legacyPlaygroundId: "8b2481f8-abd3-4ffa-8b6a-f628220472fe",
      legacyActivityId: "ce8c306e-224a-4f24-aa9d-6500580924dc", // Padel (double)
    },
    {
      slug: "padel-4",
      name: "Padel 4",
      courtType: "DOUBLE" as const,
      capacity: 4,
      displayOrder: 4,
      legacyPlaygroundId: "ece8e815-8142-4feb-a0a3-a32d4d49f82c",
      legacyActivityId: "ce8c306e-224a-4f24-aa9d-6500580924dc",
    },
  ];

  for (const c of courtsSeed) {
    const court = await prisma.court.upsert({
      where: { slug: c.slug },
      update: { name: c.name, courtType: c.courtType, capacity: c.capacity, displayOrder: c.displayOrder },
      create: {
        slug: c.slug,
        name: c.name,
        courtType: c.courtType,
        capacity: c.capacity,
        displayOrder: c.displayOrder,
        legacyPlaygroundId: c.legacyPlaygroundId,
      },
    });

    await prisma.legacyCourtMapping.upsert({
      where: { courtId: court.id },
      update: { legacyPlaygroundId: c.legacyPlaygroundId, legacyActivityId: c.legacyActivityId, active: true },
      create: {
        courtId: court.id,
        legacyPlaygroundId: c.legacyPlaygroundId,
        legacyActivityId: c.legacyActivityId,
      },
    });
  }

  console.log("Seed terminé. Comptes dev (mot de passe: DevPassword123!) :");
  console.log("  - admin@dev.ardenne-padel.local (ADMIN)");
  console.log("  - joueur1@dev.ardenne-padel.local (CUSTOMER)");
  console.log("4 terrains + mapping Legacy créés (Padel 1-4).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
