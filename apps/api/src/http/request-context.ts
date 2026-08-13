import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Attribue un request_id à chaque requête (CDC §42, §57.1). */
export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  next();
}
