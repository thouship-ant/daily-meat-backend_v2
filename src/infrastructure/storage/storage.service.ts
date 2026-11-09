import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { ApiException, ErrorCode } from '../../common/api-error';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** S3-compatible image storage (AWS S3, Cloudflare R2, Supabase Storage, MinIO ...). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async uploadImage(file: Express.Multer.File, folder: string): Promise<string> {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'Only JPEG, PNG or WebP images are allowed.');
    }
    const bucket = this.config.get<string>('S3_BUCKET');
    if (!bucket) {
      throw ApiException.badRequest(ErrorCode.UPSTREAM_FAILED, 'Image storage is not configured (S3_BUCKET).');
    }
    const key = `${folder}/${randomUUID()}${extname(file.originalname).toLowerCase() || '.jpg'}`;
    try {
      await this.getClient().send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }),
      );
    } catch (e) {
      this.logger.error(`Upload failed: ${(e as Error).message}`);
      throw ApiException.upstream('Could not upload the image. Please try again.');
    }
    const base = this.config.get<string>('S3_PUBLIC_BASE_URL')?.replace(/\/$/, '');
    return base ? `${base}/${key}` : `https://${bucket}.s3.${this.config.get('AWS_REGION')}.amazonaws.com/${key}`;
  }

  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = this.config.get<string>('AWS_ENDPOINT');
      this.client = new S3Client({
        region: this.config.get<string>('AWS_REGION') || 'auto',
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        credentials: {
          accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID') ?? '',
          secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
        },
      });
    }
    return this.client;
  }
}
