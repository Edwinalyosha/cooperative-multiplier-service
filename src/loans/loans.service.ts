import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoanApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { AddGuarantorDto } from './dto/add-guarantor.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { selectLoanTier } from './loan-tiers.constants';

export interface GuarantorRecord {
  id: number;
  loanId: number;
  guarantorClientId: number;
  relationship: string | null;
  notes: string | null;
  createdAt: Date;
}

@Injectable()
export class LoansService {
  private readonly guarantors = new Map<number, GuarantorRecord[]>();
  private nextId = 1;

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
    private readonly fineract: FineractService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Phase 2 — POST /loans/apply. Snapshots eligibility, auto-selects the
   * Fineract loan tier from requestedAmount, computes the effective rate
   * (tier base rate x director's currentMultiplier, locked at origination
   * per context/loan-approval-workflow-spec.md), creates the Fineract
   * loan shell ("submitted and pending approval" - no funds move), and
   * creates the LoanApplication record awaiting director approval.
   */
  async applyForLoan(clientId: number, dto: ApplyLoanDto) {
    const eligibility = await this.multiplierService.getEligibility(clientId);

    if (!eligibility.isEligible) {
      throw new BadRequestException(
        `Client ${clientId} is not currently eligible for a loan.`,
      );
    }

    if (dto.requestedAmount > eligibility.maxLoanAmount) {
      throw new BadRequestException(
        `Requested amount ${dto.requestedAmount} exceeds current eligibility of ${eligibility.maxLoanAmount}.`,
      );
    }

    const tier = selectLoanTier(dto.requestedAmount);
    if (!tier) {
      throw new BadRequestException(
        `Requested amount ${dto.requestedAmount} does not fall within any loan tier's range.`,
      );
    }

    const product = await this.fineract.getLoanProduct(tier.fineractProductId);
    const effectiveRate = Number(
      (product.interestRatePerPeriod * eligibility.multiplier).toFixed(6),
    );

    const today = new Date();
    const submittedOnDate = FineractService.formatFineractDate(today);
    const expectedDisbursementDate = submittedOnDate;

    const { loanId } = await this.fineract.createLoanApplication({
      clientId,
      productId: tier.fineractProductId,
      principal: dto.requestedAmount,
      interestRatePerPeriod: effectiveRate,
      numberOfRepayments: product.numberOfRepayments,
      repaymentEvery: product.repaymentEvery,
      repaymentFrequencyType: product.repaymentFrequencyType.id,
      loanTermFrequency: product.numberOfRepayments * product.repaymentEvery,
      loanTermFrequencyType: product.repaymentFrequencyType.id,
      interestType: product.interestType.id,
      interestCalculationPeriodType: product.interestCalculationPeriodType.id,
      amortizationType: product.amortizationType.id,
      transactionProcessingStrategyCode:
        product.transactionProcessingStrategyCode,
      submittedOnDate,
      expectedDisbursementDate,
    });

    const application = await this.prisma.loanApplication.create({
      data: {
        clientId,
        requestedAmount: dto.requestedAmount,
        eligibilityAtRequestTime: eligibility.maxLoanAmount,
        status: LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
        fineractLoanId: loanId,
      },
    });

    return {
      ...application,
      tier: tier.name,
      effectiveInterestRatePerPeriod: effectiveRate,
      baseInterestRatePerPeriod: product.interestRatePerPeriod,
      appliedMultiplier: eligibility.multiplier,
    };
  }

  async getLoanApplication(id: number) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
      include: { approvals: true },
    });
    if (!application) {
      throw new NotFoundException(`Loan application ${id} not found`);
    }
    return application;
  }

  async listLoanApplicationsForClient(clientId: number) {
    return this.prisma.loanApplication.findMany({
      where: { clientId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  listGuarantors(loanId: number): GuarantorRecord[] {
    return [...(this.guarantors.get(loanId) ?? [])];
  }

  addGuarantor(loanId: number, dto: AddGuarantorDto): GuarantorRecord {
    const record: GuarantorRecord = {
      id: this.nextId++,
      loanId,
      guarantorClientId: dto.guarantorClientId,
      relationship: dto.relationship ?? null,
      notes: dto.notes ?? null,
      createdAt: new Date(),
    };

    const existing = this.guarantors.get(loanId) ?? [];
    existing.push(record);
    this.guarantors.set(loanId, existing);
    return record;
  }

  removeGuarantor(loanId: number, guarantorId: number): void {
    const list = this.guarantors.get(loanId);
    if (!list) {
      throw new NotFoundException(`Loan ${loanId} has no guarantors`);
    }

    const index = list.findIndex((g) => g.id === guarantorId);
    if (index === -1) {
      throw new NotFoundException(
        `Guarantor ${guarantorId} not found on loan ${loanId}`,
      );
    }

    list.splice(index, 1);
    this.guarantors.set(loanId, list);
  }

  async recordRepayment(dto: RecordRepaymentDto, async = false) {
    let eventType: MultiplierEventType;
    if (dto.earlyPayoff) {
      eventType = MultiplierEventType.EARLY_FULL_PAYOFF;
    } else if (dto.onTime) {
      eventType = MultiplierEventType.ON_TIME_REPAYMENT;
    } else {
      eventType = MultiplierEventType.LATE_REPAYMENT;
    }

    const notes =
      dto.notes ??
      (dto.earlyPayoff
        ? 'Early full payoff'
        : dto.onTime
          ? 'Repayment on time'
          : 'Repayment late');

    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        dto.triggeredBy ?? 'loans-api',
        notes,
      );
    }

    const result = await this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      dto.triggeredBy ?? 'loans-api',
      notes,
    );

    const activeLoans = await this.fineract.getActiveLoanIds(dto.clientId);

    return {
      ...result,
      activeLoanAccountIds: activeLoans,
    };
  }

  async getRepaymentSummary(clientId: number) {
    const profile = await this.multiplierService.getProfile(clientId);
    const activeLoans = await this.fineract.getActiveLoanIds(clientId);

    return {
      clientId,
      multiplier: profile.multiplier,
      consecutiveOnTimeRepayments: profile.consecutiveOnTimeRepayments,
      lastRepaymentStatus: profile.lastRepaymentStatus,
      activeLoanAccountIds: activeLoans,
      cachedMaxLoanAmount: profile.maxLoanAmount,
      isEligible: profile.isEligible,
    };
  }
}
