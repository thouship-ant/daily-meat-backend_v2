import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators';
import { ContactMessageDto } from './shared.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Unauthenticated endpoints shared by all apps. */
@ApiTags('Public')
@Public()
@Controller()
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness + database check' })
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: Math.round(process.uptime()), database: 'up' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', uptime: Math.round(process.uptime()), database: 'down' };
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
