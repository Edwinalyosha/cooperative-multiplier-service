import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDecision, LoanApplicationStatus, UserRole } from '@prisma/client';
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
import {
  describeFineractError,
  redactFineractError,
} from '../fineract/fineract-error.util';

/**
 * Distinct director APPROVE votes needed to advance an application to finance.
 * "First 2 approvals win" — rejections are logged but never block or count.
 * See context/loan-approval-workflow-spec.md.
 */
const DIRECTOR_QUORUM = 2;

/**
 * Application states meaning "this member already has a request in play".
 * The cooperative's rule is one at a time: an application must be decided
 * before the next is made, or a member can queue several and drain their
 * whole limit the moment they are approved.
 *
 * APPROVED is deliberately NOT listed. Once disbursed, the block comes from
 * Fineract's active-loan list instead — that clears itself when the loan is
 * repaid, whereas this row stays APPROVED forever and would bar the member
 * permanently.
 */
const OPEN_APPLICATION_STATUSES = [
  LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
  LoanApplicationStatus.PENDING_FINANCE_APPROVAL,
  LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
];

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
   * One loan at a time.
   *
   * Eligibility is `contributionBalance x loanMultiple` and subtracts nothing
   * for money already borrowed, so without this a member could apply
   * repeatedly and hold several full-limit loans at once against the same
   * savings. Observed live on 2026-08-29: client 2 held a disbursed 80,000
   * loan and an open 90,000 application simultaneously, on a 50,000 balance,
   * and was still offered another 109,450.
   *
   * Two separate blocks, because they answer different questions:
   *  - an OPEN APPLICATION means a decision is still pending here;
   *  - an ACTIVE LOAN means money is outstanding in Fineract.
   *
   * Fineract is authoritative for the second. If it cannot be reached this
   * throws rather than assuming no debt — refusing to lend on missing
   * information is the safe direction, the same rule the contribution sweep
   * follows when it declines to mark a member late it could not read.
   */
  private async assertNoOpenApplication(clientId: number): Promise<void> {
    const openApplication = await this.prisma.loanApplication.findFirst({
      where: { clientId, status: { in: OPEN_APPLICATION_STATUSES } },
      orderBy: { id: 'desc' },
    });

    if (openApplication) {
      throw new ConflictException(
        `You already have loan application #${openApplication.id} awaiting a ` +
          `decision (status: ${openApplication.status}). It must be decided ` +
          'before you can apply again.',
      );
    }
  }

  /**
   * How much a member may still borrow: their limit less what they already
   * owe.
   *
   * An outstanding loan does NOT bar borrowing — it consumes headroom. A
   * member with a 109,450 limit and 90,381 outstanding may still borrow
   * 19,069, and repaying restores the room. This is the difference between a
   * credit limit and a lockout, and it is the cooperative's intent.
   *
   * Throws rather than assuming zero debt when Fineract cannot be read:
   * treating an outage as "owes nothing" would hand out a member's full limit
   * on top of a loan they already have.
   */
  private async getAvailableHeadroom(
    clientId: number,
    maxLoanAmount: number,
  ): Promise<{ outstanding: number; available: number }> {
    let outstanding: number;
    try {
      outstanding = await this.fineract.getOutstandingLoanBalance(clientId);
    } catch (error) {
      this.logger.error(
        `Could not read outstanding loans for client ${clientId}; refusing ` +
          'the application rather than assuming no debt: ' +
          redactFineractError(error),
      );
      throw new BadRequestException(
        'Could not confirm your outstanding balance. Please try again shortly.',
      );
    }

    return {
      outstanding,
      available: Math.max(0, maxLoanAmount - outstanding),
    };
  }

  /**
   * Phase 2 — POST /loans/apply. Snapshots eligibility, auto-selects the
   * Fineract loan tier from requestedAmount, computes the effective rate
   * (tier base rate x director's currentMultiplier, locked at origination
   * per context/loan-approval-workflow-spec.md), creates the Fineract
   * loan shell ("submitted and pending approval" - no funds move), and
   * creates the LoanApplication record awaiting director approval.
   */
  async applyForLoan(clientId: number, dto: ApplyLoanDto) {
    await this.assertNoOpenApplication(clientId);

    const eligibility = await this.multiplierService.getEligibility(clientId);

    if (!eligibility.isEligible) {
      throw new BadRequestException(
        `Client ${clientId} is not currently eligible for a loan.`,
      );
    }

    const { outstanding, available } = await this.getAvailableHeadroom(
      clientId,
      eligibility.maxLoanAmount,
    );

    if (dto.requestedAmount > available) {
      throw new BadRequestException(
        outstanding > 0
          ? `Requested amount ${dto.requestedAmount} exceeds your available ` +
            `limit of ${available} (limit ${eligibility.maxLoanAmount} less ` +
            `${outstanding} still owed on an existing loan).`
          : `Requested amount ${dto.requestedAmount} exceeds current ` +
            `eligibility of ${eligibility.maxLoanAmount}.`,
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

  /**
   * Ownership-checked read for GET /loans/applications/:id (P1-2). The bare
   * getLoanApplication above stays unchecked because directorDecision,
   * financeDecision, and withdrawApplication all call it internally after
   * doing their own, stricter checks.
   *
   * Until 2026-08-24 this endpoint carried MobileJwtGuard alone, so any
   * authenticated member could enumerate ids and read every other member's
   * requested amount, notes, and financeNotes.
   *
   * Who may read one:
   *   FINANCE_MANAGER  — anything; they make the final decision.
   *   the applicant    — their own request.
   *   a DIRECTOR       — while it is awaiting director approval (they may
   *                      need to vote, and cannot vote on an amount they
   *                      cannot see), or afterwards if they voted on it.
   *
   * A director who never voted cannot read a decided application. That keeps
   * one member's borrowing history from being browsable by another after the
   * governance need has passed.
   */
  async getLoanApplicationFor(
    applicationId: number,
    user: { role: UserRole; clientId: number | null },
  ) {
    const application = await this.getLoanApplication(applicationId);

    if (user.role === UserRole.FINANCE_MANAGER) {
      return application;
    }

    if (user.clientId !== null && application.clientId === user.clientId) {
      return application;
    }

    if (user.role === UserRole.DIRECTOR) {
      const awaitingDirectors =
        application.status === LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL;
      const alreadyVoted = application.approvals.some(
        (a) => a.directorClientId === user.clientId,
      );
      if (awaitingDirectors || alreadyVoted) {
        return application;
      }
    }

    // Deliberately the same shape of refusal whether or not the application
    // exists, so ids cannot be enumerated by comparing 403 against 404.
    throw new ForbiddenException(
      'You may not view this loan application',
    );
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
  /**
   * The first approver's savings must cover the full principal.
   *
   * Rolls back the caller's vote row on refusal, for the same reason the
   * addGuarantor failure path does: the row had to be written first to win
   * the guarantor race safely, and leaving it would record a vote against a
   * loan with no guarantor while the unique constraint blocked any retry.
   */
  private async assertGuarantorCanCover(
    directorClientId: number,
    principal: number,
    approvalRowId: number,
  ): Promise<void> {
    const rollback = () =>
      this.prisma.loanApproval.delete({ where: { id: approvalRowId } });

    let balance: number | null;
    try {
      balance = await this.fineract.getContributionBalance(directorClientId);
    } catch (error) {
      await rollback();
      throw new BadRequestException(
        `Could not read director ${directorClientId}'s savings to confirm ` +
          'guarantor capacity, so the guarantee was not recorded' +
          describeFineractError(error),
      );
    }

    if (balance == null || balance < principal) {
      await rollback();
      throw new BadRequestException(
        `Director ${directorClientId} cannot guarantee this loan: their ` +
          `savings (${balance ?? 0}) do not cover the principal ` +
          `(${principal}). A director with sufficient savings must approve ` +
          'first — they become the guarantor.',
      );
    }
  }

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

    // P2-3: claim this director's vote row FIRST, inside a transaction that
    // locks the application, and decide from the state observed under that
    // lock. The previous read-decide-write was racy: two different directors
    // voting at the same moment could both read zero prior approvals, both
    // call addGuarantor, and leave the loan with two guarantors in Fineract
    // and two rows flagged isGuarantor. Since the guarantor is the person
    // "responsible for ensuring the borrower repays", an ambiguous record
    // there is a governance problem, not just a data smell.
    //
    // The @@unique([loanApplicationId, directorClientId]) constraint already
    // stopped the SAME director double-voting (including a double-tap on a
    // slow connection); this closes the different-directors interleave.
    const { approvalRow, isFirstApproval } = await this.prisma.$transaction(
      async (tx) => {
        // SELECT ... FOR UPDATE: serialises concurrent voters on this row.
        await tx.$queryRaw`SELECT id FROM "LoanApplication" WHERE id = ${applicationId} FOR UPDATE`;

        const priorApprovals = await tx.loanApproval.count({
          where: {
            loanApplicationId: applicationId,
            decision: ApprovalDecision.APPROVE,
          },
        });

        const row = await tx.loanApproval.create({
          data: {
            loanApplicationId: applicationId,
            directorClientId,
            decision: ApprovalDecision.APPROVE,
            isGuarantor: priorApprovals === 0,
            notes: dto.notes,
          },
        });

        return { approvalRow: row, isFirstApproval: priorApprovals === 0 };
      },
    );

    let guarantorMessage: string | null = null;

    if (isFirstApproval && application.fineractLoanId) {
      // A guarantor is "responsible for ensuring the borrower repays", so
      // their own savings must cover the whole principal — otherwise the
      // guarantee is nominal and the fund carries the risk it was meant to
      // transfer. Checked here rather than at vote time because only the
      // FIRST approver takes the liability, and that is not known until the
      // locked transaction above has resolved it.
      await this.assertGuarantorCanCover(
        directorClientId,
        Number(application.requestedAmount),
        approvalRow.id,
      );

      try {
        await this.fineract.addGuarantor({
          loanId: application.fineractLoanId,
          guarantorClientId: directorClientId,
        });
      } catch (error) {
        // The vote row exists already (it had to, to win the guarantor race
        // safely). Roll it back so the director can retry: leaving it would
        // record them as having voted while Fineract holds no guarantor, and
        // the unique constraint would then reject their retry as a duplicate.
        await this.prisma.loanApproval.delete({ where: { id: approvalRow.id } });
        throw new BadRequestException(
          `Could not register director ${directorClientId} as guarantor in Fineract` +
            describeFineractError(error),
        );
      }
      guarantorMessage =
        'You are now the guarantor for this loan — you are responsible for ensuring the borrower repays it.';
    }

    // Count under the same rule the transaction used: this director's row is
    // already committed, so the quorum is complete when two APPROVE rows now
    // exist. Reading the count back (rather than reusing a pre-transaction
    // snapshot) keeps this correct when votes land concurrently.
    const approvalCount = await this.prisma.loanApproval.count({
      where: {
        loanApplicationId: applicationId,
        decision: ApprovalDecision.APPROVE,
      },
    });

    if (approvalCount >= DIRECTOR_QUORUM) {
      // updateMany with a status precondition, so two directors completing
      // the quorum at the same instant cannot both advance it — the second
      // update matches zero rows instead of overwriting a later state.
      await this.prisma.loanApplication.updateMany({
        where: {
          id: applicationId,
          status: LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
        },
        data: { status: LoanApplicationStatus.PENDING_FINANCE_APPROVAL },
      });
    }

    const updated = await this.getLoanApplication(applicationId);
    return { ...updated, guarantorMessage };
  }

  /**
   * Freezes the savings this loan actually leans on.
   *
   * Only the amount above what contributions alone could support is pledged,
   * so a member borrowing within their contributions-derived limit has
   * nothing frozen. No pledge needed, or no savings account, means no hold and
   * no error — savings are voluntary and most loans will not touch them.
   *
   * Records the transaction id, which is Fineract's only handle on the hold.
   * Written immediately after the call returns: losing it would leave a
   * member's money frozen with no route back except manual surgery.
   */
  private async placeSavingsHold(
    applicationId: number,
    clientId: number,
    params: { requestedAmount: number },
  ): Promise<void> {
    const eligibility = await this.multiplierService.getEligibility(clientId);

    const pledge = this.multiplierService.calculateSavingsPledge({
      requestedAmount: params.requestedAmount,
      contributionBalance: eligibility.contributionBalance,
      loanMultiple: eligibility.loanMultiple,
      savingsBalance: eligibility.savingsBalance,
    });

    if (pledge <= 0) return;

    const savingsAccountId = await this.fineract.getSavingsAccountId(clientId);
    if (savingsAccountId == null) {
      // The limit that justified this amount counted savings, so a member
      // with no savings account here means the two reads disagree. Refuse
      // rather than lend the unsecured difference.
      throw new Error(
        `Client ${clientId} needs to pledge ${pledge} of savings but has no ` +
          'savings account.',
      );
    }

    const holdTransactionId = await this.fineract.holdSavingsAmount({
      savingsAccountId,
      amount: pledge,
    });

    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: {
        savingsHoldAccountId: savingsAccountId,
        savingsHoldTransactionId: holdTransactionId,
        savingsHeldAmount: pledge,
      },
    });

    this.logger.log(
      `Application ${applicationId}: froze ${pledge} of client ${clientId}'s ` +
        `savings as collateral (hold transaction ${holdTransactionId}).`,
    );
  }

  /**
   * Releases a collateral hold once its loan is no longer outstanding.
   *
   * Separate from the disbursement path because a loan ends long after, and
   * by an event this service never sees — a repayment made at a branch, say.
   * The release sweep calls this; nothing else should.
   */
  async releaseSavingsHold(applicationId: number): Promise<boolean> {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id: applicationId },
    });

    if (
      !application?.savingsHoldTransactionId ||
      !application.savingsHoldAccountId ||
      application.savingsHoldReleasedAt
    ) {
      return false;
    }

    await this.fineract.releaseSavingsAmount({
      savingsAccountId: application.savingsHoldAccountId,
      holdTransactionId: application.savingsHoldTransactionId,
    });

    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: { savingsHoldReleasedAt: new Date() },
    });

    this.logger.log(
      `Application ${applicationId}: released the ${String(
        application.savingsHeldAmount,
      )} savings hold — the loan is no longer outstanding.`,
    );
    return true;
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

    // APPROVED_PENDING_DISBURSEMENT is admitted so a half-completed approval
    // can be retried. Only the disbursement step will actually re-run — the
    // approve step is skipped via fineractApprovedAt below.
    const retryable =
      application.status === LoanApplicationStatus.PENDING_FINANCE_APPROVAL ||
      (application.status ===
        LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT &&
        dto.decision === ApprovalDecision.APPROVE);

    if (!retryable) {
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

    if (dto.decision === ApprovalDecision.APPROVE) {
      // Two separate Fineract calls, and the gap between them used to be
      // unrecoverable. If approve succeeded and disburse failed (network
      // blip, Fineract restart, date validation, insufficient funds in the
      // disbursement account), the catch below threw and the status update
      // never ran — leaving Fineract holding the loan APPROVED while this
      // row still said PENDING_FINANCE_APPROVAL. The finance manager would
      // retry, approve would fail because Fineract will not approve an
      // already-approved loan, and the application was stuck forever,
      // needing manual mifos-web surgery while a member waited for money.
      //
      // Each step is now recorded as it succeeds, so a retry resumes from
      // where it stopped rather than starting over.

      if (!application.fineractApprovedAt) {
        try {
          await this.fineract.approveLoan({
            loanId: application.fineractLoanId,
            approvedOnDate: today,
            expectedDisbursementDate: today,
          });
        } catch (error) {
          // Nothing moved: approve is the first call, so there is nothing to
          // unwind and the application stays where it was.
          throw new BadRequestException(
            `Fineract approve failed${describeFineractError(error)}`,
          );
        }

        // Persist BEFORE attempting disburse. If the process dies between
        // these two calls, the retry must still know approve is done.
        await this.prisma.loanApplication.update({
          where: { id: applicationId },
          data: { fineractApprovedAt: new Date() },
        });
      } else {
        this.logger.warn(
          `Application ${applicationId} was already approved in Fineract at ` +
            `${application.fineractApprovedAt.toISOString()} — resuming at disbursement.`,
        );
      }

      // Secure the collateral BEFORE the money moves. A savings-backed loan
      // whose backing was never frozen is exactly the hole the hold exists to
      // close, and once disbursed there is no way to insist after the fact.
      // Placed after approve so a failure here lands in the same recoverable
      // APPROVED_PENDING_DISBURSEMENT state as a failed disbursement.
      if (!application.savingsHoldTransactionId) {
        try {
          await this.placeSavingsHold(applicationId, application.clientId, {
            requestedAmount: Number(application.requestedAmount),
          });
        } catch (error) {
          await this.prisma.loanApplication.update({
            where: { id: applicationId },
            data: {
              status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
              financeDecidedBy: financeUserId,
              financeDecidedAt: new Date(),
              financeNotes: dto.notes,
            },
          });
          this.logger.error(
            `Application ${applicationId}: could not freeze the pledged ` +
              'savings, so nothing was disbursed. Marked ' +
              'APPROVED_PENDING_DISBURSEMENT; a retry will try the hold ' +
              `again. No money moved. ${redactFineractError(error)}`,
          );
          throw new BadRequestException(
            'Could not secure the savings pledged against this loan, so it ' +
              'was not disbursed. The approval is recorded; retry to ' +
              'complete it.',
          );
        }
      }

      try {
        await this.fineract.disburseLoan({
          loanId: application.fineractLoanId,
          actualDisbursementDate: today,
        });
      } catch (error) {
        // Approve landed, disburse did not. Record that plainly instead of
        // leaving the row claiming the application is still awaiting finance:
        // the money has not moved, and a retry can safely resume.
        await this.prisma.loanApplication.update({
          where: { id: applicationId },
          data: {
            status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
            financeDecidedBy: financeUserId,
            financeDecidedAt: new Date(),
            financeNotes: dto.notes,
          },
        });
        this.logger.error(
          `Application ${applicationId}: Fineract approved but disbursement ` +
            'failed. Marked APPROVED_PENDING_DISBURSEMENT; retrying the ' +
            'finance decision will resume at disbursement. No money moved.',
        );
        throw new BadRequestException(
          `Fineract disbursement failed${describeFineractError(error)} ` +
            'The approval is recorded; retry to complete disbursement.',
        );
      }
    } else {
      try {
        await this.fineract.rejectLoan({
          loanId: application.fineractLoanId,
          rejectedOnDate: today,
        });
      } catch (error) {
        throw new BadRequestException(
          `Fineract reject failed${describeFineractError(error)}`,
        );
      }
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
  async expireStaleApplications(): Promise<{
    expired: number;
    failed: number;
    skipped: number;
  }> {
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

    let skipped = 0;

    for (const application of stale) {
      try {
        // P2-4: the list above was read before this loop began, and rejecting
        // in Fineract takes a network round trip each. An application selected
        // at 48h00m can be approved by finance at 48h01m — and rejecting a
        // loan Fineract has already disbursed is not a state anyone wants to
        // untangle. Re-read immediately before acting, and claim the row with
        // a status precondition so the two paths cannot interleave.
        const claimed = await this.prisma.loanApplication.updateMany({
          where: {
            id: application.id,
            status: {
              in: [
                LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
                LoanApplicationStatus.PENDING_FINANCE_APPROVAL,
              ],
            },
          },
          data: { status: LoanApplicationStatus.EXPIRED },
        });

        if (claimed.count === 0) {
          // Somebody decided it between the query and now. Leave it alone.
          this.logger.log(
            `Skipping expiry of application ${application.id}: it was ` +
              'decided after the sweep selected it.',
          );
          skipped++;
          continue;
        }

        if (application.fineractLoanId) {
          await this.fineract.rejectLoan({
            loanId: application.fineractLoanId,
            rejectedOnDate: FineractService.formatFineractDate(new Date()),
          });
        }
        expired++;
      } catch (error) {
        // The row was already claimed as EXPIRED above, but Fineract refused
        // its side. Put the status back so the next hourly sweep retries,
        // rather than leaving this row EXPIRED here and still pending in
        // Fineract with nothing ever selecting it again.
        await this.prisma.loanApplication
          .updateMany({
            where: { id: application.id, status: LoanApplicationStatus.EXPIRED },
            data: { status: application.status },
          })
          .catch((revertError) =>
            this.logger.error(
              `Could not revert application ${application.id} after a failed ` +
                'expiry — it is EXPIRED locally but may still be pending in ' +
                'Fineract. Needs manual reconciliation.',
              revertError,
            ),
          );

        this.logger.warn(
          `Failed to expire loan application ${application.id}: ` +
            redactFineractError(error),
        );
        failed++;
      }
    }

    return { expired, failed, skipped };
  }

  /**
   * Returns applications currently awaiting the calling user's decision,
   * scoped by role:
   *   DIRECTOR       → PENDING_DIRECTOR_APPROVAL, excluding their own
   *                    application and any they have already voted on.
   *   FINANCE_MANAGER → PENDING_FINANCE_APPROVAL (all of them — finance
   *                    manager has no prior-vote concept to exclude).
   * Ordered oldest-first so the most urgent application appears at the top.
   */
  /**
   * Loans Fineract approved but which never disbursed.
   *
   * Deliberately a separate list from listPendingMyDecision. That one answers
   * "what needs a decision"; these have already been decided — the finance
   * manager approved them and the disbursement call failed afterwards. No
   * money has moved and the member is waiting, which makes them the most
   * urgent thing in the system and the least visible: they sit in no queue,
   * and only the Phase 4 status field records that anything is wrong.
   *
   * Oldest first — the wait is the whole problem.
   */
  async listStuckDisbursements() {
    return this.prisma.loanApplication.findMany({
      where: {
        status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
      },
      include: { approvals: true },
      orderBy: { financeDecidedAt: 'asc' },
    });
  }

  async listPendingMyDecision(
    role: string,
    clientId: number | null,
  ) {
    if (role === 'DIRECTOR') {
      if (!clientId) return [];
      return this.prisma.loanApplication.findMany({
        where: {
          status: LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
          clientId: { not: clientId },
          approvals: { none: { directorClientId: clientId } },
        },
        include: { approvals: true },
        orderBy: { requestedAt: 'asc' },
      });
    }

    if (role === 'FINANCE_MANAGER') {
      return this.prisma.loanApplication.findMany({
        where: { status: LoanApplicationStatus.PENDING_FINANCE_APPROVAL },
        include: { approvals: true },
        orderBy: { requestedAt: 'asc' },
      });
    }

    return [];
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
