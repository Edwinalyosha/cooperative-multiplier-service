import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
     * Authentication is opt-OUT, not opt-in. Every route requires a valid
     * JWT unless it carries @Public(); see MobileJwtGuard for why.
     *
     * Order matters: MobileJwtGuard attaches request.user, and RolesGuard
     * reads it. Nest runs APP_GUARDs in registration order.
     *
     * RolesGuard is safe to apply globally — it passes through any route
     * with no @Roles() metadata.
     */
    { provide: APP_GUARD, useClass: MobileJwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
