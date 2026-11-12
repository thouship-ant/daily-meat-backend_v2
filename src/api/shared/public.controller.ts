import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators';
import { ContactMessageDto } from './shared.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/cache/cache.service';

/** Unauthenticated endpoints shared by all apps. */
@ApiTags('Public')
@Public()
@Controller()
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness + database + cache (Redis or in-memory) check' })
  async health(@Res({ passthrough: true }) res: Response) {
    // `cache.backend` says whether Redis is really in use ("memory" in production means REDIS_URL is not reaching the API)
    const cache = await this.cache.health();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      // new code on an old database (migrations not applied): orders / users queries fail, so say so here
      const missing = await this.prisma.schemaMissing().catch(() => [] as string[]);
      if (missing.length) {
        res.status(HttpStatus.SERVICE_UNAVAILABLE);
        return { status: 'degraded', uptime: Math.round(process.uptime()), database: 'up', schema: { upToDate: false, missing: missing.slice(0, 30) }, cache };
      }
      return { status: 'ok', uptime: Math.round(process.uptime()), database: 'up', schema: { upToDate: true }, cache };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', uptime: Math.round(process.uptime()), database: 'down', cache };
    }
  }

  @Post('contact')
  @ApiOperation({ summary: 'Website contact form' })
  async contact(@Body() dto: ContactMessageDto) {
    const saved = await this.prisma.contactMessage.create({ data: { name: dto.name, email: dto.email, message: dto.message } });
    return { id: saved.id, message: 'Your message has been received. We will get back to you shortly!' };
  }

  @Get('app-version')
  @ApiOperation({ summary: 'Latest store build numbers, so the apps can prompt for an upgrade' })
  appVersion() {
    const c = this.config;
    return {
      android: { latestBuild: Number(c.get('APP_ANDROID_LATEST_BUILD') ?? 0), storeUrl: c.get('APP_ANDROID_STORE_URL') || null },
      ios: { latestBuild: Number(c.get('APP_IOS_LATEST_BUILD') ?? 0), storeUrl: c.get('APP_IOS_STORE_URL') || null },
    };
  }
}
