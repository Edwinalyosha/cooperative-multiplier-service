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
