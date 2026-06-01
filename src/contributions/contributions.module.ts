import { Module } from '@nestjs/common';
import { ContributionsService } from './contributions.service';
import { ContributionsController } from './contributions.controller';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { FineractModule } from '../fineract/fineract.module';

@Module({
  imports: [MultiplierModule, QueueModule, FineractModule],
  providers: [ContributionsService],
  controllers: [ContributionsController],
})
export class ContributionsModule {}
