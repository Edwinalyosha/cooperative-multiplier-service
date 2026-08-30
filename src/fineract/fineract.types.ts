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
  /**
   * Distinguishes the contributions (ownership stake) account from ordinary
   * savings. Fineract has always returned it on /clients/{id}/accounts; we
   * only began reading it when the two were separated on 2026-08-29.
   */
  productId?: number;
  productName?: string;
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
export interface FineractGlAccount {
  id: number;
  name: string;
  glCode: string;
  /** 1 Asset, 2 Liability, 3 Equity, 4 Income, 5 Expense. */
  type?: { id?: number; value?: string };
  usage?: { id?: number; value?: string };
  manualEntriesAllowed?: boolean;
  disabled?: boolean;
}

export interface FineractJournalEntry {
  id: number;
  /** Groups the two sides of one posting; what `reverse` takes. */
  transactionId: string;
  glAccountId?: number;
  glAccountName?: string;
  glAccountCode?: string;
  transactionDate?: unknown;
  /** 1 Credit, 2 Debit. */
  entryType?: { id?: number; value?: string };
  amount?: number;
  comments?: string;
  reversed?: boolean;
  createdByUserName?: string;
}

/**
 * A loan's repayment schedule as Fineract holds it.
 *
 * The reason repayment timeliness is read rather than inferred: Fineract
 * already knows when each installment was DUE and when its obligations were
 * MET. A transaction-size threshold would call a 12,000 payment three weeks
 * late "on time", which is plainly wrong.
 */
export interface FineractLoanWithSchedule {
  id?: number;
  status?: { id?: number; active?: boolean; closedObligationsMet?: boolean };
  repaymentSchedule?: {
    periods?: {
      /** 0 is the disbursement row, which has no obligation. */
      period?: number;
      dueDate?: unknown;
      /** Present once the installment is fully paid. */
      obligationsMetOnDate?: unknown;
      complete?: boolean;
      totalDueForPeriod?: number;
      totalOutstandingForPeriod?: number;
    }[];
  };
}

export interface FineractSavingsWithTransactions {
  id?: number;
  transactions?: {
    id?: number;
    /** `[year, month, day]`, month 1-based — see parseFineractDate. */
    date?: unknown;
    amount?: number;
    transactionType?: { deposit?: boolean; withdrawal?: boolean };
    /** Reversed transactions stay in the list with this set. They must be
     * excluded from any total or a member sees money that was taken back. */
    reversed?: boolean;
    /** How the money arrived — cash, mobile money. Shown in the member's
     * payment history so a deposit can be matched to a real handover. */
    paymentDetailData?: { paymentType?: { id?: number; name?: string } };
    runningBalance?: number;
  }[];
}
