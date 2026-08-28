import { Module } from '@nestjs/common';
import { ContributionsService } from './contributions.service';
import { ContributionSweepService } from './contribution-sweep.service';
import { ContributionsController } from './contributions.controller';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { FineractModule } from '../fineract/fineract.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [MultiplierModule, QueueModule, FineractModule, PrismaModule],
  providers: [ContributionsService, ContributionSweepService],
  controllers: [ContributionsController],
  exports: [ContributionSweepService],
})
export class ContributionsModule {}
