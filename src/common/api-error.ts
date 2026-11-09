import { HttpException, HttpStatus } from '@nestjs/common';

/** Machine readable error codes. Clients should branch on these, never on `message`. */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  SESSION_ENDED = 'SESSION_ENDED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL = 'INTERNAL_ERROR',
  UPSTREAM_FAILED = 'UPSTREAM_FAILED',

  // auth
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  OTP_NOT_FOUND = 'OTP_NOT_FOUND',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_INVALID = 'OTP_INVALID',
  OTP_TOO_MANY_ATTEMPTS = 'OTP_TOO_MANY_ATTEMPTS',
  DEVICE_LIMIT_REACHED = 'DEVICE_LIMIT_REACHED',

  // orders
  EMPTY_ORDER = 'EMPTY_ORDER',
  ITEM_UNAVAILABLE = 'ITEM_UNAVAILABLE',
  AREA_NOT_SERVICEABLE = 'AREA_NOT_SERVICEABLE',
  ORDERS_PAUSED = 'ORDERS_PAUSED',
  STORE_CLOSED = 'STORE_CLOSED',
  COD_LIMIT_EXCEEDED = 'COD_LIMIT_EXCEEDED',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',

  // coupons
  COUPON_INVALID = 'COUPON_INVALID',

  // payments
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
}

/** The single exception type domain code throws. The global filter turns it into the error envelope. */
export class ApiException extends HttpException {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(code: ErrorCode | string, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthorized(message = 'Unauthorized', code: ErrorCode | string = ErrorCode.UNAUTHORIZED) {
    return new ApiException(code, message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You do not have permission to do this.') {
    return new ApiException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static notFound(what = 'Resource') {
    return new ApiException(ErrorCode.NOT_FOUND, `${what} not found.`, HttpStatus.NOT_FOUND);
  }
  static conflict(message: string, code: ErrorCode | string = ErrorCode.CONFLICT) {
    return new ApiException(code, message, HttpStatus.CONFLICT);
  }
  static upstream(message: string, details?: unknown) {
    return new ApiException(ErrorCode.UPSTREAM_FAILED, message, HttpStatus.BAD_GATEWAY, details);
  }
}
