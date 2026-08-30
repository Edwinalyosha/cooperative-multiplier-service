import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { allocatePayment, totalArrears } from './contribution-allocation.util';
import type { ContributionPeriod } from './contribution-period.util';

export interface PeriodAssessment {
  clientId: number;
  periodStart: string;
  amountDue: number;
  amountPaid: number;
  satisfied: boolean;
  /** True only when this call charged the penalty — never on a re-run. */
  penaltyCharged: boolean;
  /** Older weeks this payment finished off. */
  arrearsCleared: string[];
  arrearsRemaining: number;
}

const STATUS_OPEN = 'OPEN';
const STATUS_SATISFIED = 'SATISFIED';
const STATUS_ARREARS = 'ARREARS';

/**
 * The contribution ledger: one obligation per member per week, and the rules
 * for settling them.
 *
 * The cooperative's model — every week a director owes a set amount; a missed
 * week is DEFERRED interest-free rather than forgiven; a payment covers the
 * current week first and then backfills the oldest unpaid one.
 *
 * The reason this is a table and not a calculation is that "penalise a missed
 * week exactly once" has to survive re-runs, restarts, a sweep that fires
 * late, and a finance manager recording a contribution by hand. Time-based
 * dedupe cannot promise that — it only looks correct while nothing else
 * writes. This charges the penalty in the same write that stamps
 * `penaltyAppliedAt`, so the guarantee is a property of the data.
 */
@Injectable()
export class ContributionLedgerService {
  private readonly logger = new Logger(ContributionLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly multiplier: MultiplierService,
  ) {}

