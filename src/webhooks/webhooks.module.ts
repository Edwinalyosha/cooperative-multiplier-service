import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FineractModule } from '../fineract/fineract.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MultiplierModule, QueueModule, PrismaModule, FineractModule, AuthModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
