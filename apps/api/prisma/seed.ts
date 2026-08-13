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

  console.log("Seed terminé. Comptes dev (mot de passe: DevPassword123!) :");
  console.log("  - admin@dev.ardenne-padel.local (ADMIN)");
  console.log("  - joueur1@dev.ardenne-padel.local (CUSTOMER)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
