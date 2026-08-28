import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  /**
   * This service always sits behind Caddy, so every request arrives from the
   * Docker network gateway. Without this, req.ip is that single proxy address
   * for everyone — which would make the rate limiter count all members
   * together and lock the whole cooperative out at once, while doing nothing
   * to slow a real attacker.
   *
   * `1` = trust exactly one proxy hop (Caddy), so the client IP is taken from
   * the last entry in X-Forwarded-For and cannot be spoofed by a caller
   * inventing extra hops.
   */
  app.set('trust proxy', 1);

  const corsOrigins = config.get<string[]>('mobile.corsOrigins') ?? ['*'];
  if (corsOrigins.includes('*')) {
    logger.warn(
      'MOBILE_CORS_ORIGINS is unset or "*" — any origin may call this API ' +
        'with credentials. Set it to the webapp origin.',
    );
  }

  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * Swagger is OFF unless SWAGGER_ENABLED=true. It publishes a complete,
   * self-documenting index of every endpoint — including which ones carry
   * @ApiBearerAuth and which do not, which is precisely the map an attacker
   * would otherwise have to build by hand. It was reachable unauthenticated
   * at /api/docs until 2026-08-28.
   */
  if (config.get<boolean>('swagger.enabled')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Multiplier Engine API')
      .setDescription(
        'Credit scoring, loyalty, and loan eligibility engine on Apache Fineract',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.warn('Swagger UI is ENABLED at /api/docs');
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
