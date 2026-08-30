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
 * loans cheaper and limits higher) while early payoff added, and both on-time
 * events were 0.00 so good behaviour did nothing. It had never surfaced
 * because no event had ever fired in production.
 *
 * ---------------------------------------------------------------------------
 * CHOOSING VALUES — the number that actually decides the policy
 *
 * Let `e` be what a member earns per contribution period when behaving, and
 * `p` the late penalty. The break-even reliability — how often they must be
 * on time merely to STOP getting worse — is:
 *
 *     x = p / (p + e)
 *
 * Below x they drift worse forever no matter how long they stay a member;
 * above it they improve. It is the single most consequential number here, and
 * it is not obvious from reading the steps individually.
 *
 * Current values, at the default weekly cadence:
 *     e = 0.008 + 0.020/3 = 0.01467 per week
 *     p = 0.020
 *     x = 0.020 / 0.03467 = 57.7%
 *
 *   - best rate (1.000 -> 0.600) after ~27 weeks of consistency
 *   - one late contribution costs ~1.4 weeks of progress
 *   - the streak bonus exactly equals the late penalty, so three consistent
 *     weeks cancel one lapse
 *
 * Chosen with the cooperative 2026-08-28, targeting a break-even just under
 * 60%: forgiving of an occasional miss, still unforgiving of a member who is
 * unreliable more often than not.
 *
 * ---------------------------------------------------------------------------
 * CADENCE COUPLING — read before changing CONTRIBUTION_PERIOD_DAYS
 *
 * These steps are per CONTRIBUTION, not per unit of time. Switching the
 * cadence from weekly to monthly without retuning would make the best rate
 * take ~27 months instead of ~27 weeks. Change one, revisit the other.
 *
 * Every value here can be overridden per-event by environment variable (see
 * configuration.ts) so the directors can retune policy without a deploy.
 * Overrides that would invert a sign are REJECTED at runtime and the default
 * used instead — see validateStepDirection.
 */
export const MULTIPLIER_STEPS: Record<MultiplierEventType, number> = {
  // Contributions
  /** Per contribution period. Small because it accumulates every period. */
  ON_TIME_CONTRIBUTION: -0.008,
  /** Every 3rd consecutive on-time contribution, on top of the above. */
  CONSECUTIVE_ON_TIME_CONTRIBUTIONS: -0.02,
  LATE_CONTRIBUTION: 0.02,
  /**
   * Paying off a week that was missed. A missed week is DEFERRED, not
   * forgiven — it stays owed, interest-free, until cleared.
   *
   * MUST stay smaller in magnitude than LATE_CONTRIBUTION, or missing a week
   * and paying it later becomes a net GAIN and the whole obligation is
   * gameable. At -0.005 against +0.020, a missed-then-paid week still costs
   * +0.015 — cheaper than never paying, dearer than paying on time, which is
   * exactly the ordering the incentive needs. Asserted in
   * contribution-ledger.spec.ts.
   */
  ARREARS_CLEARED: -0.005,

  // Loan repayments
  ON_TIME_REPAYMENT: -0.01,
  /** Worse than a late contribution: this is money already lent out. */
  LATE_REPAYMENT: 0.03,

  // Strong reward
  EARLY_FULL_PAYOFF: -0.03,
};

/** Events that must make the member BETTER off (negative step). */
export const REWARD_EVENTS: readonly MultiplierEventType[] = [
  MultiplierEventType.ON_TIME_CONTRIBUTION,
  MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
  MultiplierEventType.ARREARS_CLEARED,
  MultiplierEventType.ON_TIME_REPAYMENT,
  MultiplierEventType.EARLY_FULL_PAYOFF,
];

/** Events that must make the member WORSE off (positive step). */
export const PENALTY_EVENTS: readonly MultiplierEventType[] = [
  MultiplierEventType.LATE_CONTRIBUTION,
  MultiplierEventType.LATE_REPAYMENT,
];

/**
 * Is a proposed step value pointing the right way for this event?
 *
 * Configuration lets the directors retune magnitudes freely — that is policy,
 * and theirs to set. It must not let them flip a SIGN, because that silently
 * turns the incentive system inside out and rewards lateness. An override
 * failing this check is ignored in favour of the default.
 */
export function isValidStepDirection(
  eventType: MultiplierEventType,
  step: number,
): boolean {
  if (!Number.isFinite(step)) return false;
  if (REWARD_EVENTS.includes(eventType)) return step < 0;
  if (PENALTY_EVENTS.includes(eventType)) return step > 0;
  return false;
}
