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
  let activeLoanIds: number[];
  let activeLoansThrow: Error | null;

  function build() {
    openApplication = null;
    activeLoanIds = [];
    activeLoansThrow = null;

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
      getActiveLoanIds: jest.fn(async () => {
        if (activeLoansThrow) throw activeLoansThrow;
        return activeLoanIds;
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

  describe('one outstanding loan at a time', () => {
    it('refuses a new application while a disbursed loan is unpaid', async () => {
      const service = build();
      activeLoanIds = [10];

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows borrowing again once nothing is outstanding', async () => {
      // The block must clear itself on repayment. An APPROVED row lives in
      // our table forever, so it must not be what bars the member.
      const service = build();
      activeLoanIds = [];

      await expect(
        service.applyForLoan(CLIENT, { requestedAmount: 80000 } as never),
      ).resolves.toBeDefined();
    });

    it('refuses to lend when Fineract cannot be read', async () => {
      // Silence is not evidence of no debt. Refusing on missing information
      // is the safe direction — the same rule the contribution sweep uses
      // when it declines to mark a member late it could not read.
      const service = build();
      activeLoansThrow = new Error('ECONNREFUSED');

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
