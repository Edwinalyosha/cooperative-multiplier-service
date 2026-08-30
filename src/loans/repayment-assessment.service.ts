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

    // A late installment that has since been paid earns the catch-up reward,
    // once. Checked before assessing new installments so a member who pays
    // several arrears at once is credited for each.
    await this.awardClearedArrears(clientId, fineractLoanId, schedule);

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

      const applied = await this.multiplier.processEvent(
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

      // What was ACTUALLY applied — 0 under shadow mode — so a later waiver
      // reverses exactly that rather than today's configured step.
      await this.prisma.repaymentAssessment.updateMany({
        where: { fineractLoanId, installmentNumber: installment.installment },
        data: { stepApplied: applied.stepAmount },
      });

      if (onTime) result.assessedOnTime++;
      else result.assessedLate++;
    }
  }

  /**
   * Rewards a late installment that has since been paid off.
   *
   * Symmetric with ARREARS_CLEARED on contributions: being late and then
   * paying should be better than never paying, and worse than never being
   * late. LATE_REPAYMENT_CLEARED (-0.010) against LATE_REPAYMENT (+0.030)
   * leaves a net +0.020, between the on-time -0.018 and the unpaid +0.030.
   *
   * `clearedAt: null` in the WHERE is the once-only guard, so a member who
   * stays paid up does not collect this every night.
   */
  private async awardClearedArrears(
    clientId: number,
    fineractLoanId: number,
    schedule: { installment: number; metOn: string | null }[],
  ): Promise<void> {
    const outstanding = await this.prisma.repaymentAssessment.findMany({
      where: {
        fineractLoanId,
        outcome: 'LATE',
        clearedAt: null,
        waivedAt: null,
      },
      select: { id: true, installmentNumber: true },
    });

    for (const row of outstanding) {
      const installment = schedule.find(
        (s) => s.installment === row.installmentNumber,
      );
      if (!installment?.metOn) continue; // still unpaid

      const claimed = await this.prisma.repaymentAssessment.updateMany({
        where: { id: row.id, clearedAt: null },
        data: { clearedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      await this.multiplier.processEvent(
        clientId,
        MultiplierEventType.LATE_REPAYMENT_CLEARED,
        'repayment-sweep',
        `Late installment ${row.installmentNumber} of loan ${fineractLoanId} ` +
          `has now been paid (${installment.metOn})`,
      );
    }
  }

  /**
   * Forgives a late installment: reverses the penalty, records who and why.
   *
   * Reverses the amount ACTUALLY applied, which is 0 for anything assessed
   * during the shadow period. The debt to Fineract is untouched — a waiver
   * forgives the multiplier penalty, not the money.
   */
  async waivePenalty(
    assessmentId: number,
    waivedBy: number,
    reason: string,
  ): Promise<{ waived: boolean; reversed: number }> {
    const assessment = await this.prisma.repaymentAssessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment || assessment.outcome !== 'LATE') {
      return { waived: false, reversed: 0 };
    }

    const claimed = await this.prisma.repaymentAssessment.updateMany({
      where: { id: assessmentId, waivedAt: null },
      data: { waivedAt: new Date(), waivedBy, waiveReason: reason },
    });
    if (claimed.count === 0) return { waived: false, reversed: 0 };

    const charged = Number(assessment.stepApplied ?? 0);
    await this.multiplier.reversePenalty(
      assessment.clientId,
      charged,
      `Late installment ${assessment.installmentNumber} of loan ` +
        `${assessment.fineractLoanId} forgiven: ${reason}`,
      'repayment-waiver',
    );

    return { waived: true, reversed: charged };
  }

  /** Late installments whose penalty still stands — what can be forgiven. */
  async listWaivablePenalties(clientId: number) {
    const rows = await this.prisma.repaymentAssessment.findMany({
      where: { clientId, outcome: 'LATE', waivedAt: null },
      orderBy: { dueDate: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      fineractLoanId: row.fineractLoanId,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate.toISOString().slice(0, 10),
      metOn: row.metOn ? row.metOn.toISOString().slice(0, 10) : null,
      stepApplied: Number(row.stepApplied ?? 0),
      /** 0 means recorded during the trial period and never charged. */
      wasCharged: Number(row.stepApplied ?? 0) > 0,
    }));
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
