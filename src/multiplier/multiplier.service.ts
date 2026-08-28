import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DirectorMultiplier, Prisma } from '@prisma/client';

/** Selected fields for eligibility cache reads (matches prisma/schema.prisma). */
const eligibilitySelect = {
  clientId: true,
  currentMultiplier: true,
  loanMultiple: true,
  contributionBalance: true,
  maxLoanAmount: true,
  isEligible: true,
  eligibilityCheckedAt: true,
} as const;

/** Row shape returned when reading eligibility cache fields from the DB. */
interface DirectorEligibilityRow {
  clientId: number;
  currentMultiplier: Prisma.Decimal;
  loanMultiple: Prisma.Decimal;
  contributionBalance: Prisma.Decimal | null;
  maxLoanAmount: Prisma.Decimal | null;
  isEligible: boolean | null;
  eligibilityCheckedAt: Date | null;
}

function buildEligibilityUpdateData(
  contributionBalance: number,
  maxLoanAmount: number,
  isEligible: boolean,
  eligibilityCheckedAt: Date,
): Prisma.DirectorMultiplierUpdateInput {
  return {
    contributionBalance,
    maxLoanAmount,
    isEligible,
    eligibilityCheckedAt,
  } as unknown as Prisma.DirectorMultiplierUpdateInput;
}
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from './multiplier-event.enum';
import {
  MULTIPLIER_STEPS,
  isValidStepDirection,
} from './multiplier-steps.constants';
import { redactFineractError } from '../fineract/fineract-error.util';
import {
  DEFAULT_MULTIPLIER,
  MAX_LOAN_AMOUNT,
} from './multiplier.constants';
import { ProcessEventDto } from './dto/process-event.dto';

export interface DirectorProfileResponse {
  clientId: number;
  multiplier: number;
  loanMultiple: number;
  consecutiveOnTimeContributions: number;
  consecutiveOnTimeRepayments: number;
  lastContributionStatus: string | null;
  lastRepaymentStatus: string | null;
  contributionBalance: number | null;
  maxLoanAmount: number | null;
  isEligible: boolean;
  eligibilityCheckedAt: Date | null;
  updatedAt: Date;
}

export interface ProcessEventResponse extends DirectorProfileResponse {
  eventType: MultiplierEventType;
  oldMultiplier: number;
  stepAmount: number;
  direction: 'UPGRADE' | 'DOWNGRADE' | 'NEUTRAL';
}

export interface EligibilityResponse {
  clientId: number;
  multiplier: number;
  loanMultiple: number;
  contributionBalance: number;
  maxLoanAmount: number;
  cappedAtMax: boolean;
  isEligible: boolean;
  eligibilityCheckedAt: Date;
  source: 'cache' | 'fineract' | 'override';
}

@Injectable()
export class MultiplierService {
  private readonly logger = new Logger(MultiplierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fineract: FineractService,
    private readonly config: ConfigService,
  ) {}

  clampMultiplier(value: number): number {
    return Math.min(1.5, Math.max(0.6, value));
  }

  calculateLoanMultiple(multiplier: number): number {
    const safeMultiplier = this.clampMultiplier(multiplier);
    const t = (safeMultiplier - 0.6) / 0.9;
    const result = 5 - 4 * Math.pow(t, 1 / 2.3);
    return Number(result.toFixed(3));
  }

  calculateMaxLoanAmount(
    contributionBalance: number,
    loanMultiple: number,
  ): { maxLoanAmount: number; cappedAtMax: boolean } {
    const raw = Math.floor(contributionBalance * loanMultiple);
    const cappedAtMax = raw > MAX_LOAN_AMOUNT;
    return {
      maxLoanAmount: Math.min(raw, MAX_LOAN_AMOUNT),
      cappedAtMax,
    };
  }

  private get minEligibleLoan(): number {
    return this.config.get<number>('eligibility.minLoanAmount') ?? 100_000;
  }

  private get cacheTtlMs(): number {
    const minutes =
      this.config.get<number>('eligibility.cacheTtlMinutes') ?? 60;
    return minutes * 60 * 1000;
  }

