import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RepaymentAssessmentService } from '../loans/repayment-assessment.service';

/**
 * Daily check of loan installments that have fallen due.
 *
 * Daily rather than weekly because installment due dates are not aligned to
 * the contribution week — each loan has its own schedule — and a member
 * should learn their repayment was late within a day, not up to seven.
 *
 * Runs at 03:00 UTC (06:00 Kampala): after the savings-hold release at 02:00,
 * and well clear of the Sunday-night contribution sweep, so a slow Fineract
 * cannot have three sweeps contending at once.
 *
 * Safe to run repeatedly: each installment is assessed once, enforced by a
 * unique constraint rather than by this firing exactly once.
 */
@Injectable()
export class RepaymentSweepScheduler {
  private readonly logger = new Logger(RepaymentSweepScheduler.name);

  constructor(private readonly assessment: RepaymentAssessmentService) {}

  @Cron(process.env.CRON_REPAYMENT_SWEEP ?? '0 3 * * *')
  async handleRepaymentSweep() {
    const result = await this.assessment.sweep();

    if (result.assessedOnTime + result.assessedLate > 0 || result.failed > 0) {
      this.logger.log(
        `Repayment sweep: ${result.assessedOnTime} on time, ` +
          `${result.assessedLate} late, ${result.skippedAlreadyAssessed} ` +
          `already assessed, ${result.failed} failed.`,
      );
    }

    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} member(s) could not be assessed and were NOT marked ` +
          'late. They will be picked up on the next run.',
      );
    }
  }
}
