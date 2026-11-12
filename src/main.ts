import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AdminApiModule } from './api/admin/admin-api.module';
import { CustomerApiModule } from './api/customer/customer-api.module';
import { DriverApiModule } from './api/driver/driver-api.module';
import { requestId } from './common/middleware/request-id.middleware';

async function bootstrap() {
  // rawBody: the payment webhook signature is computed over the exact bytes Cashfree sent
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefix = config.get<string>('API_PREFIX') ?? 'api/v1';
  app.setGlobalPrefix(prefix);
  app.use(requestId);
  app.use(helmet());
  app.use(compression());
  // Find slow endpoints: every response carries Server-Timing, and anything over 800 ms is logged
  app.use((req: any, res: any, next: () => void) => {
    const start = process.hrtime.bigint();
    const original = res.writeHead;
    res.writeHead = function (...args: any[]) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
      if (ms > 800) logger.warn(`Slow request ${req.method} ${req.originalUrl} took ${ms.toFixed(0)} ms`);
      return original.apply(this, args);
    };
    next();
  });
  app.getHttpAdapter().getInstance().set('trust proxy', 1); // behind a reverse proxy / load balancer: real client IPs for rate limiting

  const origins = (config.get<string>('CORS_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true, exposedHeaders: ['x-request-id'] });
  app.enableShutdownHooks();

  if (config.get<boolean>('SWAGGER_ENABLED') ?? true) {
    const surfaces = [
      { path: 'customer', title: 'Daily Meat · Customer API', module: CustomerApiModule },
      { path: 'admin', title: 'Daily Meat · Admin API', module: AdminApiModule },
      { path: 'driver', title: 'Daily Meat · Driver API', module: DriverApiModule },
    ];
    for (const s of surfaces) {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle(s.title)
          .setDescription(
            'All responses use one envelope: `{ success, data, meta?, message?, requestId, timestamp }`. ' +
              'Errors: `{ success:false, error:{ code, message, statusCode, details? }, requestId, path, timestamp }`.',
          )
          .setVersion('2.0')
          .addBearerAuth()
          .build(),
        { include: [s.module] },
      );
      SwaggerModule.setup(`docs/${s.path}`, app, doc, { swaggerOptions: { persistAuthorization: true } });
    }
  }

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API v2 listening on :${port}/${prefix}  (docs: /docs/customer, /docs/admin, /docs/driver)`);
}

void bootstrap();
