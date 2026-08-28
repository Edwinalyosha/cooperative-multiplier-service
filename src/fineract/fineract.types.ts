/** Fineract's own POST /authentication response. Note: no clientId here —
 * Fineract Users (admin/staff logins) are not tied to Clients (member
 * records) at all; that mapping only exists in our own User table. See
 * ONBOARDING-AND-AUTH-PLAN.md. */
export interface FineractAuthResult {
  username: string;
  userId: number;
  authenticated: boolean;
  roles?: Array<{ id: number; name: string }>;
  officeId?: number;
}

export interface FineractSavingsAccountSummary {
  id: number;
  accountNo?: string;
  accountBalance?: number;
  availableBalance?: number;
}

export interface FineractClientAccountsResponse {
  savingsAccounts?: FineractSavingsAccountSummary[];
  loanAccounts?: Array<{
    id: number;
    accountNo?: string;
    loanBalance?: number;
    status?: { active?: boolean; code?: string };
  }>;
}

export interface FineractSavingsAccountDetail {
  id: number;
  summary?: {
    accountBalance?: number;
    availableBalance?: number;
  };
  accountBalance?: number;
}

export interface FineractClient {
  id: number;
  accountNo?: string;
  displayName?: string;
  status?: { active?: boolean };
  emailAddress?: string;
}

/** Fineract's standard paginated list wrapper, used by GET /clients. */
export interface FineractClientListResponse {
  totalFilteredRecords: number;
  pageItems: FineractClient[];
}

/** Subset of a Fineract loan product's fields this service actually uses. */
export interface FineractLoanProductDetail {
  id: number;
  name: string;
  minPrincipal: number;
  maxPrincipal: number;
  numberOfRepayments: number;
  repaymentEvery: number;
  repaymentFrequencyType: { id: number };
  interestRatePerPeriod: number;
  interestRateFrequencyType: { id: number };
  interestType: { id: number };
  interestCalculationPeriodType: { id: number };
  amortizationType: { id: number };
  transactionProcessingStrategyCode: string;
}

/** Params for creating a loan application in Fineract ("submitted and
 * pending approval" state — nothing disbursed, no funds move). */
export interface CreateFineractLoanParams {
  clientId: number;
  productId: number;
  principal: number;
  interestRatePerPeriod: number;
  numberOfRepayments: number;
  repaymentEvery: number;
  repaymentFrequencyType: number;
  loanTermFrequency: number;
  loanTermFrequencyType: number;
  interestType: number;
  interestCalculationPeriodType: number;
  amortizationType: number;
  transactionProcessingStrategyCode: string;
  submittedOnDate: string;
  expectedDisbursementDate: string;
}

export interface CreateFineractLoanResponse {
  loanId: number;
}

/**
 * Registers an existing Fineract client as a loan's guarantor —
 * relationship-only, no fund hold. guarantorTypeId 1 = CUSTOMER
 * (existing client). See context/loan-approval-workflow-spec.md.
 */
export interface AddGuarantorParams {
  loanId: number;
  guarantorClientId: number;
  relationshipId?: number;
}

/** Phase 4 — finance manager's final decision. Approve = approve +
 * disburse together (money actually moves on approve); reject = Fineract's
 * native reject transition. Both are state changes on the loan Phase 2
 * already created — nothing new is created here. */
export interface ApproveFineractLoanParams {
  loanId: number;
  approvedOnDate: string;
  expectedDisbursementDate: string;
}

export interface DisburseFineractLoanParams {
  loanId: number;
  actualDisbursementDate: string;
}

export interface RejectFineractLoanParams {
  loanId: number;
  rejectedOnDate: string;
}

/** Phase 5 — borrower-initiated withdrawal. Fineract's command is
 * `withdrawnByApplicant` (confirmed live 2026-08-11 — not the more
 * guessable `withdrawnByClient`, which Fineract rejects). */
export interface WithdrawFineractLoanParams {
  loanId: number;
  withdrawnOnDate: string;
}

/** Savings account fetched with `?associations=transactions`. */
export interface FineractSavingsWithTransactions {
  id?: number;
  transactions?: {
    id?: number;
    /** `[year, month, day]`, month 1-based — see parseFineractDate. */
    date?: unknown;
    amount?: number;
    transactionType?: { deposit?: boolean; withdrawal?: boolean };
  }[];
}