  /**
   * The step for an event, allowing the cooperative to retune magnitudes via
   * environment variables without a deploy.
   *
   * An override whose SIGN is wrong for the event is REJECTED and the default
   * used instead. Magnitudes are policy and theirs to set; directions are not
   * — a positive ON_TIME_CONTRIBUTION would silently make punctuality
   * expensive and lateness profitable, which is precisely the bug this system
   * shipped with until 2026-08-28.
   *
   * Rejection logs and falls back rather than throwing: the service runs under
   * `restart: unless-stopped`, so refusing to boot over a mistyped decimal
   * would crash-loop the whole API. Ignoring one bad value is the safer
   * failure, and it is loud in the log.
   */
  private stepFor(eventType: MultiplierEventType): number {
    const configured = this.config.get<number | undefined>(
      `multiplier.steps.${eventType}`,
    );

    if (configured === undefined) {
      return MULTIPLIER_STEPS[eventType];
    }

    if (!isValidStepDirection(eventType, configured)) {
      this.logger.error(
        `Ignoring configured step ${configured} for ${eventType}: wrong sign ` +
          'for this event (rewards must be negative, penalties positive). ' +
          `Using the default ${MULTIPLIER_STEPS[eventType]} instead.`,
      );
      return MULTIPLIER_STEPS[eventType];
    }

    return configured;
  }

  /**
   * A NEGATIVE step lowers the multiplier, which is the member's BETTER
   * state — cheaper loan, higher limit. So negative is an UPGRADE.
   *
   * This was inverted until 2026-08-28, alongside the step signs themselves
   * (see multiplier-steps.constants.ts). The label is what a member reads in
   * their history feed, so getting it backwards would have shown every
   * penalty as good news.
   */
  private resolveDirection(
    step: number,
  ): 'UPGRADE' | 'DOWNGRADE' | 'NEUTRAL' {
    if (step < 0) return 'UPGRADE';
    if (step > 0) return 'DOWNGRADE';
    return 'NEUTRAL';
  }

  private toDirectorProfile(
    director: {
      clientId: number;
      currentMultiplier: { toString(): string } | number;
      loanMultiple: { toString(): string } | number;
      consecutiveOnTimeContributions: number | null;
      consecutiveOnTimeRepayments: number | null;
      lastContributionStatus: string | null;
      lastRepaymentStatus: string | null;
      contributionBalance?: { toString(): string } | number | null;
      maxLoanAmount?: { toString(): string } | number | null;
      isEligible?: boolean | null;
      eligibilityCheckedAt?: Date | null;
      updatedAt: Date;
    },
  ): DirectorProfileResponse {
    return {
      clientId: director.clientId,
      multiplier: Number(director.currentMultiplier),
      loanMultiple: Number(director.loanMultiple),
      consecutiveOnTimeContributions:
        director.consecutiveOnTimeContributions ?? 0,
      consecutiveOnTimeRepayments:
        director.consecutiveOnTimeRepayments ?? 0,
      lastContributionStatus: director.lastContributionStatus,
      lastRepaymentStatus: director.lastRepaymentStatus,
      contributionBalance: director.contributionBalance
        ? Number(director.contributionBalance)
        : null,
      maxLoanAmount: director.maxLoanAmount
        ? Number(director.maxLoanAmount)
        : null,
      isEligible: director.isEligible ?? false,
      eligibilityCheckedAt: director.eligibilityCheckedAt ?? null,
      updatedAt: director.updatedAt,
    };
  }

  async ensureDirector(clientId: number): Promise<DirectorMultiplier> {
    const existing = await this.prisma.directorMultiplier.findUnique({
      where: { clientId },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.directorMultiplier.create({
        data: {
          clientId,
          currentMultiplier: DEFAULT_MULTIPLIER,
          loanMultiple: this.calculateLoanMultiple(DEFAULT_MULTIPLIER),
        },
      });
    } catch (error) {
      // Race: a first-ever dashboard load fires several endpoints in
      // parallel (mobile.service.ts's Promise.all), each independently
      // calling ensureDirector for the same brand-new clientId — the
      // find-then-create above isn't atomic, so two calls can both see
      // "not found" and both try to create. Found live 2026-08-21: the
      // loser hit this exact unique-constraint error instead of just
      // getting the winner's row. Whoever won, re-fetch and use that.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.directorMultiplier.findUnique({
          where: { clientId },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async getProfile(clientId: number): Promise<DirectorProfileResponse> {
    const director = await this.ensureDirector(clientId);
    return this.toDirectorProfile(director);
  }

  async getHistory(clientId: number, limit = 50) {
    await this.ensureDirector(clientId);
    const entries = await this.prisma.multiplierHistory.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return entries.map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      eventType: entry.eventType,
      oldMultiplier: entry.oldMultiplier
        ? Number(entry.oldMultiplier)
        : null,
      newMultiplier: entry.newMultiplier
        ? Number(entry.newMultiplier)
        : null,
      stepAmount: entry.stepAmount ? Number(entry.stepAmount) : null,
      direction: entry.direction,
      triggeredBy: entry.triggeredBy,
      notes: entry.notes,
      createdAt: entry.createdAt,
    }));
  }

