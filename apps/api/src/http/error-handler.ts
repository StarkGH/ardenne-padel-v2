import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCodes, logger, toErrorBody } from "@ardenne/shared";

/** Gestionnaire d'erreurs central : jamais de stacktrace brute au client (CDC §59.2). */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error({ err, requestId: req.requestId, code: err.code }, "application error");
    }
    res.status(err.httpStatus).json(toErrorBody(err, req.requestId));
    return;
  }

  logger.error({ err, requestId: req.requestId }, "unhandled error");
  res.status(500).json(
    toErrorBody(new AppError(ErrorCodes.VALIDATION_FAILED, "Une erreur inattendue est survenue.", 500), req.requestId),
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    toErrorBody(new AppError(ErrorCodes.NOT_FOUND, "Ressource introuvable.", 404), req.requestId),
  );
}
