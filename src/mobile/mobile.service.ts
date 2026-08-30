import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { ReportsService } from '../reports/reports.service';
import { ContributionLedgerService } from '../contributions/contribution-ledger.service';
import { currentWeek } from '../contributions/contribution-period.util';

@Injectable()
export class MobileService {
  private readonly logger = new Logger(MobileService.name);

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly fineractService: FineractService,
    private readonly reportsService: ReportsService,
    private readonly ledger: ContributionLedgerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The week in progress: what is owed, what has been paid so far, and how
   * long is left.
   *
   * Returns null rather than throwing when Fineract cannot be read. A member
   * should still get their dashboard, and "we could not check" must be
   * distinguishable in the UI from "you have paid nothing" — the second is an
   * accusation, and making it on the strength of an outage would be wrong.
   */
  async getThisWeek(clientId: number, now: Date = new Date()) {
    const period = currentWeek(now);
    const amountDue =
      this.config.get<number>('multiplier.weeklyContributionMinimum') ?? 20000;

    try {
      const deposits = await this.fineractService.getDepositsBetween(
        clientId,
        period.startDate,
        period.endDate,
      );
      const paid = deposits.reduce((sum, d) => sum + d.amount, 0);
      return await this.ledger.getThisWeek(
        clientId,
        amountDue,
        paid,
        period,
        now,
      );
    } catch (error) {
      this.logger.warn(
        `Could not read this week's contributions for client ${clientId}: ` +
          `${(error as Error)?.message ?? 'unknown error'}`,
      );
      return null;
    }
  }

  async getDashboard(clientId: number) {
    const [
      profile,
      eligibility,
      recentHistory,
      fineractBalance,
      ownership,
      outstandingLoanBalance,
      thisWeek,
    ] = await Promise.all([
        this.multiplierService.getProfile(clientId),
        this.multiplierService
          .getEligibility(clientId)
          .catch(() => null),
        this.multiplierService.getHistory(clientId, 5),
        this.fineractService.getContributionBalance(clientId),
        // Never fatal: a member should still get their dashboard if the share
        // calculation fails.
        this.multiplierService.getOwnershipShare(clientId).catch(() => null),
        // What they currently owe. null means "could not read", which the UI
        // must show differently from 0 — telling a borrower they owe nothing
        // because Fineract was briefly down would be worse than saying so.
        this.fineractService
          .getOutstandingLoanBalance(clientId)
          .catch(() => null),
        this.getThisWeek(clientId),
      ]);

    return {
      clientId,
      profile,
      eligibility,
      fineractContributionBalance: fineractBalance,
      ownership,
      outstandingLoanBalance,
      thisWeek,
      recentHistory,
      tips: this.buildTips(profile, eligibility),
    };
  }

  /** Every unpaid week, oldest first — "what I still owe". */
  getArrears(clientId: number) {
    return this.ledger.listArrears(clientId);
  }

  getOwnershipShare(clientId: number) {
    return this.multiplierService.getOwnershipShare(clientId);
  }

  getProfile(clientId: number) {
    return this.multiplierService.getProfile(clientId);
  }

  getEligibility(clientId: number, refresh?: boolean) {
    return this.multiplierService.getEligibility(clientId, undefined, refresh);
  }

  getHistory(clientId: number, limit = 20) {
    return this.multiplierService.getHistory(clientId, limit);
  }

  getClientReport(clientId: number) {
    return this.reportsService.getClientReport(clientId);
  }

  private buildTips(
    profile: Awaited<ReturnType<MultiplierService['getProfile']>>,
    eligibility: Awaited<ReturnType<MultiplierService['getEligibility']>> | null,
  ): string[] {
    const tips: string[] = [];

    if (profile.multiplier < 1) {
      tips.push('Your multiplier is below 1.0 — on-time contributions improve it.');
    }
    if (profile.consecutiveOnTimeContributions >= 2) {
      tips.push(
        `You have ${profile.consecutiveOnTimeContributions} on-time contributions in a row. Keep it up for streak rewards.`,
      );
    }
    if (eligibility?.isEligible) {
      tips.push(
        `You may qualify for up to ${eligibility.maxLoanAmount.toLocaleString()} based on your current balance.`,
      );
    } else if (eligibility) {
      tips.push('Increase your contribution balance to unlock loan eligibility.');
    }

    return tips;
  }
}
