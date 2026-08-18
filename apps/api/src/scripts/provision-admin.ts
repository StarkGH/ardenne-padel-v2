import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword, assertPasswordStrength } from "../modules/identity/password.js";

/**
 * Comble une dette documentée dans docs/deployment.md : aucun script ne
 * permettait de créer le tout premier compte SUPER_ADMIN d'un déploiement
 * (seul `prisma/seed.ts` existait, avec des comptes dev/mots de passe en
 * clair inappropriés dès qu'un vrai domaine est exposé). Idempotent —
 * upsert par e-mail, ACTIVE et SUPER_ADMIN d'emblée (pas de flux de
 * vérification e-mail pour ce compte fondateur).
 *
 * Usage :
 *   npm run provision:admin --workspace apps/api -- \
 *     --email=admin@example.com --password='...' --firstName=... --lastName=...
 */

interface Args {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }
  const email = flags.get("email");
  const password = flags.get("password");
  const firstName = flags.get("firstName") ?? "Admin";
  const lastName = flags.get("lastName") ?? "Ardenne Padel";
  if (!email || !password) {
    throw new Error("Usage : --email=... --password=... [--firstName=...] [--lastName=...]");
  }
  return { email, password, firstName, lastName };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPasswordStrength(args.password);
  const passwordHash = await hashPassword(args.password);

  const prisma = new PrismaClient();
  const user = await prisma.user.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      passwordHash,
      firstName: args.firstName,
      lastName: args.lastName,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    update: {
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`Compte SUPER_ADMIN prêt : ${user.email} (${user.id})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
