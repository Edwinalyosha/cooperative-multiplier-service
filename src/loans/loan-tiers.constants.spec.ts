import {
  LOAN_TIERS,
  MAX_LOAN_AMOUNT,
  selectLoanTier,
} from './loan-tiers.constants';

/**
 * Structural guards on the loan tier table.
 *
 * These exist because `Director Loan Tier3` sat in this table for months
 * while being impossible to select: the borrowing cap lived in a separate
 * file at 10,000,000, and Tier 3 began at 10,000,001. Nothing connected the
 * two, so nothing noticed. The tier was removed 2026-08-28 and the cap is now
 * derived from this table — these tests are what stop the gap reopening.
 */
describe('loan tiers — structural invariants', () => {
  const sorted = [...LOAN_TIERS].sort(
    (a, b) => a.minPrincipal - b.minPrincipal,
  );

  it('has at least one tier', () => {
    expect(LOAN_TIERS.length).toBeGreaterThan(0);
  });

  it('has no gaps between tiers', () => {
    // A gap means an amount that passes the eligibility check but matches no
    // product, so the member is told their request "does not fall within any
    // loan tier's range" — a developer-worded refusal for a valid amount.
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minPrincipal).toBe(sorted[i - 1].maxPrincipal + 1);
    }
  });

  it('has no overlapping tiers', () => {
    // An overlap makes tier selection order-dependent, so the same amount
    // could be priced at two different rates depending on array order.
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minPrincipal).toBeGreaterThan(sorted[i - 1].maxPrincipal);
    }
  });

  it('has a valid range within each tier', () => {
    for (const tier of LOAN_TIERS) {
      expect(tier.maxPrincipal).toBeGreaterThan(tier.minPrincipal);
    }
  });

  it('maps each tier to a distinct Fineract product', () => {
    const ids = LOAN_TIERS.map((t) => t.fineractProductId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // THE ONE THAT WOULD HAVE CAUGHT TIER 3.
  it('every tier is reachable — none sits above the borrowing cap', () => {
    for (const tier of LOAN_TIERS) {
      expect(tier.minPrincipal).toBeLessThanOrEqual(MAX_LOAN_AMOUNT);
    }
  });

  it('the cap is the highest tier maximum, not an independent number', () => {
    expect(MAX_LOAN_AMOUNT).toBe(
      Math.max(...LOAN_TIERS.map((t) => t.maxPrincipal)),
    );
  });
});

describe('selectLoanTier', () => {
  it('selects a tier at its exact lower bound', () => {
    for (const tier of LOAN_TIERS) {
      expect(selectLoanTier(tier.minPrincipal)?.fineractProductId).toBe(
        tier.fineractProductId,
      );
    }
  });

  it('selects a tier at its exact upper bound', () => {
    for (const tier of LOAN_TIERS) {
      expect(selectLoanTier(tier.maxPrincipal)?.fineractProductId).toBe(
        tier.fineractProductId,
      );
    }
  });

  it('selects a tier for every amount up to the cap', () => {
    // Walks the boundaries rather than every shilling. If a gap is ever
    // introduced, it will be at a boundary.
    const boundaries = LOAN_TIERS.flatMap((t) => [
      t.minPrincipal,
      t.minPrincipal + 1,
      t.maxPrincipal - 1,
      t.maxPrincipal,
    ]).filter((amount) => amount <= MAX_LOAN_AMOUNT);

    for (const amount of boundaries) {
      expect(selectLoanTier(amount)).not.toBeNull();
    }
  });

  it('rejects an amount below the lowest tier', () => {
    const lowest = Math.min(...LOAN_TIERS.map((t) => t.minPrincipal));
    expect(selectLoanTier(lowest - 1)).toBeNull();
  });

  it('rejects an amount above the cap', () => {
    expect(selectLoanTier(MAX_LOAN_AMOUNT + 1)).toBeNull();
  });
});
