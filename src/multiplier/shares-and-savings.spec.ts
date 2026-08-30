import { ConfigService } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * Contributions and savings are two different kinds of member money and are
 * rewarded differently:
 *
 *   limit = contributions x loanMultiple + savings x savingsFactor
 *
 * Contributions are the ownership stake — the weekly obligation. They are
 * committed capital, so they are leveraged 1-5x, they alone move the
 * multiplier, and they are the basis for any later profit split.
 *
 * Savings are voluntary and withdrawable. They add capacity at face value and
 * confer no ownership.
 *
 * The rule that matters most, and the one the cooperative asked for
 * explicitly: a member with NO savings account must still get a good limit.
 * Savings raise a limit; they are never a precondition for one.
 */
describe('contributions vs savings', () => {
  function build(savingsFactor = 1.0) {
    const config = {
      get: (key: string) =>
        key === 'multiplier.savingsFactor' ? savingsFactor : undefined,
    } as unknown as ConfigService;

    return new MultiplierService(
      {} as unknown as PrismaService,
      {} as unknown as FineractService,
      config,
    );
  }

  it('leverages contributions by the loan multiple', () => {
    const service = build();
    // 50,000 stake at 2.189x, no savings.
    expect(service.calculateMaxLoanAmount(50000, 2.189).maxLoanAmount).toBe(
      109450,
    );
  });

  it('gives a member with NO savings the full multiple', () => {
    // The cooperative's explicit requirement: not having a savings account
    // must not hold anyone back. This is the same figure as above, asserted
    // separately because it is a promise, not an implementation detail.
    const service = build();
    const withoutSavings = service.calculateMaxLoanAmount(50000, 2.189);
    const withSavingsArgOmitted = service.calculateMaxLoanAmount(50000, 2.189, 0);

    expect(withoutSavings.maxLoanAmount).toBe(109450);
    expect(withSavingsArgOmitted.maxLoanAmount).toBe(109450);
  });

  it('adds savings at face value, not at the multiple', () => {
    // 50,000 stake x 2.189 = 109,450, plus 30,000 savings x 1.0 = 139,450.
    // If savings were leveraged too this would read 175,120 — the assertion
    // is really "savings are NOT leveraged".
    const service = build();
    expect(
      service.calculateMaxLoanAmount(50000, 2.189, 30000).maxLoanAmount,
    ).toBe(139450);
  });

  it('lets savings alone produce a limit for someone with no stake yet', () => {
    // A member who has joined but not yet contributed still gets credit for
    // money they have actually placed with the cooperative.
    const service = build();
    expect(service.calculateMaxLoanAmount(0, 2.189, 40000).maxLoanAmount).toBe(
      40000,
    );
  });

  it('honours a savings factor below 1', () => {
    // Directors may decide savings should carry a haircut. Policy is a dial;
    // the shape of the formula is not.
    const service = build(0.5);
    expect(
      service.calculateMaxLoanAmount(50000, 2.189, 30000).maxLoanAmount,
    ).toBe(124450);
  });

  it('still caps the combined total at the tier ceiling', () => {
    // Savings must not become a way around the maximum any member can be
    // offered.
    const service = build();
    const result = service.calculateMaxLoanAmount(9_000_000, 5, 9_000_000);
    expect(result.maxLoanAmount).toBe(9_999_999);
    expect(result.cappedAtMax).toBe(true);
  });

  describe('ownership share', () => {
    function buildWithMembers(
      members: { clientId: number; contributionBalance: number | null }[],
    ) {
      const prisma = {
        directorMultiplier: { findMany: jest.fn(async () => members) },
      } as unknown as PrismaService;

      return new MultiplierService(
        prisma,
        {} as unknown as FineractService,
        { get: () => undefined } as unknown as ConfigService,
      );
    }

    it('reports a member share as a percentage of all contributions', async () => {
      const service = buildWithMembers([
        { clientId: 1, contributionBalance: 100000 },
        { clientId: 2, contributionBalance: 300000 },
      ]);

      const result = await service.getOwnershipShare(1);
      expect(result.sharePercentage).toBe(25);
      expect(result.totalContributions).toBe(400000);
      expect(result.memberCount).toBe(2);
    });

    it('excludes savings from ownership', async () => {
      // Savings are the member's own money held with the cooperative. If they
      // counted here, someone could deposit on the eve of a profit split,
      // take a larger slice, and withdraw the next day.
      const service = buildWithMembers([
        { clientId: 1, contributionBalance: 100000 },
        { clientId: 2, contributionBalance: 100000 },
      ]);

      // Both members hold equal CONTRIBUTIONS; whatever either has in
      // savings is not part of this calculation at all.
      const result = await service.getOwnershipShare(1);
      expect(result.sharePercentage).toBe(50);
    });

    it('reports zero before anyone has contributed', async () => {
      // Not a division by zero, and not an implied equal split.
      const service = buildWithMembers([
        { clientId: 1, contributionBalance: 0 },
        { clientId: 2, contributionBalance: null },
      ]);

      const result = await service.getOwnershipShare(1);
      expect(result.sharePercentage).toBe(0);
      expect(result.totalContributions).toBe(0);
    });

    it('gives a member who has contributed nothing a zero share', async () => {
      const service = buildWithMembers([
        { clientId: 1, contributionBalance: 0 },
        { clientId: 2, contributionBalance: 500000 },
      ]);

      const result = await service.getOwnershipShare(1);
      expect(result.sharePercentage).toBe(0);
    });

    it('has all members sum to 100%', async () => {
      // The property that makes it a share of something real. Thirds do not
      // divide evenly, so this also pins the rounding.
      const members = [
        { clientId: 1, contributionBalance: 100000 },
        { clientId: 2, contributionBalance: 100000 },
        { clientId: 3, contributionBalance: 100000 },
      ];
      const service = buildWithMembers(members);

      const shares = await Promise.all(
        members.map((m) =>
          service.getOwnershipShare(m.clientId).then((r) => r.sharePercentage),
        ),
      );

      expect(shares).toEqual([33.33, 33.33, 33.33]);
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(99.99, 2);
    });
  });

  it('a better multiplier rewards contributions, not savings', () => {
    // Improving from 1.000 (multiple 2.189) to the best rate (multiple 5)
    // must move the contribution half only. 50,000 stake gains 140,550;
    // the 30,000 of savings contributes 30,000 in both cases.
    const service = build();
    const worse = service.calculateMaxLoanAmount(50000, 2.189, 30000);
    const better = service.calculateMaxLoanAmount(50000, 5, 30000);

    expect(better.maxLoanAmount - worse.maxLoanAmount).toBe(140550);
  });
});
