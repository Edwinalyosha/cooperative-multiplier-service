import { ConfigService } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * How much of a member's savings a loan actually leans on — and so how much
 * gets frozen in Fineract for the life of it.
 *
 * This is what makes savingsFactor > 1.0 defensible. Without a hold a member
 * could deposit savings, borrow against the limit those savings raised, and
 * withdraw them the same day, leaving the fund lending 1.2 against nothing.
 *
 * The rule cuts both ways, and the second half matters as much as the first:
 * a member borrowing within what their CONTRIBUTIONS alone support must have
 * nothing frozen. Freezing savings that are not backing anything would punish
 * people for saving, which is the opposite of the intent.
 */
describe('savings pledge', () => {
  function build(savingsFactor = 1.2) {
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

  // A member with 50,000 contributions at 2.189x: 109,450 from contributions
  // alone, plus 30,000 savings at 1.2 = 36,000, for a 145,450 limit.
  const MEMBER = {
    contributionBalance: 50000,
    loanMultiple: 2.189,
    savingsBalance: 30000,
  };

  it('freezes nothing when contributions alone cover the loan', () => {
    const service = build();
    expect(
      service.calculateSavingsPledge({ ...MEMBER, requestedAmount: 100000 }),
    ).toBe(0);
  });

  it('freezes nothing at exactly the contributions-derived limit', () => {
    const service = build();
    expect(
      service.calculateSavingsPledge({ ...MEMBER, requestedAmount: 109450 }),
    ).toBe(0);
  });

  it('freezes only the shortfall, not the whole savings balance', () => {
    // 120,000 requested is 10,550 above what contributions support. At a 1.2
    // factor that shortfall is covered by 8,792 of pledged savings — the
    // other 21,208 stays available to the member.
    const service = build();
    expect(
      service.calculateSavingsPledge({ ...MEMBER, requestedAmount: 120000 }),
    ).toBe(8792);
  });

  it('divides by the factor, because the bonus is on the pledge', () => {
    // At 1.2, every 100 frozen unlocks 120 of borrowing. A 12,000 shortfall
    // therefore needs 10,000 pledged, not 12,000.
    const service = build(1.2);
    expect(
      service.calculateSavingsPledge({
        ...MEMBER,
        requestedAmount: 109450 + 12000,
      }),
    ).toBe(10000);
  });

  it('pledges the shortfall exactly when the factor is 1.0', () => {
    const service = build(1.0);
    expect(
      service.calculateSavingsPledge({
        ...MEMBER,
        requestedAmount: 109450 + 12000,
      }),
    ).toBe(12000);
  });

  it('never pledges more savings than the member has', () => {
    // The uncovered remainder is the deliberate unsecured margin the factor
    // creates, and it sits behind the guarantor's obligation to cover the
    // whole principal.
    const service = build();
    expect(
      service.calculateSavingsPledge({ ...MEMBER, requestedAmount: 145450 }),
    ).toBe(30000);
  });

  it('rounds the pledge up, never down', () => {
    // Rounding down would leave a shilling of the loan unsecured. Trivial in
    // money, but it is the kind of gap that only ever widens.
    const service = build(1.2);
    const pledge = service.calculateSavingsPledge({
      ...MEMBER,
      requestedAmount: 109451,
    });
    expect(pledge).toBe(1);
  });

  it('freezes nothing for a member with no savings', () => {
    // Savings are voluntary; most loans will not touch them at all.
    const service = build();
    expect(
      service.calculateSavingsPledge({
        ...MEMBER,
        savingsBalance: 0,
        requestedAmount: 100000,
      }),
    ).toBe(0);
  });
});
