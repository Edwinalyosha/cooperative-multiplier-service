import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FineractModule } from '../fineract/fineract.module';
import { AuthModule } from '../auth/auth.module';
import { WebhookSecretGuard } from './guards/webhook-secret.guard';
import { OnboardingEmailService } from './onboarding-email.service';

@Module({
  imports: [
    MultiplierModule,
    QueueModule,
    PrismaModule,
    FineractModule,
    AuthModule,
    HttpModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookSecretGuard, OnboardingEmailService],
})
export class WebhooksModule {}
