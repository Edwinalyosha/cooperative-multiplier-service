import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [MultiplierModule, QueueModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
