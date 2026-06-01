import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { ReportsService } from '../reports/reports.service';
import { LoginDto } from '../auth/dto/login.dto';

@Injectable()
export class MobileService {
  constructor(
    private readonly authService: AuthService,
    private readonly multiplierService: MultiplierService,
    private readonly fineractService: FineractService,
    private readonly reportsService: ReportsService,
  ) {}

  login(dto: LoginDto) {
    return this.authService.login(dto);
  }

  async getDashboard(clientId: number) {
    const [profile, eligibility, recentHistory, fineractBalance] =
      await Promise.all([
        this.multiplierService.getProfile(clientId),
        this.multiplierService
          .getEligibility(clientId)
          .catch(() => null),
        this.multiplierService.getHistory(clientId, 5),
        this.fineractService.getContributionBalance(clientId),
      ]);

    return {
      clientId,
      profile,
      eligibility,
      fineractContributionBalance: fineractBalance,
      recentHistory,
      tips: this.buildTips(profile, eligibility),
    };
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
