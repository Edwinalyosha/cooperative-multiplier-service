import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoansService } from '../loans/loans.service';

/**
 * Phase 5 — 48h auto-expiry sweep for loan applications nobody acted on
 * in time. Runs hourly (not daily like the other two schedulers here) so
 * the 48h deadline stays reasonably tight — decided 2026-08-11. See
 * context/loan-approval-workflow-spec.md.
 */
@Injectable()
export class LoanExpiryScheduler {
  private readonly logger = new Logger(LoanExpiryScheduler.name);

  constructor(private readonly loansService: LoansService) {}

  @Cron(process.env.CRON_LOAN_EXPIRY_CHECK ?? '0 * * * *')
  async handleLoanExpirySweep() {
    this.logger.log('Starting loan application expiry sweep');
    const result = await this.loansService.expireStaleApplications();
    if (result.expired > 0 || result.failed > 0) {
      this.logger.log(
        `Loan expiry sweep complete: ${result.expired} expired, ${result.failed} failed`,
      );
    }
  }
}
