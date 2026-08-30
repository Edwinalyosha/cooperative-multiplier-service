import { LoansService } from './loans.service';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { LoanApplicationStatus } from '@prisma/client';

/**
 * Loans Fineract approved where the disbursement then failed.
 *
 * They are the most urgent thing in the system and the least visible: money
 * has not moved, the member is waiting, and they appear in no queue —
 * pending-my-decision lists only applications awaiting a FIRST decision.
 * Until 2026-08-30 a stuck loan could only be reached by knowing its id.
 *
 * The status filter is the whole safety property. APPROVED means the money
 * HAS gone out; listing those would invite a finance manager to "retry" a
 * disbursement that already happened.
 */
describe('stuck disbursements', () => {
  let where: Record<string, unknown> | undefined;
  let orderBy: Record<string, unknown> | undefined;

  function build() {
    where = undefined;
    orderBy = undefined;

    const prisma = {
      loanApplication: {
        findMany: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: Record<string, unknown>;
            orderBy: Record<string, unknown>;
          };
          where = a.where;
          orderBy = a.orderBy;
          return [];
        }),
      },
    } as unknown as PrismaService;

    return new LoansService(
      {} as unknown as MultiplierService,
      {} as unknown as MultiplierQueueService,
      {} as unknown as FineractService,
      prisma,
    );
  }

  it('lists ONLY applications where the money never moved', async () => {
    const service = build();
    await service.listStuckDisbursements();

    expect(where).toEqual({
      status: LoanApplicationStatus.APPROVED_PENDING_DISBURSEMENT,
    });
  });

  it('never includes APPROVED — those already disbursed', async () => {
    // Retrying one of these would attempt a second disbursement of a loan
    // whose funds are already with the borrower.
    const service = build();
    await service.listStuckDisbursements();

    expect(JSON.stringify(where)).not.toContain(
      LoanApplicationStatus.APPROVED + '"',
    );
  });

  it('orders oldest first — the wait is the problem', async () => {
    const service = build();
    await service.listStuckDisbursements();

    expect(orderBy).toEqual({ financeDecidedAt: 'asc' });
  });
});
