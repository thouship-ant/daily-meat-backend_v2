import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { MessagingService } from '../../infrastructure/messaging/messaging.service';

interface StoredOtp {
  hash: string;
  attempts: number;
}

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * One-time passwords for customer login.
 * - stored as an HMAC (never plaintext) in the cache, with a TTL
 * - attempt-limited, single use
 * - works the same for existing and brand-new users (v1 kept new users' OTPs in a process-local global)
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly cache: CacheService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  private get ttl() {
    return Number(this.config.get('OTP_TTL_SECONDS') ?? 600);
  }
  private get maxAttempts() {
    return Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 3);
  }

  isTestAccount(identifier: string): boolean {
    const marker = this.config.get<string>('TEST_ACCOUNT_PHONE_MARKER');
    return !!marker && identifier.includes(marker);
  }

  async send(identifier: string): Promise<void> {
    // Store-reviewer test account: no SMS, fixed OTP.
    if (this.isTestAccount(identifier)) return;

    const cooldownKey = `otp:cooldown:${identifier}`;
    if (await this.cache.get(cooldownKey)) {
      throw new ApiException(
        ErrorCode.RATE_LIMITED,
        `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another OTP.`,
        429,
      );
    }

    const otp = String(randomInt(100000, 1000000));
    await this.cache.set(this.key(identifier), { hash: this.hash(identifier, otp), attempts: 0 } as StoredOtp, this.ttl);
    await this.cache.set(cooldownKey, 1, RESEND_COOLDOWN_SECONDS);
    try {
      await this.messaging.sendOtp(identifier, otp, Math.round(this.ttl / 60));
    } catch (e) {
      await this.cache.del(this.key(identifier), cooldownKey);
      throw e;
    }
  }

  /** Throws a coded ApiException unless the OTP is correct. Consumes the OTP on success. */
  async verify(identifier: string, otp: string): Promise<void> {
    if (this.isTestAccount(identifier)) {
      if (String(otp) !== this.config.get<string>('TEST_ACCOUNT_OTP')) {
        throw ApiException.badRequest(ErrorCode.OTP_INVALID, 'Invalid OTP.');
      }
      return;
    }

    const key = this.key(identifier);
    const stored = await this.cache.get<StoredOtp>(key);
    if (!stored) {
      throw ApiException.badRequest(ErrorCode.OTP_NOT_FOUND, 'OTP expired or not requested. Please request a new OTP.');
    }

    const ok = this.safeEqual(stored.hash, this.hash(identifier, String(otp)));
    if (!ok) {
      const attempts = stored.attempts + 1;
      if (attempts >= this.maxAttempts) {
        await this.cache.del(key);
        throw ApiException.badRequest(
          ErrorCode.OTP_TOO_MANY_ATTEMPTS,
          'Too many failed attempts. Please request a new OTP.',
        );
      }
      await this.cache.set(key, { ...stored, attempts }, this.ttl);
      throw ApiException.badRequest(ErrorCode.OTP_INVALID, `Invalid OTP. ${this.maxAttempts - attempts} attempt(s) left.`, {
        attemptsLeft: this.maxAttempts - attempts,
      });
    }
    await this.cache.del(key);
  }

  private key(identifier: string) {
    return `otp:${identifier.toLowerCase()}`;
  }

  private hash(identifier: string, otp: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`${identifier.toLowerCase()}:${otp}`)
      .digest('hex');
  }

  private safeEqual(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}
