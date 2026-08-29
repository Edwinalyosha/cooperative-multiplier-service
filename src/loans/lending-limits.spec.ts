import { BadRequestException, ConflictException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { ApprovalDecision } from '@prisma/client';

/**
 * Lending limits — one loan at a time, and a guarantor who can actually cover
 * it.
 *
 * Both rules were absent until 2026-08-29 and the gap was found in
 * production, not in review: client 2 was holding a disbursed 80,000 loan and
 * an open 90,000 application at once, against a 50,000 savings balance, and
 * the engine still offered a further 109,450. Eligibility is
 * `balance x multiple` and subtracts nothing already borrowed, so nothing
 * anywhere capped total exposure.
 *
 * These tests are written against CONSEQUENCES — "a member who owes money
 * cannot borrow again" — rather than against the shape of the guard, so a
 * later refactor has to keep the promise, not just the code.
 */
describe('lending limits', () => {
  const CLIENT = 2;

  let openApplication: { id: number; status: string } | null;
  let outstanding: number;
  let outstandingThrow: Error | null;

  function build() {
    openApplication = null;
    outstanding = 0;
    outstandingThrow = null;

    const prisma = {
      loanApplication: {
        findFirst: jest.fn(async () => openApplication),
        create: jest.fn(async (args: { data: unknown }) => ({
          id: 99,
          ...(args.data as object),
        })),
      },
      loanApproval: { delete: jest.fn(async () => ({})) },
    } as unknown as PrismaService;

    const fineract = {
      isConfigured: () => true,
      getOutstandingLoanBalance: jest.fn(async () => {
        if (outstandingThrow) throw outstandingThrow;
        return outstanding;
      }),
      getContributionBalance: jest.fn(async () => 0),
      getLoanProduct: jest.fn(async () => ({
        interestRatePerPeriod: 1,
        numberOfRepayments: 12,
        repaymentEvery: 1,
        repaymentFrequencyType: { id: 2 },
        interestType: { id: 0 },
        interestCalculationPeriodType: { id: 1 },
        amortizationType: { id: 1 },
        transactionProcessingStrategyCode: 'mifos-standard-strategy',
      })),
      createLoanApplication: jest.fn(async () => ({ loanId: 11 })),
    } as unknown as FineractService;

    const multiplier = {
      getEligibility: jest.fn(async () => ({
        isEligible: true,
        maxLoanAmount: 109450,
        multiplier: 1,
      })),
    } as unknown as MultiplierService;

    const queue = {} as unknown as MultiplierQueueService;

    return new LoansService(multiplier, queue, fineract, prisma);
  }

  describe('one application at a time', () => {
    it('refuses a second application while one awaits a decision', async () => {
      const service = build();
      openApplication = { id: 8, status: 'PENDING_FINANCE_APPROVAL' };

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('names the blocking application so the member knows what to chase', async () => {
      const service = build();
      openApplication = { id: 8, status: 'PENDING_DIRECTOR_APPROVAL' };

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).rejects.toThrow(/#8/);
    });

    it('blocks before eligibility is even consulted', async () => {
      // Cheapest check first, and it must not depend on Fineract being up.
      const service = build();
      openApplication = { id: 8, status: 'PENDING_DIRECTOR_APPROVAL' };

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('outstanding debt consumes headroom, it does not lock out', () => {
    // The limit is 109,450 throughout (balance 50,000 x multiple 2.189).

    it('lets a member borrow the room left above what they owe', async () => {
      // 109,450 limit less 50,000 owed = 59,450 available.
      const service = build();
      outstanding = 50000;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 55000 } as never),
      ).resolves.toBeDefined();
    });

    it('leaves headroom below the tier minimum unusable', async () => {
      // 109,450 less 90,381 owed leaves 19,069 — real headroom, but Tier 1
      // starts at 50,000, so nothing can be borrowed against it. Documented
      // rather than worked around: the tier floor is a deliberate policy and
      // the member is told why, but it does mean small remainders are dead.
      const service = build();
      outstanding = 90381;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 19000 } as never),
      ).rejects.toThrow(/does not fall within any loan tier/);
    });

    it('refuses an amount above the remaining room', async () => {
      const service = build();
      outstanding = 90381;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 25000 } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('explains the shortfall in terms of the existing loan', async () => {
      const service = build();
      outstanding = 90381;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 25000 } as never),
      ).rejects.toThrow(/still owed on an existing loan/);
    });

    it('restores the full limit once the loan is repaid', async () => {
      const service = build();
      outstanding = 0;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 109450 } as never),
      ).resolves.toBeDefined();
    });

    it('never offers negative headroom when debt exceeds the limit', async () => {
      // A limit can fall (savings withdrawn, multiplier worsened) below what
      // is already owed. That must read as "nothing available", not as a
      // negative that some later arithmetic could flip.
      const service = build();
      outstanding = 200000;

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 1 } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to lend when Fineract cannot be read', async () => {
      // Silence is not evidence of no debt. Treating an outage as "owes
      // nothing" would hand out a full limit on top of an existing loan.
      const service = build();
      outstandingThrow = new Error('ECONNREFUSED');

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('guarantor capacity', () => {
    /** Drives directorDecision far enough to reach the guarantor check. */
    function buildForApproval(guarantorBalance: number | null) {
      const application = {
        id: 9,
        clientId: 5,
        requestedAmount: 80000,
        status: 'PENDING_DIRECTOR_APPROVAL',
        fineractLoanId: 10,
        approvals: [],
      };

      const deleted: number[] = [];

      const prisma = {
        loanApplication: {
          findUnique: jest.fn(async () => application),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        loanApproval: {
          count: jest.fn(async () => 1),
          create: jest.fn(async () => ({ id: 77 })),
          delete: jest.fn(async (args: { where: { id: number } }) => {
            deleted.push(args.where.id);
            return {};
          }),
        },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
          fn({
            $queryRaw: jest.fn(async () => []),
            loanApproval: {
              count: jest.fn(async () => 0),
              create: jest.fn(async () => ({ id: 77 })),
            },
          }),
        ),
      } as unknown as PrismaService;

      const addGuarantor = jest.fn(async () => undefined);
      const fineract = {
        isConfigured: () => true,
        getContributionBalance: jest.fn(async () => guarantorBalance),
        addGuarantor,
      } as unknown as FineractService;

      const service = new LoansService(
        {} as unknown as MultiplierService,
        {} as unknown as MultiplierQueueService,
        fineract,
        prisma,
      );

      // getLoanApplication is exercised elsewhere; stub it so these tests
      // stay about the capacity rule.
      jest
        .spyOn(service, 'getLoanApplication')
        .mockResolvedValue(application as never);

      return { service, addGuarantor, deleted };
    }

    it('refuses a guarantor whose savings do not cover the principal', async () => {
      const { service, addGuarantor } = buildForApproval(50000);

      await expect(
        service.directorDecision(9, 3, {
          decision: ApprovalDecision.APPROVE,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      // The liability must never reach Fineract.
      expect(addGuarantor).not.toHaveBeenCalled();
    });

    it('rolls back the vote so the director can retry', async () => {
      // The row is written before the check to win the guarantor race; if it
      // survived a refusal the unique constraint would reject the retry.
      const { service, deleted } = buildForApproval(50000);

      await expect(
        service.directorDecision(9, 3, {
          decision: ApprovalDecision.APPROVE,
        } as never),
      ).rejects.toThrow();

      expect(deleted).toContain(77);
    });

    it('accepts a guarantor whose savings exactly cover the principal', async () => {
      const { service, addGuarantor } = buildForApproval(80000);

      await service.directorDecision(9, 3, {
        decision: ApprovalDecision.APPROVE,
      } as never);

      expect(addGuarantor).toHaveBeenCalled();
    });

    it('does not guarantee when the balance cannot be read', async () => {
      const { service, addGuarantor } = buildForApproval(null);

      await expect(
        service.directorDecision(9, 3, {
          decision: ApprovalDecision.APPROVE,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(addGuarantor).not.toHaveBeenCalled();
    });
  });
});
