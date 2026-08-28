import { MultiplierEventType } from './multiplier-event.enum';

/**
 * How much each event moves a director's multiplier.
 *
 * DIRECTION MATTERS AND IS EASY TO GET BACKWARDS. A LOWER multiplier is the
 * BETTER state for the member:
 *   - `effectiveRate = productRate x multiplier`, so 0.600 is the cheapest
 *     loan and 1.500 the most expensive.
 *   - `calculateLoanMultiple` gives 5x borrowing at 0.600 and 1x at 1.500.
 *   - The webapp shows it as "Progress to best rate (0.600)".
 *
 * So a NEGATIVE step is a REWARD and a POSITIVE step is a PENALTY.
 *
 * These signs were inverted until 2026-08-28: lateness subtracted (making
 * loans cheaper and limits higher) while early payoff added (making them
 * worse), and both on-time events were 0.00 so good behaviour did nothing at
 * all. It had never shown up because no event had ever fired in production —
 * every currentMultiplier was still exactly 1.000. The first week of real
 * contributions would have started rewarding late payers.
 *
 * Pacing, with the 0.600–1.500 band and 1.000 as the starting point:
 *   A member contributing on time weekly earns -0.005 x3 plus a -0.010 streak
 *   bonus every third week = -0.025 per 3 weeks, so 1.000 -> 0.600 takes
 *   roughly 11 months. One late contribution costs +0.020 — about two and a
 *   half weeks of progress. Deliberately asymmetric: slow to earn, quick to
 *   lose, which is the usual shape for credit standing.
 */
export const MULTIPLIER_STEPS: Record<MultiplierEventType, number> = {
  // Contributions
  /** Weekly, so kept small — it accumulates. */
  ON_TIME_CONTRIBUTION: -0.005,
  /** Awarded every 3rd consecutive on-time contribution, on top of the above. */
  CONSECUTIVE_ON_TIME_CONTRIBUTIONS: -0.01,
  LATE_CONTRIBUTION: 0.02,

  // Loan repayments
  ON_TIME_REPAYMENT: -0.01,
  /** Worse than a late contribution: this is money already lent out. */
  LATE_REPAYMENT: 0.03,

  // Strong reward
  EARLY_FULL_PAYOFF: -0.03,
};
