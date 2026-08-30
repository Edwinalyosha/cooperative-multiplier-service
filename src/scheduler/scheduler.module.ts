import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EligibilityScheduler } from './eligibility.scheduler';
import { LoanExpiryScheduler } from './loan-expiry.scheduler';
import { ContributionSweepScheduler } from './contribution-sweep.scheduler';
import { SavingsHoldReleaseScheduler } from './savings-hold-release.scheduler';
// RepaymentAssessmentService comes from LoansModule, already imported below.
import { RepaymentSweepScheduler } from './repayment-sweep.scheduler';
import { SweepsController } from './sweeps.controller';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LoansModule } from '../loans/loans.module';
import { ContributionsModule } from '../contributions/contributions.module';
// SavingsHoldReleaseScheduler reads Fineract directly to decide whether a
// loan is still outstanding. Nothing else here imports it — MultiplierModule
// and ContributionsModule export only their own services — so omitting this
// fails at BOOT, not at the first cron fire.
import { FineractModule } from '../fineract/fineract.module';

/**
 * StreakScheduler was REMOVED 2026-08-28. It awarded the consecutive-on-time
 * bonus daily to anyone sitting on a qualifying streak, deduped only by "was
 * there one in the last 24 hours" — but MultiplierService.maybeApplyStreakBonus
 * already awards it synchronously the moment a streak reaches a milestone.
 *
 * Two paths for one bonus, and the scheduler's was the broken one:
 *
 *   - Its dedupe read MultiplierHistory, but with the async queue enabled the
 *     event is written by a worker LATER. While the worker was down the check
 *     kept finding nothing, so it enqueued another job every single day. All
 *     of them then applied at once when a worker reconnected — three landed
 *     in 1.5 seconds on 2026-08-28.
 *   - Even working correctly, a weekly contribution cadence leaves a streak
 *     sitting at a milestone for a whole week, so the 24-hour dedupe would
 *     re-award it roughly daily. Time cannot express "once per streak value".
 *
 * Invisible while the step was 0.000. At the real -0.020 it would have handed
 * out a third of the entire 0.6-1.5 band in a burst after any outage.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    MultiplierModule,
    QueueModule,
    LoansModule,
    ContributionsModule,
    FineractModule,
  ],
  providers: [
    EligibilityScheduler,
    LoanExpiryScheduler,
    ContributionSweepScheduler,
    SavingsHoldReleaseScheduler,
    RepaymentSweepScheduler,
  ],
  // Manual triggers for the same sweeps. Safe because every sweep is
  // idempotent by construction — see SweepsController.
  controllers: [SweepsController],
})
export class SchedulerModule {}
