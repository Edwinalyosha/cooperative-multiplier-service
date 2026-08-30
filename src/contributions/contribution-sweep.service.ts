import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { ContributionLedgerService } from './contribution-ledger.service';
import {
  ContributionPeriod,
  lastCompletedWeek,
  wasOpenForWholePeriod,
} from './contribution-period.util';

export interface SweepResult {
  period: { startDate: string; endDate: string };
  onTime: number;
  late: number;
  /** Already processed for this period — a re-run, not a new decision. */
  skippedAlreadyProcessed: number;
  /** Joined mid-period; counting starts from their first full week. */
  skippedTooNew: number;
  /** Fineract could not be read; deliberately NOT marked late. */
  failed: number;
}

/**
 * Weekly contribution sweep.
 *
 * Recording a contribution has always been two separate things: the money is
 * a deposit into the member's Fineract savings account, and the TIMELINESS is
 * an event that moves their multiplier. Nothing ever fired the second one —
 * only the USER/CREATE hook was registered — which is why every
 * currentMultiplier sat at exactly 1.000.
 *
 * A deposit-triggered webhook was considered and rejected: it can only fire
 * when money arrives, so a member who contributes NOTHING generates no event
 * and is never marked late, while a member who pays three days late is
 * penalised. That would make not contributing better than contributing late,
 * which inverts the point of a savings cooperative. Absence only becomes an
 * event if something goes looking for it, so this sweeps on a schedule.
 */
@Injectable()
export class ContributionSweepService {
  private readonly logger = new Logger(ContributionSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fineract: FineractService,
    private readonly ledger: ContributionLedgerService,
    private readonly config: ConfigService,
  ) {}

  private get minimumAmount(): number {
    return this.config.get<number>('multiplier.weeklyContributionMinimum') ?? 20000;
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const period = lastCompletedWeek(now);
    const result: SweepResult = {
      period: { startDate: period.startDate, endDate: period.endDate },
      onTime: 0,
      late: 0,
      skippedAlreadyProcessed: 0,
      skippedTooNew: 0,
      failed: 0,
    };

    if (!this.fineract.isConfigured()) {
      this.logger.warn(
        'Fineract is not configured; contribution sweep skipped entirely. ' +
          'No member has been marked late.',
      );
      return result;
    }

    const directors = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true, createdAt: true },
    });

    for (const director of directors) {
      try {
        const outcome = await this.sweepOne(director, period);
        result[outcome]++;
      } catch (error) {
        // A member is never marked late because we failed to READ their
        // account. Silence from Fineract is not evidence they did not pay,
        // and a wrongly-applied penalty moves their real interest rate.
        result.failed++;
        this.logger.error(
          `Contribution sweep failed for client ${director.clientId} ` +
            `(${period.startDate}..${period.endDate}); left unrecorded rather ` +
            `than assumed late: ${(error as Error)?.message ?? 'unknown error'}`,
        );
      }
    }

    return result;
  }

  private async sweepOne(
    director: { clientId: number; createdAt: Date },
    period: ContributionPeriod,
  ): Promise<
    'onTime' | 'late' | 'skippedAlreadyProcessed' | 'skippedTooNew'
  > {
    // Joined mid-period — per the cooperative's decision, skip the half week
    // and start counting from their first full one. Their very first
    // experience of the portal should not be a penalty for days before they
    // existed.
    if (
      !wasOpenForWholePeriod(
        director.createdAt.toISOString().slice(0, 10),
        period,
      )
    ) {
      return 'skippedTooNew';
    }

    const deposits = await this.fineract.getDepositsBetween(
      director.clientId,
      period.startDate,
      period.endDate,
    );
    const total = deposits.reduce((sum, d) => sum + d.amount, 0);

    // The ledger owns the decision from here. It snapshots what was owed for
    // this week, allocates the money (this week first, then the oldest unpaid
    // week), and charges the penalty at most once — enforced by
    // `penaltyAppliedAt: null` in the WHERE clause rather than by this sweep
    // running exactly once.
    //
    // The old "has any event been recorded since the period closed?" check
    // used to live here. It was a proxy for the real question and would skip
    // a member entirely if anything else had written an event — including a
    // finance manager recording a contribution by hand, which silently
    // suppressed the sweep's own verdict.
    const assessment = await this.ledger.assessPeriod(
      director.clientId,
      period,
      this.minimumAmount,
      total,
    );

    if (assessment.arrearsCleared.length > 0) {
      this.logger.log(
        `Client ${director.clientId} cleared ${assessment.arrearsCleared.length} ` +
          `missed week(s): ${assessment.arrearsCleared.join(', ')}.`,
      );
    }

    if (assessment.satisfied) return 'onTime';
    // Not penalising again is not the same as not assessing: a re-run reports
    // the week as already handled rather than as a fresh late.
    return assessment.penaltyCharged ? 'late' : 'skippedAlreadyProcessed';
  }
}

/*
 * REMOVED 2026-08-30: a private `alreadyProcessed()` that asked
 * MultiplierHistory whether any contribution event existed since the period
 * closed.
 *
 * It was a proxy for "has this WEEK been assessed", and it answered a
 * different question — "has anything happened lately". Two consequences:
 *
 *   - A finance manager recording a contribution by hand made the sweep skip
 *     that member entirely, silently suppressing the sweep's own verdict,
 *     including a LATE one it would otherwise have found.
 *   - It could only ever express "once per stretch of time", never "once per
 *     obligation" — the same limitation that made StreakScheduler re-award a
 *     bonus daily (MLTD-P008).
 *
 * ContributionPeriod.penaltyAppliedAt answers the real question, and the
 * guarantee is enforced by the WHERE clause of the update that charges it
 * rather than by this sweep running exactly once.
 */
