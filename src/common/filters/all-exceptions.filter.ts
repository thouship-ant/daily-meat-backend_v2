import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException, ErrorCode } from '../api-error';
import { ErrorEnvelope } from '../api-response';

/** Turns every thrown error into the same error envelope and never leaks internals on 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl ?? req.url} -> ${status} [${req.id ?? '-'}] ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    const body: ErrorEnvelope = {
      success: false,
      error: { code, message, statusCode: status, ...(details !== undefined ? { details } : {}) },
      requestId: req.id,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; code: string; message: string; details?: unknown } {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const target = (exception.meta?.target as string[] | string | undefined) ?? [];
          const fields = Array.isArray(target) ? target.join(', ') : String(target);
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: fields ? `A record with this ${fields} already exists.` : 'Duplicate record.',
          };
        }
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, code: ErrorCode.NOT_FOUND, message: 'Record not found.' };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'This record is referenced by other data and cannot be changed or removed.',
          };
        default:
          break;
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as any;
      // class-validator errors come through BadRequestException with `message: string[]`
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(response?.message)) {
        return {
          status,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed.',
          details: response.message,
        };
      }
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        return { status, code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Please slow down.' };
      }
      const message = typeof response === 'string' ? response : (response?.message ?? exception.message);
      return { status, code: this.codeForStatus(status), message: String(message) };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong. Please try again.',
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 401:
        return ErrorCode.UNAUTHORIZED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 400:
        return ErrorCode.VALIDATION_FAILED;
      default:
        return status >= 500 ? ErrorCode.INTERNAL : 'ERROR';
    }
  }
}