  private isCacheFresh(checkedAt: Date | null | undefined): boolean {
    if (!checkedAt) return false;
    return Date.now() - checkedAt.getTime() < this.cacheTtlMs;
  }

  async refreshEligibility(clientId: number): Promise<EligibilityResponse> {
    const director = await this.ensureDirector(clientId);
    const multiplier = Number(director.currentMultiplier);
    const loanMultiple = Number(director.loanMultiple);

    const balance = await this.fineract.getContributionBalance(clientId);
    if (balance === null) {
      throw new BadRequestException(
        'Cannot refresh eligibility: Fineract balance unavailable. Set FINERACT_* env vars or pass contributionBalance.',
      );
    }

    const { maxLoanAmount, cappedAtMax } = this.calculateMaxLoanAmount(
      balance,
      loanMultiple,
    );
    const isEligible = maxLoanAmount >= this.minEligibleLoan;
    const checkedAt = new Date();

    await this.prisma.directorMultiplier.update({
      where: { clientId },
      data: buildEligibilityUpdateData(
        balance,
        maxLoanAmount,
        isEligible,
        checkedAt,
      ),
    });

    return {
      clientId,
      multiplier,
      loanMultiple,
      contributionBalance: balance,
      maxLoanAmount,
      cappedAtMax,
      isEligible,
      eligibilityCheckedAt: checkedAt,
      source: 'fineract',
    };
  }

