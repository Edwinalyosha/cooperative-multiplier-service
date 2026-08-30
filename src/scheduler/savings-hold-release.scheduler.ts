import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { LoansService } from '../loans/loans.service';
import { redactFineractError } from '../fineract/fineract-error.util';

/**
 * Releases collateral holds once the loans they secure are settled.
 *
 * A sweep rather than a webhook, deliberately. A loan ends by an event this
 * service never sees — a final repayment taken at a branch, a write-off, a
 * finance manager closing it in mifos-web — and a missed webhook would leave
 * a member's savings frozen indefinitely with nothing to notice it. A sweep
 * that re-reads state is self-healing: whatever it misses today it catches
 * tomorrow.
 *
 * Errs towards keeping money frozen. A hold is released only on positive
 * evidence that the loan is no longer active; an unreadable Fineract leaves
 * the hold in place and tries again next run. The opposite bias would free
 * collateral on an outage.
 */
@Injectable()
export class SavingsHoldReleaseScheduler {
  private readonly logger = new Logger(SavingsHoldReleaseScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fineract: FineractService,
    private readonly loans: LoansService,
  ) {}

  @Cron(process.env.CRON_SAVINGS_HOLD_RELEASE ?? '0 2 * * *')
  async handleReleaseSweep() {
    if (!this.fineract.isConfigured()) {
      this.logger.warn(
        'Fineract not configured; savings-hold release sweep skipped. Any ' +
          'existing holds remain in place.',
      );
      return;
    }

    const open = await this.prisma.loanApplication.findMany({
      where: {
        savingsHoldTransactionId: { not: null },
        savingsHoldReleasedAt: null,
      },
      select: { id: true, clientId: true, fineractLoanId: true },
    });

    if (open.length === 0) return;

    let released = 0;
    let stillOutstanding = 0;
    let failed = 0;

    for (const application of open) {
      try {
        const activeLoanIds = await this.fineract.getActiveLoanIds(
          application.clientId,
        );

        if (
          application.fineractLoanId &&
          activeLoanIds.includes(application.fineractLoanId)
        ) {
          stillOutstanding += 1;
          continue;
        }

        if (await this.loans.releaseSavingsHold(application.id)) released += 1;
      } catch (error) {
        // One member's outage must not abandon the rest of the sweep, and an
        // unreadable loan is not evidence it was repaid.
        failed += 1;
        this.logger.error(
          `Could not resolve the savings hold on application ` +
            `${application.id}; it stays frozen and will be retried: ` +
            redactFineractError(error),
        );
      }
    }

    this.logger.log(
      `Savings-hold release sweep: ${released} released, ` +
        `${stillOutstanding} still securing an active loan, ${failed} failed.`,
    );
  }
}
