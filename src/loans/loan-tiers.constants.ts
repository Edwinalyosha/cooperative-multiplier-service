/**
 * Maps a requested loan amount (UGX) to the Fineract loan product that
 * should back it. Director never picks a product directly — this is
 * auto-selected from requestedAmount. See
 * context/loan-approval-workflow-spec.md.
 *
 * Deliberately targets `Director Loan Tier3` (fineractProductId 3), not
 * `Director Loan Tier3 Clean` (id 6) — the latter is a leftover duplicate
 * kept alive only because the pre-existing test loan (John Doe) already
 * references it; see codebase-map.md / vps-access memory for why it
 * hasn't been removed yet.
 */
export interface LoanTier {
  name: string;
  fineractProductId: number;
  minPrincipal: number;
  maxPrincipal: number;
}

export const LOAN_TIERS: LoanTier[] = [
  {
    name: 'Director Loan Tier 1',
    fineractProductId: 5,
    minPrincipal: 50_000,
    maxPrincipal: 1_000_000,
  },
  {
    name: 'Director Loan Tier2',
    fineractProductId: 2,
    minPrincipal: 1_000_001,
    maxPrincipal: 9_999_999,
  },
  // 'Director Loan Tier3' (fineractProductId 3, 10,000,001 - 50,000,000) was
  // REMOVED 2026-08-28. It had never been reachable: the borrowing cap is the
  // highest tier maximum, so no request could ever land above Tier 2's
  // ceiling and reach it. Decision was to drop the tier rather than raise the
  // cap. The Fineract products (id 3, and its duplicate id 6 'Tier3 Clean')
  // still exist but are no longer referenced by this service.
];

/**
 * The most any member can be offered, derived from the tiers rather than set
 * independently.
 *
 * This used to be a separate constant in multiplier.constants.ts, with no
 * link to the table above — which is how Tier 3 came to exist while being
 * impossible to select: the cap sat at 10,000,000 and Tier 3 began at
 * 10,000,001. Deriving it means adding or removing a tier can never again
 * leave a reachable amount with no product behind it, nor an unreachable
 * product pretending to be available.
 */
export const MAX_LOAN_AMOUNT = Math.max(
  ...LOAN_TIERS.map((tier) => tier.maxPrincipal),
);

export function selectLoanTier(requestedAmount: number): LoanTier | null {
  return (
    LOAN_TIERS.find(
      (tier) =>
        requestedAmount >= tier.minPrincipal &&
        requestedAmount <= tier.maxPrincipal,
    ) ?? null
  );
}
