/**
 * Deciding which weeks a member's money has paid for.
 *
 * Pure, and separated from the database for the same reason the period
 * boundary arithmetic is: it decides whether someone is in arrears, which
 * moves a real interest rate, and it must be testable without a clock, a
 * connection, or Fineract.
 *
 * THE RULE, as set by the cooperative: a payment covers the CURRENT week
 * first, then backfills the oldest unpaid week.
 *
 * That ordering is deliberate and worth not "fixing" later. Strict
 * chronological allocation — oldest first, always — would have a member who
 * fell behind once paying off old weeks while fresh ones went unpaid behind
 * them, collecting a new penalty every week despite paying every week.
 * Current-week-first stops the bleeding, then clears the backlog.
 */

export interface PeriodObligation {
  /** YYYY-MM-DD, the Monday of the week. Identifies the period. */
  periodStart: string;
  amountDue: number;
  amountPaid: number;
}

export interface Allocation {
  periodStart: string;
  /** Total allocated to this period after applying the payment. */
  amountPaid: number;
  /** Still owed on this period: amountDue - amountPaid, never negative. */
  outstanding: number;
  satisfied: boolean;
}

/**
 * Allocates `payment` across a member's obligations.
 *
 * `currentPeriodStart` names the week to fill first; it need not exist in
 * `obligations` (a member with no outstanding weeks simply has the payment
 * spill into nothing). Anything left after every obligation is satisfied is
 * returned as `surplus` — it stays in the member's contribution balance and
 * is NOT invented into a future week, because that week's amount is not yet
 * known and may change.
 */
export function allocatePayment(
  obligations: PeriodObligation[],
  payment: number,
  currentPeriodStart: string,
): { allocations: Allocation[]; surplus: number } {
  let remaining = Math.max(0, payment);

  // Current week first, then oldest to newest. Sorting a copy keeps this
  // pure — callers pass rows straight from the database.
  const ordered = [...obligations].sort((a, b) => {
    if (a.periodStart === currentPeriodStart) return -1;
    if (b.periodStart === currentPeriodStart) return 1;
    return a.periodStart < b.periodStart ? -1 : 1;
  });

  const allocations: Allocation[] = ordered.map((obligation) => {
    const owed = Math.max(0, obligation.amountDue - obligation.amountPaid);
    const applied = Math.min(owed, remaining);
    remaining -= applied;

    const amountPaid = obligation.amountPaid + applied;
    const outstanding = Math.max(0, obligation.amountDue - amountPaid);

    return {
      periodStart: obligation.periodStart,
      amountPaid,
      outstanding,
      // A week is satisfied only when fully covered. A partial payment
      // reduces the debt but does not meet the obligation — the week still
      // counts late, which is what the cooperative decided.
      satisfied: outstanding === 0,
    };
  });

  return { allocations, surplus: remaining };
}

/** Total still owed across every unsatisfied week. */
export function totalArrears(obligations: PeriodObligation[]): number {
  return obligations.reduce(
    (total, o) => total + Math.max(0, o.amountDue - o.amountPaid),
    0,
  );
}
