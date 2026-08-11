import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EligibilityScheduler } from './eligibility.scheduler';
import { StreakScheduler } from './streak.scheduler';
import { LoanExpiryScheduler } from './loan-expiry.scheduler';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    MultiplierModule,
    QueueModule,
    LoansModule,
  ],
  providers: [EligibilityScheduler, StreakScheduler, LoanExpiryScheduler],
})
export class SchedulerModule {}
