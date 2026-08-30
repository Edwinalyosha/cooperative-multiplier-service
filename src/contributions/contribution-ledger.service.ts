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
        // Settling the week and awarding the catch-up bonus are two separate
        // writes on purpose. Guarding the settlement on
        // `arrearsRewardAppliedAt: null` would leave any row that is not
        // eligible for a reward permanently unsettled — it would sit in
        // arrears, absorb the same allocation every week, and never close.
        // That is precisely the shape of an opening balance seeded at launch,
        // which carries no reward because the debt predates the system.
        await this.prisma.contributionPeriod.update({
          where: { id: row.id },
          data: {
            amountPaid: allocation.amountPaid,
            status: STATUS_SATISFIED,
            satisfiedAt: now,
          },
        });

        // The reward is for clearing a week the member was actually penalised
        // for. `arrearsRewardAppliedAt: null` in the WHERE makes a repeated
        // or concurrent run a no-op rather than a second award.
        if (row.penaltyAppliedAt != null && row.arrearsRewardAppliedAt == null) {
          const awarded = await this.prisma.contributionPeriod.updateMany({
            where: { id: row.id, arrearsRewardAppliedAt: null },
            data: { arrearsRewardAppliedAt: now },
          });

          if (awarded.count > 0) {
            arrearsCleared.push(allocation.periodStart);
            await this.multiplier.processEvent(
              clientId,
              MultiplierEventType.ARREARS_CLEARED,
              'contribution-ledger',
              `Cleared the missed week of ${allocation.periodStart}`,
            );
          }
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

  /**
   * What the member sees on their home screen: the week in progress, and
   * anything still owed from before.
   *
   * The current week has no ledger row — rows are created when a week closes
   * — so the amount paid is read live from Fineract. That is deliberate: the
   * value of this view is that a member notices they are short WHILE they can
   * still do something about it.
   *
   * `paidSoFar` is measured against deposits made during this week only.
   * Money paid this week goes to this week first (see allocatePayment), so
   * counting it here matches what will happen when the week closes.
   */
  async getThisWeek(
    clientId: number,
    amountDue: number,
    depositsThisWeek: number,
    period: ContributionPeriod,
    now: Date = new Date(),
  ) {
    const outstanding = Math.max(0, amountDue - depositsThisWeek);
    const arrears = await this.getArrears(clientId);
    const arrearsWeeks = await this.prisma.contributionPeriod.count({
      where: { clientId, status: { in: [STATUS_OPEN, STATUS_ARREARS] } },
    });

    return {
      periodStart: period.startDate,
      periodEnd: period.endDate,
      closesAt: period.closedAt,
      /** Whole days left, rounded down; 0 on the final day. */
      daysRemaining: Math.max(
        0,
        Math.floor((period.closedAt.getTime() - now.getTime()) / 86_400_000),
      ),
      amountDue,
      paidSoFar: depositsThisWeek,
      outstanding,
      /** PAID | PARTIAL | UNPAID — the week is not judged until it closes. */
      status:
        outstanding === 0 ? 'PAID' : depositsThisWeek > 0 ? 'PARTIAL' : 'UNPAID',
      arrearsTotal: arrears,
      arrearsWeeks,
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

  /**
   * Records weeks a director already owed before the system existed.
   *
   * Both timestamps are stamped at seed time, and neither records anything
   * that happened:
   *
   *  - `penaltyAppliedAt` PREVENTS a penalty. Without it the sweep would
   *    assess these weeks and drop everyone's multiplier for months they were
   *    never measured on.
   *  - `arrearsRewardAppliedAt` prevents the catch-up reward. There was no
   *    penalty to compensate, and rewarding it would hand the largest
   *    multiplier improvement to whoever owed the most at launch — paying the
   *    least diligent member best.
   *
   * The debt is real and still owed; only its effect on the multiplier is
   * suppressed. Refuses to touch a week that already has a row, so a repeated
   * run cannot overwrite a real assessment with an opening balance.
   */
  async seedOpeningArrears(
    clientId: number,
    weeks: { periodStart: string; periodEnd: string; amountDue: number; amountPaid?: number }[],
  ): Promise<{ created: string[]; skipped: string[] }> {
    const created: string[] = [];
    const skipped: string[] = [];
    const now = new Date();

    for (const week of weeks) {
      const existing = await this.prisma.contributionPeriod.findUnique({
        where: {
          clientId_periodStart: {
            clientId,
            periodStart: new Date(week.periodStart),
          },
        },
      });

      if (existing) {
        skipped.push(week.periodStart);
        continue;
      }

      const paid = week.amountPaid ?? 0;
      const settled = paid >= week.amountDue;

      await this.prisma.contributionPeriod.create({
        data: {
          clientId,
          periodStart: new Date(week.periodStart),
          periodEnd: new Date(week.periodEnd),
          amountDue: week.amountDue,
          amountPaid: paid,
          status: settled ? STATUS_SATISFIED : STATUS_ARREARS,
          satisfiedAt: settled ? now : null,
          penaltyAppliedAt: now,
          arrearsRewardAppliedAt: now,
        },
      });

      created.push(week.periodStart);
    }

    this.logger.log(
      `Seeded opening arrears for client ${clientId}: ` +
        `${created.length} created, ${skipped.length} already existed.`,
    );

    return { created, skipped };
  }

  /**
   * Every member with what they owe — the finance manager's collection sheet.
   *
   * Ordered by arrears descending so whoever is furthest behind is at the
   * top, which is the order a collection conversation actually happens in.
   */
  async collectionSheet(): Promise<
    { clientId: number; arrearsTotal: number; arrearsWeeks: number }[]
  > {
    const rows = await this.prisma.contributionPeriod.findMany({
      where: { status: { in: [STATUS_OPEN, STATUS_ARREARS] } },
      select: {
        clientId: true,
        amountDue: true,
        amountPaid: true,
        periodStart: true,
      },
    });

    const byClient = new Map<
      number,
      { clientId: number; arrearsTotal: number; arrearsWeeks: number }
    >();

    // Every director, including those who owe nothing — a collection sheet
    // that silently omits the members who are paid up would leave the finance
    // manager unable to tell "nothing owed" from "not a member".
    const directors = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true },
    });
    for (const director of directors) {
      byClient.set(director.clientId, {
        clientId: director.clientId,
        arrearsTotal: 0,
        arrearsWeeks: 0,
      });
    }

    for (const row of rows) {
      const outstanding = Math.max(
        0,
        Number(row.amountDue) - Number(row.amountPaid),
      );
      if (outstanding === 0) continue;

      const entry = byClient.get(row.clientId) ?? {
        clientId: row.clientId,
        arrearsTotal: 0,
        arrearsWeeks: 0,
      };
      entry.arrearsTotal += outstanding;
      entry.arrearsWeeks += 1;
      byClient.set(row.clientId, entry);
    }

    return [...byClient.values()].sort(
      (a, b) => b.arrearsTotal - a.arrearsTotal || a.clientId - b.clientId,
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
