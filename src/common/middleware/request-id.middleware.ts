import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Assigns every request an id (honours an incoming x-request-id) and echoes it back in the response header. */
export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  req.id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
