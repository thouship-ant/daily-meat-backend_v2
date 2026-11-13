import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { ApiException } from '../../common/api-error';

/** Outbound SMS (Fortius DLT gateway) and email (SMTP). Falls back to logging when not configured (dev). */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  async sendOtp(identifier: string, otp: string, ttlMinutes: number): Promise<void> {
    if (this.isEmail(identifier)) return this.sendOtpEmail(identifier, otp, ttlMinutes);
    return this.sendOtpSms(identifier, otp, ttlMinutes);
  }

  isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private async sendOtpSms(phone: string, otp: string, ttlMinutes: number): Promise<void> {
    const apiKey = this.config.get<string>('SMS_FORTIUS_API_KEY');
    const senderId = this.config.get<string>('SMS_FORTIUS_SENDER_ID');
    const templateId = this.config.get<string>('SMS_FORTIUS_TEMPLATE_ID');
    const baseUrl = this.config.get<string>('SMS_FORTIUS_BASE_URL');

    if (!apiKey || !senderId || !templateId || !baseUrl) {
      // Never log the OTP in production.
      if (this.config.get('NODE_ENV') !== 'production') this.logger.warn(`[OTP mock] ${phone} -> ${otp}`);
      else this.logger.error('SMS gateway is not configured; OTP was not delivered.');
      return;
    }

    const message = `Welcome to Daily Meat! Your OTP for Daily Meat app registration is ${otp}.Valid for ${ttlMinutes} minutes. Please do not share it. - YgbYXq+qNj4`;
    const params = new URLSearchParams({
      apikey: apiKey,
      senderid: senderId,
      templateid: templateId,
      number: phone.replace(/^\+91/, ''),
      message,
    });

    try {
      const res = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
    } catch (e) {
      this.logger.error(`SMS send failed: ${(e as Error).message}`);
      throw ApiException.upstream('Could not send the OTP SMS. Please try again later.');
    }
  }

  /**
   * A non-OTP DLT SMS (the text must match the approved template exactly). Never throws: returns true only when the
   * gateway accepted it, so a bulk job can carry on and only log the numbers that really went out.
   */
  async sendTemplateSms(phone: string, templateId: string, message: string): Promise<boolean> {
    const apiKey = this.config.get<string>('SMS_FORTIUS_API_KEY');
    const senderId = this.config.get<string>('SMS_FORTIUS_SENDER_ID');
    const baseUrl = this.config.get<string>('SMS_FORTIUS_BASE_URL');
    if (!apiKey || !senderId || !baseUrl || !templateId) {
      if (this.config.get('NODE_ENV') !== 'production') this.logger.warn(`[SMS mock] ${phone} -> ${message}`);
      else this.logger.error('SMS gateway is not configured; the SMS was not sent.');
      return false;
    }
    const params = new URLSearchParams({
      apikey: apiKey,
      senderid: senderId,
      templateid: templateId,
      number: phone.replace(/^\+91/, ''),
      message,
    });
    try {
      const res = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
      return true;
    } catch (e) {
      this.logger.error(`SMS to ${phone.slice(0, -4)}**** failed: ${(e as Error).message}`);
      return false;
    }
  }

  private async sendOtpEmail(to: string, otp: string, ttlMinutes: number): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      if (this.config.get('NODE_ENV') !== 'production') this.logger.warn(`[OTP mock] ${to} -> ${otp}`);
      else this.logger.error('SMTP is not configured; OTP email was not delivered.');
      return;
    }
    try {
      await this.getTransporter().sendMail({
        from: this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER'),
        to,
        subject: 'Your Daily Meat Login OTP',
        text: `Welcome to Daily Meat! Your login OTP is ${otp}. It is valid for ${ttlMinutes} minutes. Please do not share it with anyone.`,
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
          <h2 style="color:#6C210A">Daily Meat</h2>
          <p>Use this one-time password to continue:</p>
          <p style="font-size:32px;letter-spacing:8px;font-weight:700">${otp}</p>
          <p style="color:#666">Valid for ${ttlMinutes} minutes. Do not share it with anyone.</p></div>`,
      });
    } catch (e) {
      this.logger.error(`Email send failed: ${(e as Error).message}`);
      throw ApiException.upstream('Could not send the OTP email. Please try again later.');
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get('SMTP_PORT') ?? 587);
      this.transporter = createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port,
        secure: port === 465,
        auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') },
      });
    }
    return this.transporter;
  }
}
