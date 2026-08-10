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
  {
    name: 'Director Loan Tier3',
    fineractProductId: 3,
    minPrincipal: 10_000_001,
    maxPrincipal: 50_000_000,
  },
];

export function selectLoanTier(requestedAmount: number): LoanTier | null {
  return (
    LOAN_TIERS.find(
      (tier) =>
        requestedAmount >= tier.minPrincipal &&
        requestedAmount <= tier.maxPrincipal,
    ) ?? null
  );
}