  /**
   * Settles one closed week for one member.
   *
   * `deposits` is what they paid into their CONTRIBUTIONS account during the
   * week. It is applied to this week first, then to their oldest unpaid weeks
   * — so someone paying the weekly amount while behind stops falling further
   * behind, rather than servicing old debt and collecting a fresh penalty.
   */
  async assessPeriod(
    clientId: number,
    period: ContributionPeriod,
    amountDue: number,
    deposits: number,
  ): Promise<PeriodAssessment> {
    // amountDue is snapshotted here and never re-read from config. The weekly
    // figure changes over time; judging an old week by today's amount would
    // turn fully-paid weeks into arrears the moment the rate rose.
    const current = await this.prisma.contributionPeriod.upsert({
      where: {
        clientId_periodStart: {
          clientId,
          periodStart: new Date(period.startDate),
        },
      },
      create: {
        clientId,
        periodStart: new Date(period.startDate),
        periodEnd: new Date(period.endDate),
        amountDue,
        status: STATUS_OPEN,
      },
      update: {},
    });

    const outstanding = await this.prisma.contributionPeriod.findMany({
      where: { clientId, status: { in: [STATUS_OPEN, STATUS_ARREARS] } },
      orderBy: { periodStart: 'asc' },
    });

    const { allocations } = allocatePayment(
      outstanding.map((row) => ({
        periodStart: toDateString(row.periodStart),
        amountDue: Number(row.amountDue),
        amountPaid: Number(row.amountPaid),
      })),
      deposits,
      period.startDate,
    );

    const now = new Date();
    const arrearsCleared: string[] = [];
    let penaltyCharged = false;
    let thisWeekPaid = Number(current.amountPaid);
    let thisWeekSatisfied = false;

    for (const allocation of allocations) {
      const row = outstanding.find(
        (r) => toDateString(r.periodStart) === allocation.periodStart,
      );
      if (!row) continue;

      const isThisWeek = allocation.periodStart === period.startDate;
      if (isThisWeek) {
        thisWeekPaid = allocation.amountPaid;
        thisWeekSatisfied = allocation.satisfied;
      }

      if (allocation.satisfied) {
        // A week that had already been penalised and is now paid off earns
        // the catch-up reward — once. `arrearsRewardAppliedAt: null` in the
        // WHERE makes a concurrent or repeated run a no-op rather than a
        // second award.
        const wasInArrears = row.penaltyAppliedAt != null;
        const updated = await this.prisma.contributionPeriod.updateMany({
          where: {
            id: row.id,
            ...(wasInArrears ? { arrearsRewardAppliedAt: null } : {}),
          },
          data: {
            amountPaid: allocation.amountPaid,
            status: STATUS_SATISFIED,
            satisfiedAt: now,
            ...(wasInArrears ? { arrearsRewardAppliedAt: now } : {}),
          },
        });

        if (wasInArrears && updated.count > 0) {
          arrearsCleared.push(allocation.periodStart);
          await this.multiplier.processEvent(
            clientId,
            MultiplierEventType.ARREARS_CLEARED,
            'contribution-ledger',
            `Cleared the missed week of ${allocation.periodStart}`,
          );
        }
      } else {
        // Short of the amount due. The money still counts against the debt —
        // the week is late, but the member gets credit for what they paid.
        await this.prisma.contributionPeriod.update({
          where: { id: row.id },
          data: { amountPaid: allocation.amountPaid },
        });
      }
    }

    if (thisWeekSatisfied) {
      await this.multiplier.processEvent(
        clientId,
        MultiplierEventType.ON_TIME_CONTRIBUTION,
        'contribution-ledger',
        `Met the ${period.startDate} contribution in full`,
      );
    } else {
      // THE guarantee. `penaltyAppliedAt: null` in the WHERE means only the
      // first caller to reach this row charges anything; every later run
      // matches zero rows and does nothing. No timing assumption, no
      // dependence on the scheduler firing exactly once.
      const charged = await this.prisma.contributionPeriod.updateMany({
        where: { id: current.id, penaltyAppliedAt: null },
        data: { status: STATUS_ARREARS, penaltyAppliedAt: now },
      });

      if (charged.count > 0) {
        penaltyCharged = true;
        await this.multiplier.processEvent(
          clientId,
          MultiplierEventType.LATE_CONTRIBUTION,
          'contribution-ledger',
          `Missed the ${period.startDate} contribution ` +
            `(${thisWeekPaid} of ${amountDue})`,
        );
      } else {
        this.logger.debug(
          `Client ${clientId} was already penalised for ${period.startDate}; ` +
            'not charging again.',
        );
      }
    }

    return {
      clientId,
      periodStart: period.startDate,
      amountDue,
      amountPaid: thisWeekPaid,
      satisfied: thisWeekSatisfied,
      penaltyCharged,
      arrearsCleared,
      arrearsRemaining: await this.getArrears(clientId),
    };
  }

  /** What this member still owes across every unpaid week. */
  async getArrears(clientId: number): Promise<number> {
    const rows = await this.prisma.contributionPeriod.findMany({
      where: { clientId, status: { in: [STATUS_OPEN, STATUS_ARREARS] } },
      select: { amountDue: true, amountPaid: true, periodStart: true },
    });

    return totalArrears(
      rows.map((r) => ({
        periodStart: toDateString(r.periodStart),
        amountDue: Number(r.amountDue),
        amountPaid: Number(r.amountPaid),
      })),
    );
  }

  /** Every unpaid week, oldest first — what a member sees as "what I owe". */
  async listArrears(clientId: number) {
    const rows = await this.prisma.contributionPeriod.findMany({
      where: { clientId, status: { in: [STATUS_OPEN, STATUS_ARREARS] } },
      orderBy: { periodStart: 'asc' },
    });

    return rows.map((row) => ({
      periodStart: toDateString(row.periodStart),
      periodEnd: toDateString(row.periodEnd),
      amountDue: Number(row.amountDue),
      amountPaid: Number(row.amountPaid),
      outstanding: Math.max(0, Number(row.amountDue) - Number(row.amountPaid)),
      penalised: row.penaltyAppliedAt != null,
    }));
  }
}

/** Prisma returns a Date for a DATE column; the ledger keys on YYYY-MM-DD. */
function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
