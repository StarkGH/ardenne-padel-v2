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
    }
  }
}

export {};
