import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EligibilityScheduler } from './eligibility.scheduler';
import { StreakScheduler } from './streak.scheduler';
import { LoanExpiryScheduler } from './loan-expiry.scheduler';
import { ContributionSweepScheduler } from './contribution-sweep.scheduler';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LoansModule } from '../loans/loans.module';
import { ContributionsModule } from '../contributions/contributions.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    MultiplierModule,
    QueueModule,
    LoansModule,
    ContributionsModule,
  ],
  providers: [
    EligibilityScheduler,
    StreakScheduler,
    LoanExpiryScheduler,
    ContributionSweepScheduler,
  ],
})
export class SchedulerModule {}
