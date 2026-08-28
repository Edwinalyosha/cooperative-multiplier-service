export const DEFAULT_MULTIPLIER = 1.0;

/**
 * Re-exported from the loan tiers, which are the single source of truth for
 * how much can be borrowed. Kept as an export here so existing importers do
 * not need to change, and so the coupling is visible rather than implied.
 *
 * Previously this was an independent literal (10_000_000) with no connection
 * to the tier table — see loan-tiers.constants.ts for why that mattered.
 */
export { MAX_LOAN_AMOUNT } from '../loans/loan-tiers.constants';
