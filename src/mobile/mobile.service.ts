import { Injectable } from '@nestjs/common';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { ReportsService } from '../reports/reports.service';

@Injectable()
export class MobileService {
  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly fineractService: FineractService,
    private readonly reportsService: ReportsService,
  ) {}

  async getDashboard(clientId: number) {
    const [
      profile,
      eligibility,
      recentHistory,
      fineractBalance,
      ownership,
      outstandingLoanBalance,
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
      ]);

    return {
      clientId,
      profile,
      eligibility,
      fineractContributionBalance: fineractBalance,
      ownership,
      outstandingLoanBalance,
      recentHistory,
      tips: this.buildTips(profile, eligibility),
    };
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
