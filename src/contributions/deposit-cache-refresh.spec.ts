import { ConfigService } from '@nestjs/config';
import { ContributionsService } from './contributions.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';

/**
 * Moving money must invalidate the cached eligibility.
 *
 * Eligibility is cached for 60 minutes. Recording a deposit used to re-read
 * the balance from Fineract and return it to the caller while leaving the
 * CACHED figure untouched, so a member who had just paid could see an
 * unchanged balance and an unchanged borrowing limit for up to an hour.
 *
 * It bit us on 2026-09-12: a dashboard loaded before the opening deposit
 * cached a zero, and the cache guard tests `!= null` — so 0 looked as
 * authoritative as any other number, and re-login could not shift it.
 *
 * The undo direction matters more than the deposit direction: a stale
 * pre-reversal balance OVERSTATES what a member owns, and therefore
 * overstates what they may borrow.
 */
describe('ContributionsService — balance changes refresh the cache', () => {
  function build(opts: { refreshThrows?: boolean } = {}) {
    const refreshed: number[] = [];

    const fineract = {
      getContributionsAccountId: jest.fn(async () => 7),
      depositToSavings: jest.fn(async () => 144),
      undoSavingsTransaction: jest.fn(async () => undefined),
      getContributionBalance: jest.fn(async () => 999),
    } as unknown as FineractService;

    const multiplier = {
      refreshEligibility: jest.fn(async (clientId: number) => {
        if (opts.refreshThrows) throw new Error('fineract unreachable');
        refreshed.push(clientId);
        return { contributionBalance: 1020000 } as never;
      }),
    } as unknown as MultiplierService;

    const service = new ContributionsService(
      multiplier,
      {} as unknown as MultiplierQueueService,
      fineract,
      {} as unknown as PrismaService,
      { get: () => undefined } as unknown as ConfigService,
    );

    return { service, refreshed, fineract };
  }

  it('refreshes the cache after a deposit and returns the fresh balance', async () => {
    const { service, refreshed } = build();

    const result = await service.recordDeposit(6, { amount: 1020000 } as never);

    expect(refreshed).toEqual([6]);
    expect(result.contributionBalance).toBe(1020000);
  });

  it('refreshes the cache after an undo', async () => {
    const { service, refreshed } = build();

    await service.undoDeposit(6, 144);

    expect(refreshed).toEqual([6]);
  });

  it('does not fail the deposit when the refresh fails', async () => {
    const { service, fineract } = build({ refreshThrows: true });

    // The money has already moved in Fineract. Surfacing this as a failed
    // deposit would tempt a retry, and the retry would deposit again. A stale
    // cache self-heals within the TTL; a double deposit does not.
    const result = await service.recordDeposit(6, { amount: 20000 } as never);

    expect(result.transactionId).toBe(144);
    expect(fineract.getContributionBalance).toHaveBeenCalledWith(6);
    expect(result.contributionBalance).toBe(999);
  });
});
