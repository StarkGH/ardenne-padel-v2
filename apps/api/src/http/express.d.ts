import type { Role, UserStatus } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      authUser?: {
        id: string;
        email: string;
        role: Role;
        status: UserStatus;
        pilotUser: boolean;
      };
      kioskDevice?: {
        id: string;
        name: string;
      };
      automationDevice?: {
        id: string;
        name: string;
      };
      /** Élève Academy authentifié via son lien à token temporaire (§8) — jamais via une session V2 classique. */
      academyStudent?: {
        id: string;
        email: string;
      };
    }
  }
}

export {};
