import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DirectorMultiplier, Prisma } from '@prisma/client';

/** Selected fields for eligibility cache reads (matches prisma/schema.prisma). */
const eligibilitySelect = {
  clientId: true,
  currentMultiplier: true,
  loanMultiple: true,
  contributionBalance: true,
  savingsBalance: true,
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
  savingsBalance: Prisma.Decimal | null;
  maxLoanAmount: Prisma.Decimal | null;
  isEligible: boolean | null;
  eligibilityCheckedAt: Date | null;
}

function buildEligibilityUpdateData(
  contributionBalance: number,
  maxLoanAmount: number,
  isEligible: boolean,
  eligibilityCheckedAt: Date,
  savingsBalance: number | null,
): Prisma.DirectorMultiplierUpdateInput {
  return {
    contributionBalance,
    maxLoanAmount,
    isEligible,
    eligibilityCheckedAt,
    // Left untouched when null, so a Fineract read that could not report
    // savings does not erase the last known figure.
    ...(savingsBalance == null ? {} : { savingsBalance }),
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
  /** Ordinary savings, counted at savingsFactor. 0 when the member has no
   * savings account or no savings product is configured. */
  savingsBalance: number;
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

  /**
   * `limit = contributions x loanMultiple + savings x savingsFactor`
   *
   * The two balances are rewarded differently on purpose. Contributions are
   * the ownership stake: committed capital, so they are leveraged 1-5x and
   * they alone move the multiplier. Savings are voluntary and withdrawable,
   * so they add capacity at face value and nothing more.
   *
   * A member with no savings account is not disadvantaged — contributions
   * alone carry the full multiple. Savings are a way to raise a limit
   * quickly, never a requirement for a good one.
   */
  calculateMaxLoanAmount(
    contributionBalance: number,
    loanMultiple: number,
    savingsBalance = 0,
  ): { maxLoanAmount: number; cappedAtMax: boolean } {
    const fromContributions = contributionBalance * loanMultiple;
    const fromSavings = savingsBalance * this.savingsFactor;
    const raw = Math.floor(fromContributions + fromSavings);
    const cappedAtMax = raw > MAX_LOAN_AMOUNT;
    return {
      maxLoanAmount: Math.min(raw, MAX_LOAN_AMOUNT),
      cappedAtMax,
    };
  }

  private get savingsFactor(): number {
    return this.config.get<number>('multiplier.savingsFactor') ?? 1.2;
  }

  /**
   * How much of a member's savings a given loan actually leans on, and so how
   * much must be frozen as collateral.
   *
   * Only the part of the request that exceeds what contributions alone can
   * support is pledged. A member borrowing well within their
   * contributions-derived limit has nothing frozen — freezing savings that
   * are not backing anything would be a penalty for having saved.
   *
   * Divided by savingsFactor because the factor is a bonus on the pledge, not
   * on the collateral: at 1.2, every 100 of frozen savings unlocks 120 of
   * borrowing, so covering a 120 shortfall requires pledging 100.
   *
   * Capped at the actual savings balance. Anything the cap leaves uncovered
   * is the deliberate unsecured margin the factor creates, and it sits behind
   * the guarantor's obligation to cover the whole principal.
   */
  calculateSavingsPledge(params: {
    requestedAmount: number;
    contributionBalance: number;
    loanMultiple: number;
    savingsBalance: number;
  }): number {
    const contributionsCapacity =
      params.contributionBalance * params.loanMultiple;
    const shortfall = params.requestedAmount - contributionsCapacity;
    if (shortfall <= 0) return 0;

    const factor = this.savingsFactor;
    const needed = factor > 0 ? shortfall / factor : shortfall;

    return Math.min(
      Math.ceil(Math.max(0, needed)),
      Math.floor(params.savingsBalance),
    );
  }

  /**
   * Reverses a penalty that was applied, because the cooperative has decided
   * to forgive it.
   *
   * Takes the exact amount that was charged — recorded on the ledger row at
   * the time — rather than recomputing it. Steps are configurable and shadow
   * mode applies 0, so today's value may not be what this member paid.
   *
   * Deliberately NOT a general "adjust a multiplier" API. The only caller is a
   * waiver, the amount comes from a stored fact, and a waived row is stamped
   * so it cannot be reversed twice. An endpoint that accepted a free step
   * would be the most powerful thing in the system: it sets everyone's
   * interest rate.
   *
   * Written to history as PENALTY_WAIVED — a raw string rather than a member
   * of MultiplierEventType, because that enum's contract is that every value
   * has a FIXED step in MULTIPLIER_STEPS, and this one is variable by nature.
   */
  async reversePenalty(
    clientId: number,
    chargedStep: number,
    notes: string,
    triggeredBy: string,
  ): Promise<void> {
    if (chargedStep <= 0) {
      // Nothing was charged — a shadow-mode penalty, or a row from before
      // steps were recorded. The waiver is still stamped by the caller; there
      // is simply no movement to undo.
      this.logger.log(
        `Waiver for client ${clientId} moved nothing: ${chargedStep} was ` +
          'applied originally.',
      );
      return;
    }

    const director = await this.ensureDirector(clientId);
    const oldMultiplier = Number(director.currentMultiplier);
    const updatedMultiplier = this.clampMultiplier(oldMultiplier - chargedStep);
    const newLoanMultiple = this.calculateLoanMultiple(updatedMultiplier);

    await this.prisma.directorMultiplier.update({
      where: { clientId },
      data: {
        currentMultiplier: updatedMultiplier,
        loanMultiple: newLoanMultiple,
      },
    });

    await this.prisma.multiplierHistory.create({
      data: {
        clientId,
        eventType: 'PENALTY_WAIVED',
        oldMultiplier,
        newMultiplier: updatedMultiplier,
        stepAmount: -chargedStep,
        direction: 'UPGRADE',
        triggeredBy,
        notes,
      },
    });

    this.logger.log(
      `Waived ${chargedStep} for client ${clientId}: ${oldMultiplier} -> ` +
        `${updatedMultiplier}. ${notes}`,
    );
  }

  /**
   * A member's ownership share of the cooperative: their contributions as a
   * percentage of everyone's.
   *
   * Contributions ONLY — savings are explicitly excluded. Savings are the
   * member's own money held with the cooperative and confer no ownership, so
   * counting them here would hand someone a larger slice of the profits for
   * money they can withdraw the same day.
   *
   * Computed live rather than stored: a stored percentage is wrong the moment
   * anyone else contributes, and every member's share changes every time any
   * one of them pays in.
   */
  async getOwnershipShare(clientId: number): Promise<{
    contributionBalance: number;
    totalContributions: number;
    sharePercentage: number;
    memberCount: number;
  }> {
    const rows = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true, contributionBalance: true },
    });

    const total = rows.reduce(
      (sum, row) => sum + Number(row.contributionBalance ?? 0),
      0,
    );
    const mine = Number(
      rows.find((row) => row.clientId === clientId)?.contributionBalance ?? 0,
    );

    return {
      contributionBalance: mine,
      totalContributions: total,
      // Before anyone has contributed the honest answer is 0, not a division
      // by zero and not an implied equal split.
      sharePercentage: total > 0 ? Number(((mine / total) * 100).toFixed(2)) : 0,
      memberCount: rows.length,
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
   * Is this a penalty we are recording but not yet charging?
   *
   * Shadow mode: before PENALTIES_ACTIVE_FROM, penalties are recorded in full
   * — the sweeps run, ledger rows are written, arrears accrue, the member
   * sees "counted late" — but the multiplier does not move. It gives members
   * a real trial against their own behaviour before anyone is charged.
   *
   * Rewards are never shadowed. There is no harm in a member benefiting
   * during the trial, and it makes the change feel like a gain rather than a
   * threat.
   *
   * An unparseable date is treated as "not in shadow" and logged. Failing
   * towards charging is the conservative reading of a config error here: the
   * alternative silently suspends every penalty indefinitely, which nobody
   * would notice.
   */
  private isShadowed(step: number): boolean {
    if (step <= 0) return false; // rewards and no-ops are never shadowed

    const activeFrom = this.config.get<string>('multiplier.penaltiesActiveFrom');
    if (!activeFrom) return false;

    const from = new Date(activeFrom);
    if (Number.isNaN(from.getTime())) {
      this.logger.error(
        `PENALTIES_ACTIVE_FROM is not a valid date ("${activeFrom}"); ` +
          'applying penalties normally.',
      );
      return false;
    }

    return Date.now() < from.getTime();
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

    const savings = await this.fineract.getSavingsBalance(clientId);

    const { maxLoanAmount, cappedAtMax } = this.calculateMaxLoanAmount(
      balance,
      loanMultiple,
      savings ?? 0,
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
        savings,
      ),
    });

    return {
      clientId,
      multiplier,
      loanMultiple,
      contributionBalance: balance,
      savingsBalance: savings ?? 0,
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
      const savings = Number(director.savingsBalance ?? 0);
      const maxLoan = Number(director.maxLoanAmount);
      const { cappedAtMax } = this.calculateMaxLoanAmount(
        balance,
        loanMultiple,
        savings,
      );
      return {
        clientId,
        multiplier,
        loanMultiple,
        contributionBalance: balance,
        savingsBalance: savings,
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

    const savings = await this.fineract.getSavingsBalance(clientId);

    const { maxLoanAmount, cappedAtMax } = this.calculateMaxLoanAmount(
      contributionBalance,
      loanMultiple,
      savings ?? 0,
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
        savings,
      ),
    });

    return {
      clientId,
      multiplier,
      loanMultiple,
      contributionBalance,
      savingsBalance: savings ?? 0,
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
    const configuredStep = this.stepFor(eventType);

    // Shadow mode: record the event in full but move nothing. The member sees
    // it in their history, the ledger still stamps the period as assessed —
    // so it is never charged later — and their multiplier is untouched.
    const shadowed = this.isShadowed(configuredStep);
    const step = shadowed ? 0 : configuredStep;

    const shadowNote = shadowed
      ? ` (trial period — recorded as ${configuredStep > 0 ? '+' : ''}` +
        `${configuredStep}, not applied)`
      : '';

    const updatedMultiplier = this.clampMultiplier(oldMultiplier + step);
    const newLoanMultiple = this.calculateLoanMultiple(updatedMultiplier);
    const direction = this.resolveDirection(step);
    // Streak state still advances under shadow: a member's run of on-time
    // contributions is a fact about their behaviour, not about whether the
    // penalty was charged.
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
        notes: notes ? `${notes}${shadowNote}` : shadowNote || undefined,
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
