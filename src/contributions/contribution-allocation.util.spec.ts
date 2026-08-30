import {
  allocatePayment,
  totalArrears,
  type PeriodObligation,
} from './contribution-allocation.util';

/**
 * Which weeks a member's money pays for.
 *
 * The cooperative's rule is current week FIRST, then backfill oldest. The
 * ordering is the whole point and is easy to "correct" into strict
 * chronological order later, so the reason is asserted as a consequence:
 * a member who pays the full weekly amount every week must never accumulate
 * new arrears, however far behind they already are.
 */
describe('contribution allocation', () => {
  const DUE = 20000;

  function week(start: string, paid = 0, due = DUE): PeriodObligation {
    return { periodStart: start, amountDue: due, amountPaid: paid };
  }

  it('fills the current week before anything older', () => {
    const obligations = [week('2026-08-10'), week('2026-08-17'), week('2026-08-24')];
    const { allocations } = allocatePayment(obligations, DUE, '2026-08-24');

    const current = allocations.find((a) => a.periodStart === '2026-08-24');
    expect(current?.satisfied).toBe(true);
    expect(allocations.find((a) => a.periodStart === '2026-08-10')?.satisfied).toBe(
      false,
    );
  });

  it('backfills the oldest week with what is left over', () => {
    const obligations = [week('2026-08-10'), week('2026-08-17'), week('2026-08-24')];
    const { allocations } = allocatePayment(obligations, DUE * 2, '2026-08-24');

    const byWeek = Object.fromEntries(allocations.map((a) => [a.periodStart, a]));
    expect(byWeek['2026-08-24'].satisfied).toBe(true);
    expect(byWeek['2026-08-10'].satisfied).toBe(true);
    expect(byWeek['2026-08-17'].satisfied).toBe(false);
  });

  it('lets someone paying weekly stop falling further behind', () => {
    // THE reason current-week-first exists. Three weeks in arrears, paying
    // exactly one week's amount: the new week must be covered, or they take
    // a fresh penalty every week despite paying every week — and can never
    // catch up.
    const obligations = [
      week('2026-08-03'),
      week('2026-08-10'),
      week('2026-08-17'),
      week('2026-08-24'),
    ];
    const { allocations } = allocatePayment(obligations, DUE, '2026-08-24');

    expect(
      allocations.find((a) => a.periodStart === '2026-08-24')?.satisfied,
    ).toBe(true);
  });

  it('counts a partial payment against the debt without satisfying the week', () => {
    // The cooperative's decision: 12,000 of a 20,000 week is still a late
    // week, but the member gets credit for what they paid.
    const { allocations } = allocatePayment([week('2026-08-24')], 12000, '2026-08-24');

    expect(allocations[0].amountPaid).toBe(12000);
    expect(allocations[0].outstanding).toBe(8000);
    expect(allocations[0].satisfied).toBe(false);
  });

  it('tops up a week that was part-paid earlier', () => {
    const { allocations } = allocatePayment(
      [week('2026-08-24', 12000)],
      8000,
      '2026-08-24',
    );
    expect(allocations[0].satisfied).toBe(true);
    expect(allocations[0].outstanding).toBe(0);
  });

  it('returns anything spare as surplus rather than inventing a future week', () => {
    // The next week's amount is not yet known and may change, so money is
    // never pre-allocated forward. It stays in their contribution balance.
    const { surplus } = allocatePayment([week('2026-08-24')], DUE + 5000, '2026-08-24');
    expect(surplus).toBe(5000);
  });

  it('honours a week whose amount differed from today', () => {
    // The weekly figure changes over time and each week stores its own. A
    // week owing 15,000 is satisfied by 15,000 even if the rate is now
    // 20,000.
    const { allocations } = allocatePayment(
      [week('2026-07-06', 0, 15000)],
      15000,
      '2026-08-24',
    );
    expect(allocations[0].satisfied).toBe(true);
  });

  it('does nothing with a zero payment', () => {
    const { allocations, surplus } = allocatePayment(
      [week('2026-08-24')],
      0,
      '2026-08-24',
    );
    expect(allocations[0].amountPaid).toBe(0);
    expect(surplus).toBe(0);
  });

  it('never over-allocates a week beyond what it is due', () => {
    const { allocations } = allocatePayment(
      [week('2026-08-17'), week('2026-08-24')],
      DUE * 5,
      '2026-08-24',
    );
    for (const a of allocations) {
      expect(a.amountPaid).toBeLessThanOrEqual(DUE);
      expect(a.outstanding).toBe(0);
    }
  });

  it('leaves the input untouched', () => {
    // Callers pass rows straight from the database; mutating them would
    // write allocations back by accident.
    const obligations = [week('2026-08-24')];
    allocatePayment(obligations, DUE, '2026-08-24');
    expect(obligations[0].amountPaid).toBe(0);
  });

  describe('totalArrears', () => {
    it('sums what is still owed across every week', () => {
      expect(
        totalArrears([week('2026-08-10', 5000), week('2026-08-17'), week('2026-08-24', DUE)]),
      ).toBe(15000 + 20000);
    });

    it('is zero for a member who is fully paid up', () => {
      expect(totalArrears([week('2026-08-24', DUE)])).toBe(0);
    });

    it('never goes negative when a week was overpaid', () => {
      expect(totalArrears([week('2026-08-24', DUE + 5000)])).toBe(0);
    });
  });
});
