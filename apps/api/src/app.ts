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
import { CourtsRepository } from "./modules/courts/courts.repository.js";
import { createCourtsRouter } from "./modules/courts/courts.routes.js";
import { AvailabilityRepository } from "./modules/availability/availability.repository.js";
import { AvailabilityService } from "./modules/availability/availability.service.js";
import { createAvailabilityRouter } from "./modules/availability/availability.routes.js";
import { PricingRepository } from "./modules/pricing/pricing.repository.js";
import { PricingService } from "./modules/pricing/pricing.service.js";
import { createPricingRouter } from "./modules/pricing/pricing.routes.js";
import { LegacyDoinsportAdapter } from "./modules/legacy-doinsport/legacy-doinsport.adapter.js";
import { LegacyDoinsportRepository } from "./modules/legacy-doinsport/legacy-doinsport.repository.js";
import type { LegacyBookingProvider } from "./modules/legacy-doinsport/types.js";
import { BookingsRepository } from "./modules/bookings/bookings.repository.js";
import { BookingsService } from "./modules/bookings/bookings.service.js";
import { createBookingsRouter } from "./modules/bookings/bookings.routes.js";
import { MockAlwaysSucceedsPaymentGateway, type PaymentGateway } from "./modules/bookings/mock-payment-gateway.js";

export interface AppDependencies {
  prisma: PrismaClient;
  config: AppConfig;
  emailSender?: EmailSender;
  /** Injectable pour les tests (fake), sinon `LegacyDoinsportAdapter` réel. */
  legacyProvider?: LegacyBookingProvider;
  /** Remplacé par le vrai `StripePaymentProvider` au Lot 4. */
  paymentGateway?: PaymentGateway;
}

/**
 * Factory de l'application Express. Prend ses dépendances en paramètre
 * (plutôt que des singletons globaux) pour rester testable en intégration
 * avec une base de test dédiée (voir tests/).
 */
export function createApp({ prisma, config, emailSender, legacyProvider, paymentGateway }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(cookieParser());
  app.use(requestContext);

  const identityRepository = new IdentityRepository(prisma);
  const identityService = new IdentityService(identityRepository, config, emailSender ?? new DevConsoleEmailSender());

  app.use(attachAuthUser(identityService));

  const courtsRepository = new CourtsRepository(prisma);
  const availabilityService = new AvailabilityService(new AvailabilityRepository(prisma));
  const pricingService = new PricingService(new PricingRepository(prisma));
  const legacy = legacyProvider ?? new LegacyDoinsportAdapter(config, new LegacyDoinsportRepository(prisma));
  const bookingsService = new BookingsService(
    new BookingsRepository(prisma),
    courtsRepository,
    pricingService,
    legacy,
    paymentGateway ?? new MockAlwaysSucceedsPaymentGateway(),
    config,
  );

  app.use("/api/v1", createHealthRouter(prisma));
  app.use("/api/v1/auth", createIdentityRouter(identityService, config));
  app.use("/api/v1", createCourtsRouter(courtsRepository));
  app.use("/api/v1", createAvailabilityRouter(availabilityService, courtsRepository));
  app.use("/api/v1", createPricingRouter(pricingService, courtsRepository));
  app.use("/api/v1", createBookingsRouter(bookingsService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
