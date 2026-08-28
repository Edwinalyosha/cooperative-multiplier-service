import { ConfigService } from '@nestjs/config';
import { MULTIPLIER_STEPS } from './multiplier-steps.constants';
import { MultiplierEventType } from './multiplier-event.enum';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * Guards the DIRECTION of every multiplier step.
 *
 * Until 2026-08-28 the signs were inverted: lateness subtracted from the
 * multiplier (making loans cheaper and limits higher) while early payoff
 * added (making them worse), and both on-time events were 0.00 so good
 * behaviour did nothing at all. It never surfaced because no event had ever
 * fired in production — every currentMultiplier was still exactly 1.000.
 *
 * The confusing part, and the reason this is worth testing rather than
 * eyeballing: a LOWER multiplier is the BETTER state. Reward = negative.
 * These tests assert that through the actual consequences (rate and limit)
 * rather than restating the constants, so a future edit that "corrects" a
 * sign has to disagree with the money, not just with a table.
 */

const REWARDS = [
  MultiplierEventType.ON_TIME_CONTRIBUTION,
  MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
  MultiplierEventType.ON_TIME_REPAYMENT,
  MultiplierEventType.EARLY_FULL_PAYOFF,
];

const PENALTIES = [
  MultiplierEventType.LATE_CONTRIBUTION,
  MultiplierEventType.LATE_REPAYMENT,
];

describe('MULTIPLIER_STEPS — direction', () => {
  it('covers every event type', () => {
    for (const event of Object.values(MultiplierEventType)) {
      expect(MULTIPLIER_STEPS[event]).toBeDefined();
    }
    expect([...REWARDS, ...PENALTIES].sort()).toEqual(
      Object.values(MultiplierEventType).sort(),
    );
  });

  it.each(REWARDS)('%s rewards: step is negative', (event) => {
    expect(MULTIPLIER_STEPS[event]).toBeLessThan(0);
  });

  it.each(PENALTIES)('%s penalises: step is positive', (event) => {
    expect(MULTIPLIER_STEPS[event]).toBeGreaterThan(0);
  });

  it('penalises lateness harder than a single on-time act rewards', () => {
    // Slow to earn, quick to lose — the usual shape for credit standing.
    // Without this, a member could offset lateness with one on-time week.
    expect(MULTIPLIER_STEPS[MultiplierEventType.LATE_CONTRIBUTION]).toBeGreaterThan(
      Math.abs(MULTIPLIER_STEPS[MultiplierEventType.ON_TIME_CONTRIBUTION]),
    );
  });

  it('treats a late repayment as worse than a late contribution', () => {
    // A repayment is money already lent out.
    expect(MULTIPLIER_STEPS[MultiplierEventType.LATE_REPAYMENT]).toBeGreaterThan(
      MULTIPLIER_STEPS[MultiplierEventType.LATE_CONTRIBUTION],
    );
  });
});

describe('steps have the right effect on what a member actually pays', () => {
  const service = new MultiplierService(
    {} as PrismaService,
    {} as FineractService,
    { get: () => undefined } as unknown as ConfigService,
  );

  const START = 1.0;

  /** What a member sees after one event: their rate factor and borrowing multiple. */
  function outcomeAfter(event: MultiplierEventType) {
    const next = service.clampMultiplier(START + MULTIPLIER_STEPS[event]);
    return {
      rateFactor: next, // effectiveRate = productRate x multiplier
      loanMultiple: service.calculateLoanMultiple(next),
    };
  }

  const before = {
    rateFactor: START,
    loanMultiple: service.calculateLoanMultiple(START),
  };

  it.each(REWARDS)('%s makes the loan cheaper and the limit higher', (event) => {
    const after = outcomeAfter(event);
    expect(after.rateFactor).toBeLessThan(before.rateFactor);
    expect(after.loanMultiple).toBeGreaterThan(before.loanMultiple);
  });

  it.each(PENALTIES)('%s makes the loan dearer and the limit lower', (event) => {
    const after = outcomeAfter(event);
    expect(after.rateFactor).toBeGreaterThan(before.rateFactor);
    expect(after.loanMultiple).toBeLessThan(before.loanMultiple);
  });

  it('a late repayment can never make borrowing cheaper', () => {
    // The single sentence the old constants violated.
    const after = outcomeAfter(MultiplierEventType.LATE_REPAYMENT);
    expect(after.rateFactor).toBeGreaterThan(before.rateFactor);
  });
});
