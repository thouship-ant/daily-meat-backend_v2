export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Return this from a controller to get `data: [...]` plus `meta` pagination in the envelope. */
export class Paginated<T> {
  readonly meta: PageMeta;
  constructor(
    public readonly items: T[],
    total: number,
    page: number,
    limit: number,
  ) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    this.meta = { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
  }
}

/** Return this from a controller to set a human-readable message alongside the data. */
export class Message<T = null> {
  constructor(
    public readonly message: string,
    public readonly data: T = null as T,
  ) {}
}

export interface SuccessEnvelope<T> {
  success: true;
  message?: string;
  data: T;
  meta?: PageMeta;
  requestId?: string;
  timestamp: string;
}

export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; statusCode: number; details?: unknown };
  requestId?: string;
  path: string;
  timestamp: string;
}
