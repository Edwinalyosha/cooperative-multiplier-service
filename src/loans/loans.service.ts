import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDecision, LoanApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { DirectorDecisionDto } from './dto/director-decision.dto';
import { FinanceDecisionDto } from './dto/finance-decision.dto';
import { selectLoanTier } from './loan-tiers.constants';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

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

  /**
   * Phase 3 — director quorum vote on a pending application. The
   * applicant cannot vote on their own request; rejections are logged but
   * never block or count toward the 2-approval threshold ("first 2
   * approvals win"); the FIRST approval registers that director as the
   * loan's guarantor in Fineract (accountability record, no fund hold —
   * decided 2026-08-10); the SECOND approval advances the application to
   * PENDING_FINANCE_APPROVAL. See context/loan-approval-workflow-spec.md.
   */
  async directorDecision(
    applicationId: number,
    directorClientId: number,
    dto: DirectorDecisionDto,
  ) {
    const application = await this.getLoanApplication(applicationId);

    if (application.clientId === directorClientId) {
      throw new BadRequestException(
        'A director cannot approve or reject their own loan application.',
      );
    }

    if (application.status !== LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL) {
      throw new BadRequestException(
        `Application ${applicationId} is not awaiting director approval (status: ${application.status}).`,
      );
    }

    const existingVote = application.approvals.find(
      (a) => a.directorClientId === directorClientId,
    );
    if (existingVote) {
      throw new ConflictException(
        `Director ${directorClientId} has already voted on application ${applicationId}.`,
      );
    }

    if (dto.decision === ApprovalDecision.REJECT) {
      await this.prisma.loanApproval.create({
        data: {
          loanApplicationId: applicationId,
          directorClientId,
          decision: ApprovalDecision.REJECT,
          notes: dto.notes,
        },
      });
      return this.getLoanApplication(applicationId);
    }

    const priorApprovals = application.approvals.filter(
      (a) => a.decision === ApprovalDecision.APPROVE,
    );
    const isFirstApproval = priorApprovals.length === 0;
    let guarantorMessage: string | null = null;

    if (isFirstApproval && application.fineractLoanId) {
      try {
        await this.fineract.addGuarantor({
          loanId: application.fineractLoanId,
          guarantorClientId: directorClientId,
        });
      } catch (error) {
        const fineractMessage =
          (error as { response?: { data?: { errors?: { defaultUserMessage?: string }[] } } })
            ?.response?.data?.errors?.[0]?.defaultUserMessage;
        throw new BadRequestException(
          `Could not register director ${directorClientId} as guarantor in Fineract` +
            (fineractMessage ? `: ${fineractMessage}` : '.'),
        );
      }
      guarantorMessage =
        'You are now the guarantor for this loan — you are responsible for ensuring the borrower repays it.';
    }

    await this.prisma.loanApproval.create({
      data: {
        loanApplicationId: applicationId,
        directorClientId,
        decision: ApprovalDecision.APPROVE,
        isGuarantor: isFirstApproval,
        notes: dto.notes,
      },
    });

    const willCompleteQuorum = priorApprovals.length === 1;
    if (willCompleteQuorum) {
      await this.prisma.loanApplication.update({
        where: { id: applicationId },
        data: { status: LoanApplicationStatus.PENDING_FINANCE_APPROVAL },
      });
    }

    const updated = await this.getLoanApplication(applicationId);
    return { ...updated, guarantorMessage };
  }

  /**
   * Phase 4 — finance manager's final, unilateral decision. Only reachable
   * once the director quorum has already advanced the application to
   * PENDING_FINANCE_APPROVAL (finance never intervenes earlier). Approve
   * triggers real Fineract approve + disburse (money actually moves);
   * reject triggers Fineract's native reject transition — no fund hold to
   * release, since the guarantor design carries no fund hold at all. See
   * context/loan-approval-workflow-spec.md.
   */
  async financeDecision(
    applicationId: number,
    financeUserId: number,
    dto: FinanceDecisionDto,
  ) {
    const application = await this.getLoanApplication(applicationId);

    if (application.status !== LoanApplicationStatus.PENDING_FINANCE_APPROVAL) {
      throw new BadRequestException(
        `Application ${applicationId} is not awaiting finance approval (status: ${application.status}).`,
      );
    }

    if (!application.fineractLoanId) {
      throw new BadRequestException(
        `Application ${applicationId} has no linked Fineract loan.`,
      );
    }

    const today = FineractService.formatFineractDate(new Date());

    try {
      if (dto.decision === ApprovalDecision.APPROVE) {
        await this.fineract.approveLoan({
          loanId: application.fineractLoanId,
          approvedOnDate: today,
          expectedDisbursementDate: today,
        });
        await this.fineract.disburseLoan({
          loanId: application.fineractLoanId,
          actualDisbursementDate: today,
        });
      } else {
        await this.fineract.rejectLoan({
          loanId: application.fineractLoanId,
          rejectedOnDate: today,
        });
      }
    } catch (error) {
      const fineractMessage =
        (error as { response?: { data?: { errors?: { defaultUserMessage?: string }[] } } })
          ?.response?.data?.errors?.[0]?.defaultUserMessage;
      throw new BadRequestException(
        `Fineract ${dto.decision === ApprovalDecision.APPROVE ? 'approve/disburse' : 'reject'} failed` +
          (fineractMessage ? `: ${fineractMessage}` : '.'),
      );
    }

    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: {
        status:
          dto.decision === ApprovalDecision.APPROVE
            ? LoanApplicationStatus.APPROVED
            : LoanApplicationStatus.REJECTED,
        financeDecidedBy: financeUserId,
        financeDecidedAt: new Date(),
        financeNotes: dto.notes,
      },
    });

    return this.getLoanApplication(applicationId);
  }

  /**
   * Phase 5 — borrower withdraws their own pending application. Only the
   * applicant can do this (checked against the caller's clientId, not
   * trusted from any body param); only while still in one of the two
   * pending stages. No fund hold to release (see Phase 3 correction).
   */
  async withdrawApplication(applicationId: number, clientId: number) {
    const application = await this.getLoanApplication(applicationId);

    if (application.clientId !== clientId) {
      throw new BadRequestException(
        'Only the applicant can withdraw their own loan application.',
      );
    }

    if (
      application.status !== LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL &&
      application.status !== LoanApplicationStatus.PENDING_FINANCE_APPROVAL
    ) {
      throw new BadRequestException(
        `Application ${applicationId} can no longer be withdrawn (status: ${application.status}).`,
      );
    }

    if (application.fineractLoanId) {
      try {
        await this.fineract.withdrawLoan({
          loanId: application.fineractLoanId,
          withdrawnOnDate: FineractService.formatFineractDate(new Date()),
        });
      } catch (error) {
        const fineractMessage =
          (error as { response?: { data?: { errors?: { defaultUserMessage?: string }[] } } })
            ?.response?.data?.errors?.[0]?.defaultUserMessage;
        throw new BadRequestException(
          `Fineract withdrawal failed` + (fineractMessage ? `: ${fineractMessage}` : '.'),
        );
      }
    }

    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: { status: LoanApplicationStatus.WITHDRAWN },
    });

    return this.getLoanApplication(applicationId);
  }

  /**
   * Phase 5 — 48h auto-expiry sweep, called by loan-expiry.scheduler.ts
   * (hourly, per user decision 2026-08-11). Closes out via Fineract's
   * `reject` transition, not withdraw — "withdrawn" implies the client
   * acted, which isn't true here; the system closed it because nobody
   * decided in time. One continuous 48h window from requestedAt covering
   * both pending stages combined (not reset on advancing stages).
   */
  async expireStaleApplications(): Promise<{ expired: number; failed: number }> {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const stale = await this.prisma.loanApplication.findMany({
      where: {
        status: {
          in: [
            LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
            LoanApplicationStatus.PENDING_FINANCE_APPROVAL,
          ],
        },
        requestedAt: { lt: cutoff },
      },
    });

    let expired = 0;
    let failed = 0;

    for (const application of stale) {
      try {
        if (application.fineractLoanId) {
          await this.fineract.rejectLoan({
            loanId: application.fineractLoanId,
            rejectedOnDate: FineractService.formatFineractDate(new Date()),
          });
        }
        await this.prisma.loanApplication.update({
          where: { id: application.id },
          data: { status: LoanApplicationStatus.EXPIRED },
        });
        expired++;
      } catch (error) {
        this.logger.warn(
          `Failed to expire loan application ${application.id}`,
          error,
        );
        failed++;
      }
    }

    return { expired, failed };
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
