import { BadRequestException } from '@nestjs/common';
import { ApprovalDecision, LoanApplicationStatus } from '@prisma/client';
import { LoansService } from './loans.service';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * Covers the finance-decision money path (RESOLUTION-PLAN.md Phase 4 / P2-1).
 *
 * Approving a loan is TWO separate Fineract calls — approve, then disburse —
 * and the gap between them used to be unrecoverable. If approve succeeded and
 * disburse failed, Fineract held the loan APPROVED while our row still said
 * PENDING_FINANCE_APPROVAL. The finance manager would retry, approve would
 * fail because Fineract will not approve an already-approved loan, and the
 * application was stuck forever — needing manual mifos-web surgery while a
 * member waited for money.
 *
 * These tests exist because that failure needs no attacker: one network blip
 * during the single operation that moves real money is enough.
 */
describe('LoansService — finance decision (resumable disbursement)', () => {
  const APPLICATION_ID = 7;
  const FINERACT_LOAN_ID = 4242;
  const FINANCE_USER_ID = 1;

  let service: LoansService;
  let fineract: {
    approveLoan: jest.Mock;
    disburseLoan: jest.Mock;
    rejectLoan: jest.Mock;
  };
  let updates: { where: unknown; data: Record<string, unknown> }[];
  let application: Record<string, unknown>;

  /** Builds a service whose stored application is in the given state. */
  function buildService(overrides: Record<string, unknown> = {}) {
    application = {
      id: APPLICATION_ID,
      clientId: 2,
      status: LoanApplicationStatus.PENDING_FINANCE_APPROVAL,
      fineractLoanId: FINERACT_LOAN_ID,
      fineractApprovedAt: null,
      approvals: [],
      ...overrides,
    };

    updates = [];

    const prisma = {
      loanApplication: {
        findUnique: jest.fn().mockImplementation(() => application),
        update: jest.fn().mockImplementation((args) => {
          updates.push(args);
          Object.assign(application, args.data);
          return application;
        }),
      },
    } as unknown as PrismaService;

    fineract = {
      approveLoan: jest.fn().mockResolvedValue(undefined),
      disburseLoan: jest.fn().mockResolvedValue(undefined),
      rejectLoan: jest.fn().mockResolvedValue(undefined),
    };

    service = new LoansService(
      {} as MultiplierService,
      {} as MultiplierQueueService,
      fineract as unknown as FineractService,
      prisma,
    );
  }

  const approve = () =>
    service.financeDecision(APPLICATION_ID, FINANCE_USER_ID, {
      decision: ApprovalDecision.APPROVE,
    } as never);

  /** The status this call left behind, per the last update issued. */
  const finalStatus = () =>
    [...updates].reverse().find((u) => 'status' in u.data)?.data.status;

  describe('when both Fineract steps succeed', () => {
    beforeEach(() => buildService());

    it('approves, disburses, and lands on APPROVED', async () => {
      await approve();
      expect(fineract.approveLoan).toHaveBeenCalledTimes(1);
      expect(fineract.disburseLoan).toHaveBeenCalledTimes(1);
      expect(finalStatus()).toBe(LoanApplicationStatus.APPROVED);
    });
  });

  describe('when approve fails', () => {
    beforeEach(() => {
      buildService();
      fineract.approveLoan.mockRejectedValue(new Error('Fineract down'));
    });

    it('never attempts disbursement', async () => {
      await expect(approve()).rejects.toBeInstanceOf(BadRequestException);
      expect(fineract.disburseLoan).not.toHaveBeenCalled();
    });

    it('leaves the application awaiting finance, so it can be retried', async () => {
      await expect(approve()).rejects.toThrow();
      // Nothing moved on either side: no status change should be recorded.
      expect(finalStatus()).toBeUndefined();
    });
  });

  describe('when approve succeeds but disburse fails — the P2-1 case', () => {
    beforeEach(() => {
      buildService();
      fineract.disburseLoan.mockRejectedValue(new Error('insufficient funds'));
    });

    it('records the approval before attempting disbursement', async () => {
      await expect(approve()).rejects.toThrow();
      // Persisted BEFORE disburse is tried: if the process died between the
      // two calls, the retry must still know approve is done.
      expect(application.fineractApprovedAt).toBeInstanceOf(Date);
    });

    it('marks it APPROVED_PENDING_DISBURSEMENT rather than leaving it pending', async () => {
      await expect(approve()).rejects.toThrow();
      expect(finalStatus()).toBe(
        LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
      );
    });

    it('tells the caller the approval is recorded and to retry', async () => {
      await expect(approve()).rejects.toThrow(/retry to complete disbursement/i);
    });

    it('surfaces the reason Fineract gave', async () => {
      fineract.disburseLoan.mockRejectedValue({
        response: {
          data: { errors: [{ defaultUserMessage: 'Insufficient balance' }] },
        },
      });
      await expect(approve()).rejects.toThrow(/Insufficient balance/);
    });
  });

  describe('retrying a half-completed approval', () => {
    beforeEach(() => {
      buildService({
        status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
        fineractApprovedAt: new Date('2026-08-24T10:00:00Z'),
      });
    });

    it('skips approve — Fineract will not approve an approved loan twice', async () => {
      await approve();
      expect(fineract.approveLoan).not.toHaveBeenCalled();
    });

    it('resumes at disbursement and completes', async () => {
      await approve();
      expect(fineract.disburseLoan).toHaveBeenCalledTimes(1);
      expect(finalStatus()).toBe(LoanApplicationStatus.APPROVED);
    });

    it('can fail and be retried again without losing the approval', async () => {
      fineract.disburseLoan.mockRejectedValue(new Error('still down'));
      await expect(approve()).rejects.toThrow();
      expect(application.fineractApprovedAt).toBeInstanceOf(Date);
      expect(finalStatus()).toBe(
        LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
      );
    });
  });

  describe('guards on the stuck state', () => {
    it('refuses to REJECT an application already approved in Fineract', async () => {
      // The money side is already committed; reversing it is not a decision
      // this endpoint can safely make.
      buildService({
        status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
        fineractApprovedAt: new Date(),
      });
      await expect(
        service.financeDecision(APPLICATION_ID, FINANCE_USER_ID, {
          decision: ApprovalDecision.REJECT,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fineract.rejectLoan).not.toHaveBeenCalled();
    });

    it('refuses an application that has not cleared the director quorum', async () => {
      buildService({
        status: LoanApplicationStatus.PENDING_DIRECTOR_APPROVAL,
      });
      await expect(approve()).rejects.toBeInstanceOf(BadRequestException);
      expect(fineract.approveLoan).not.toHaveBeenCalled();
    });

    it('refuses an application with no linked Fineract loan', async () => {
      buildService({ fineractLoanId: null });
      await expect(approve()).rejects.toBeInstanceOf(BadRequestException);
      expect(fineract.approveLoan).not.toHaveBeenCalled();
    });
  });
});
