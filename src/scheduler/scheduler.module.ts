import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EligibilityScheduler } from './eligibility.scheduler';
import { StreakScheduler } from './streak.scheduler';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    MultiplierModule,
    QueueModule,
  ],
  providers: [EligibilityScheduler, StreakScheduler],
})
export class SchedulerModule {}
