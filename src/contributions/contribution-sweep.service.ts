import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
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
    private readonly multiplierService: MultiplierService,
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

    if (await this.alreadyProcessed(director.clientId, period)) {
      return 'skippedAlreadyProcessed';
    }

    const deposits = await this.fineract.getDepositsBetween(
      director.clientId,
      period.startDate,
      period.endDate,
    );
    const total = deposits.reduce((sum, d) => sum + d.amount, 0);

    // Partial payment is not a met obligation: below the minimum counts as
    // late, per the cooperative's decision. Depositing 5,000 against a 20,000
    // weekly is not three-quarters of a contribution.
    const metMinimum = total >= this.minimumAmount;

    await this.multiplierService.processEvent(
      director.clientId,
      metMinimum
        ? MultiplierEventType.ON_TIME_CONTRIBUTION
        : MultiplierEventType.LATE_CONTRIBUTION,
      'contribution-sweep',
      `Week ${period.startDate}..${period.endDate}: deposited ${total} ` +
        `against a ${this.minimumAmount} minimum` +
        (deposits.length === 0 ? ' (no deposits found)' : ''),
    );

    return metMinimum ? 'onTime' : 'late';
  }

  /**
   * Has this member already been assessed for this period?
   *
   * Running the sweep twice must not penalise anyone twice — a container
   * restart, a manual re-run, or an overlapping cron would otherwise move a
   * multiplier by 0.04 instead of 0.02 with nothing in the system explaining
   * why.
   *
   * Derived from MultiplierHistory rather than a tracking table: any
   * contribution event recorded SINCE the period closed can only belong to
   * this period, because earlier periods were assessed before that instant.
   * That reuses data we already write and cannot drift out of sync with it.
   */
  private async alreadyProcessed(
    clientId: number,
    period: ContributionPeriod,
  ): Promise<boolean> {
    const existing = await this.prisma.multiplierHistory.findFirst({
      where: {
        clientId,
        eventType: {
          in: [
            MultiplierEventType.ON_TIME_CONTRIBUTION,
            MultiplierEventType.LATE_CONTRIBUTION,
          ],
        },
        createdAt: { gte: period.closedAt },
      },
      select: { id: true },
    });
    return existing !== null;
  }
}