  async refreshAllEligibility(): Promise<{
    refreshed: number;
    failed: number;
    skipped: number;
  }> {
    const directors = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true },
    });

    let refreshed = 0;
    let failed = 0;
    let skipped = 0;

    if (!this.fineract.isConfigured()) {
      this.logger.warn('Fineract not configured; batch eligibility skipped');
      return { refreshed: 0, failed: 0, skipped: directors.length };
    }

    for (const { clientId } of directors) {
      try {
        await this.refreshEligibility(clientId);
        refreshed++;
      } catch (error) {
        this.logger.warn(
          `Eligibility refresh failed for ${clientId}: ${redactFineractError(error)}`,
        );
        failed++;
      }
    }

    return { refreshed, failed, skipped };
  }

  private async getDirectorEligibilityRow(
    clientId: number,
  ): Promise<DirectorEligibilityRow> {
    await this.ensureDirector(clientId);
    const row: unknown = await this.prisma.directorMultiplier.findUniqueOrThrow({
      where: { clientId },
      select: eligibilitySelect as unknown as Prisma.DirectorMultiplierSelect,
    });
    return row as DirectorEligibilityRow;
  }

  async getEligibility(
    clientId: number,
    contributionBalanceOverride?: number,
    forceRefresh = false,
  ): Promise<EligibilityResponse> {
    const director = await this.getDirectorEligibilityRow(clientId);
    const multiplier = Number(director.currentMultiplier);
    const loanMultiple = Number(director.loanMultiple);

    if (
      !forceRefresh &&
      !contributionBalanceOverride &&
      director.contributionBalance != null &&
      director.maxLoanAmount != null &&
      director.eligibilityCheckedAt &&
      this.isCacheFresh(director.eligibilityCheckedAt)
    ) {
      const balance = Number(director.contributionBalance);
      const maxLoan = Number(director.maxLoanAmount);
      const { cappedAtMax } = this.calculateMaxLoanAmount(balance, loanMultiple);
      return {
        clientId,
        multiplier,
        loanMultiple,
        contributionBalance: balance,
        maxLoanAmount: maxLoan,
        cappedAtMax,
        isEligible: director.isEligible ?? false,
        eligibilityCheckedAt: director.eligibilityCheckedAt,
        source: 'cache',
      };
    }

    if (forceRefresh && !contributionBalanceOverride) {
      return this.refreshEligibility(clientId);
    }

    let contributionBalance: number | undefined =
      contributionBalanceOverride;
    let source: EligibilityResponse['source'] = 'override';

    if (contributionBalance === undefined) {
      const fromFineract =
        await this.fineract.getContributionBalance(clientId);
      if (fromFineract !== null) {
        contributionBalance = fromFineract;
        source = 'fineract';
      }
    }

    if (contributionBalance === undefined) {
      throw new BadRequestException(
        'contributionBalance unavailable. Pass ?contributionBalance=, ?refresh=true with Fineract configured, or wait for cached eligibility.',
      );
    }

    const { maxLoanAmount, cappedAtMax } = this.calculateMaxLoanAmount(
      contributionBalance,
      loanMultiple,
    );
    const isEligible = maxLoanAmount >= this.minEligibleLoan;
    const checkedAt = new Date();

    await this.prisma.directorMultiplier.update({
      where: { clientId },
      data: buildEligibilityUpdateData(
        contributionBalance,
        maxLoanAmount,
        isEligible,
        checkedAt,
      ),
    });

    return {
      clientId,
      multiplier,
      loanMultiple,
      contributionBalance,
      maxLoanAmount,
      cappedAtMax,
      isEligible,
      eligibilityCheckedAt: checkedAt,
      source,
    };
  }

  async processFromDto(dto: ProcessEventDto): Promise<ProcessEventResponse> {
    return this.processEvent(
      dto.clientId,
      dto.eventType,
      dto.triggeredBy,
      dto.notes,
    );
  }

  async processEvent(
    clientId: number,
    eventType: MultiplierEventType,
    triggeredBy?: string,
    notes?: string,
  ): Promise<ProcessEventResponse> {
    const director = await this.ensureDirector(clientId);
    const oldMultiplier = Number(director.currentMultiplier);
    const step = this.stepFor(eventType);
    const updatedMultiplier = this.clampMultiplier(oldMultiplier + step);
    const newLoanMultiple = this.calculateLoanMultiple(updatedMultiplier);
    const direction = this.resolveDirection(step);
    const statusUpdate = this.buildStatusUpdate(eventType);

    const updatedDirector = await this.prisma.directorMultiplier.update({
      where: { clientId },
      data: {
        currentMultiplier: updatedMultiplier,
        loanMultiple: newLoanMultiple,
        ...statusUpdate,
      },
    });

    await this.prisma.multiplierHistory.create({
      data: {
        clientId,
        eventType,
        oldMultiplier,
        newMultiplier: updatedMultiplier,
        stepAmount: step,
        direction,
        triggeredBy,
        notes,
      },
    });

    await this.maybeApplyStreakBonus(
      clientId,
      eventType,
      updatedDirector.consecutiveOnTimeContributions ?? 0,
    );

    if (this.fineract.isConfigured()) {
      try {
        await this.refreshEligibility(clientId);
      } catch (error) {
        this.logger.warn(
          `Post-event eligibility refresh skipped for ${clientId}`,
          error,
        );
      }
    }

    const profile = this.toDirectorProfile(
      await this.prisma.directorMultiplier.findUniqueOrThrow({
        where: { clientId },
      }),
    );

    return {
      ...profile,
      eventType,
      oldMultiplier,
      stepAmount: step,
      direction,
    };
  }

  private async maybeApplyStreakBonus(
    clientId: number,
    eventType: MultiplierEventType,
    streak: number,
  ) {
    const milestone = this.config.get<number>('multiplier.streakMilestone') ?? 3;

    if (
      eventType !== MultiplierEventType.ON_TIME_CONTRIBUTION ||
      milestone < 1 ||
      streak < milestone ||
      streak % milestone !== 0
    ) {
      return;
    }

    await this.processEvent(
      clientId,
      MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
      'streak-engine',
      `Auto streak bonus at ${streak} consecutive on-time contributions`,
    );
  }

  private buildStatusUpdate(eventType: MultiplierEventType) {
    switch (eventType) {
      case MultiplierEventType.ON_TIME_CONTRIBUTION:
        return {
          lastContributionStatus: 'ON_TIME',
          consecutiveOnTimeContributions: { increment: 1 },
        };
      case MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS:
        return { lastContributionStatus: 'ON_TIME' };
      case MultiplierEventType.LATE_CONTRIBUTION:
        return {
          lastContributionStatus: 'LATE',
          consecutiveOnTimeContributions: { set: 0 },
        };
      case MultiplierEventType.ON_TIME_REPAYMENT:
        return {
          lastRepaymentStatus: 'ON_TIME',
          consecutiveOnTimeRepayments: { increment: 1 },
        };
      case MultiplierEventType.LATE_REPAYMENT:
        return {
          lastRepaymentStatus: 'LATE',
          consecutiveOnTimeRepayments: { set: 0 },
        };
      case MultiplierEventType.EARLY_FULL_PAYOFF:
        return { lastRepaymentStatus: 'EARLY_PAYOFF' };
      default:
        return {};
    }
  }
}
