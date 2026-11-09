import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Message, Paginated, SuccessEnvelope } from '../api-response';
import { RESPONSE_MESSAGE_KEY } from '../decorators';
import { serialize } from '../utils/serialize';

/**
 * Wraps every successful response in the same envelope:
 *   { success: true, message?, data, meta?, requestId, timestamp }
 * Controllers just return data (or `Paginated` / `Message`), they never build envelopes by hand.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const decoratorMessage = this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof StreamableFile || res.headersSent) return payload;

        const envelope: SuccessEnvelope<unknown> = {
          success: true,
          data: null,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        };

        if (payload instanceof Paginated) {
          envelope.data = serialize(payload.items);
          envelope.meta = payload.meta;
        } else if (payload instanceof Message) {
          envelope.message = payload.message;
          envelope.data = serialize(payload.data);
        } else {
          envelope.data = serialize(payload ?? null);
        }
        if (decoratorMessage && !envelope.message) envelope.message = decoratorMessage;
        return envelope;
      }),
    );
  }
}
