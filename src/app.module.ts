import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { MultiplierModule } from './multiplier/multiplier.module';
import { FineractModule } from './fineract/fineract.module';
import { ContributionsModule } from './contributions/contributions.module';
import { LoansModule } from './loans/loans.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MobileAuthModule } from './mobile-auth/mobile-auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ReportsModule } from './reports/reports.module';
import { MobileModule } from './mobile/mobile.module';
import { MobileJwtGuard } from './mobile-auth/guards/mobile-jwt.guard';
import { RolesGuard } from './mobile-auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('throttle.ttlSeconds', 60) * 1000,
            limit: config.get<number>('throttle.limit', 120),
          },
        ],
      }),
    }),
    PrismaModule,
    FineractModule,
    MultiplierModule,
    QueueModule,
    SchedulerModule,
    AuthModule,
    MobileAuthModule,
    WebhooksModule,
    ContributionsModule,
    LoansModule,
    ReportsModule,
    MobileModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /**
     * Guard order is registration order, and it matters here.
     *
     * ThrottlerGuard runs FIRST, before authentication: rejecting a flood
     * should be the cheapest thing this service does, rather than verifying
     * a JWT on every request of an attack.
     *
     * Then authentication is opt-OUT, not opt-in — every route requires a
     * valid JWT unless it carries @Public(). See MobileJwtGuard for why.
     *
     * RolesGuard runs last because it reads request.user, which
     * MobileJwtGuard attaches. It is safe to apply globally: any route with
     * no @Roles() metadata passes straight through.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: MobileJwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
