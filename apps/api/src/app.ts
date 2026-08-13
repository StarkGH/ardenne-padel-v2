import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";
import { IdentityRepository } from "./modules/identity/identity.repository.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { DevConsoleEmailSender, type EmailSender } from "./modules/identity/email-sender.js";
import { createIdentityRouter } from "./modules/identity/identity.routes.js";
import { attachAuthUser } from "./http/auth-middleware.js";
import { requestContext } from "./http/request-context.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { createHealthRouter } from "./http/health.routes.js";

export interface AppDependencies {
  prisma: PrismaClient;
  config: AppConfig;
  emailSender?: EmailSender;
}

/**
 * Factory de l'application Express. Prend ses dépendances en paramètre
 * (plutôt que des singletons globaux) pour rester testable en intégration
 * avec une base de test dédiée (voir tests/).
 */
export function createApp({ prisma, config, emailSender }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(cookieParser());
  app.use(requestContext);

  const identityRepository = new IdentityRepository(prisma);
  const identityService = new IdentityService(identityRepository, config, emailSender ?? new DevConsoleEmailSender());

  app.use(attachAuthUser(identityService));

  app.use("/api/v1", createHealthRouter(prisma));
  app.use("/api/v1/auth", createIdentityRouter(identityService, config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
