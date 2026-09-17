import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    console.error(`${req.method} ${req.originalUrl} -> ${err.status} ${err.code}: ${err.message}`);
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`${req.method} ${req.originalUrl} -> 500 INTERNAL_ERROR: ${message}`, err);
  res.status(500).json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } });
}
