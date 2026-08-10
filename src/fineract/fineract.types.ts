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
