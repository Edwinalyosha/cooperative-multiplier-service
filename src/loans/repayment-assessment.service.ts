import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { redactFineractError } from '../fineract/fineract-error.util';

export interface RepaymentSweepResult {
  assessedOnTime: number;
  assessedLate: number;
  /** Already assessed on an earlier run — not a new decision. */
  skippedAlreadyAssessed: number;
  /** Not yet due, so nothing to judge. */
  skippedNotDue: number;
  /** Fineract unreadable; deliberately NOT assessed. */
  failed: number;
}

/**
 * Whether loan installments were repaid on time.
 *
 * Closes MLTD-P009. Until this existed, repayment behaviour never moved a
 * member's multiplier: the events fired only when something called the API by
 * hand with an `onTime` boolean that verified nothing. Half the incentive
 * system was inert — a member could repay months late at no cost.
 *
 * Timeliness is READ from Fineract's schedule rather than inferred from what
 * was paid. Fineract already knows when each installment was due and when its
 * obligations were met; a threshold on payment size would call a part-payment
 * three weeks late "on time" and could never notice an installment missed
 * entirely.
 *
 * Assessed once per installment, enforced by a unique constraint rather than
 * by this running exactly once — the same rule the contribution ledger
 * follows, and for the same reasons.
 */
@Injectable()
export class RepaymentAssessmentService {
  private readonly logger = new Logger(RepaymentAssessmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fineract: FineractService,
    private readonly multiplier: MultiplierService,
  ) {}

  async sweep(now: Date = new Date()): Promise<RepaymentSweepResult> {
    const result: RepaymentSweepResult = {
      assessedOnTime: 0,
      assessedLate: 0,
      skippedAlreadyAssessed: 0,
      skippedNotDue: 0,
      failed: 0,
    };

    if (!this.fineract.isConfigured()) {
      this.logger.warn(
        'Fineract not configured; repayment sweep skipped. Nobody has been ' +
          'marked late.',
      );
      return result;
    }

    const today = toDateString(now);
    const directors = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true },
    });

    for (const director of directors) {
      try {
        const loanIds = await this.fineract.getActiveLoanIds(director.clientId);
        for (const loanId of loanIds) {
          await this.assessLoan(director.clientId, loanId, today, result);
        }
      } catch (error) {
        // A member is never marked late because their account could not be
        // READ. Silence is not evidence of non-payment, and the penalty moves
        // a real interest rate.
        result.failed++;
        this.logger.error(
          `Repayment sweep failed for client ${director.clientId}; left ` +
            `unassessed rather than assumed late: ${redactFineractError(error)}`,
        );
      }
    }

    return result;
  }

  private async assessLoan(
    clientId: number,
    fineractLoanId: number,
    today: string,
    result: RepaymentSweepResult,
  ): Promise<void> {
    const schedule = await this.fineract.getRepaymentSchedule(fineractLoanId);

    for (const installment of schedule) {
      // Nothing to judge until the due date has passed. A member with days
      // left has not failed at anything.
      if (installment.dueDate > today) {
        result.skippedNotDue++;
        continue;
      }

      // Met ON or BEFORE the due date is on time. Met after, or not met at
      // all while overdue, is late.
      const onTime =
        installment.metOn !== null && installment.metOn <= installment.dueDate;

      // create() rather than upsert(): the unique constraint is the guarantee,
      // and a duplicate key means another run already assessed this
      // installment — which is a skip, not an error.
      try {
        await this.prisma.repaymentAssessment.create({
          data: {
            clientId,
            fineractLoanId,
            installmentNumber: installment.installment,
            dueDate: new Date(installment.dueDate),
            metOn: installment.metOn ? new Date(installment.metOn) : null,
            outcome: onTime ? 'ON_TIME' : 'LATE',
          },
        });
      } catch {
        result.skippedAlreadyAssessed++;
        continue;
      }

      await this.multiplier.processEvent(
        clientId,
        onTime
          ? MultiplierEventType.ON_TIME_REPAYMENT
          : MultiplierEventType.LATE_REPAYMENT,
        'repayment-sweep',
        onTime
          ? `Installment ${installment.installment} of loan ${fineractLoanId} ` +
            `paid by its due date (${installment.dueDate})`
          : `Installment ${installment.installment} of loan ${fineractLoanId} ` +
            `was due ${installment.dueDate}` +
            (installment.metOn
              ? ` and paid ${installment.metOn}`
              : ' and is still unpaid'),
      );

      if (onTime) result.assessedOnTime++;
      else result.assessedLate++;
    }
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
