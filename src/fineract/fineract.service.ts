import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  FineractClient,
  FineractClientAccountsResponse,
  FineractSavingsAccountDetail,
  FineractLoanProductDetail,
  CreateFineractLoanParams,
  CreateFineractLoanResponse,
  AddGuarantorParams,
  ApproveFineractLoanParams,
  DisburseFineractLoanParams,
  RejectFineractLoanParams,
} from './fineract.types';

const DEFAULT_GUARANTOR_RELATIONSHIP_ID = 8; // "Business Associate"

@Injectable()
export class FineractService {
  private readonly logger = new Logger(FineractService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('fineract.baseUrl'));
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('fineract.baseUrl');
    if (!url) {
      throw new ServiceUnavailableException('Fineract is not configured');
    }
    return url.replace(/\/$/, '');
  }

  private get headers(): Record<string, string> {
    return {
      'Fineract-Platform-TenantId':
        this.config.get<string>('fineract.tenantId') ?? 'default',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private get auth() {
    return {
      username: this.config.get<string>('fineract.username') ?? '',
      password: this.config.get<string>('fineract.password') ?? '',
    };
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const { data } = await firstValueFrom(
      this.http.get<T>(url, {
        headers: this.headers,
        auth: this.auth,
        timeout: 30_000,
      }),
    );
    return data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const { data } = await firstValueFrom(
      this.http.post<T>(url, body, {
        headers: this.headers,
        auth: this.auth,
        timeout: 30_000,
      }),
    );
    return data;
  }

  /** Fineract expects "dd MMMM yyyy" (e.g. "10 August 2026") with a locale. */
  static formatFineractDate(date: Date): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  async getClient(clientId: number): Promise<FineractClient | null> {
    if (!this.isConfigured()) return null;
    try {
      return await this.get<FineractClient>(`/clients/${clientId}`);
    } catch (error) {
      this.logger.error(`Failed to fetch client ${clientId}`, error);
      return null;
    }
  }

  async getClientAccounts(
    clientId: number,
  ): Promise<FineractClientAccountsResponse | null> {
    if (!this.isConfigured()) return null;
    try {
      return await this.get<FineractClientAccountsResponse>(
        `/clients/${clientId}/accounts`,
      );
    } catch (error) {
      this.logger.error(`Failed to fetch accounts for client ${clientId}`, error);
      return null;
    }
  }

  async getSavingsAccountBalance(accountId: number): Promise<number> {
    const detail = await this.get<FineractSavingsAccountDetail>(
      `/savingsaccounts/${accountId}`,
    );
    return (
      detail.summary?.availableBalance ??
      detail.summary?.accountBalance ??
      detail.accountBalance ??
      0
    );
  }

  /**
   * Sum of all active savings (contribution) balances for a Fineract client.
   */
  async getContributionBalance(clientId: number): Promise<number | null> {
    if (!this.isConfigured()) {
      this.logger.debug(
        `Fineract not configured; cannot fetch balance for client ${clientId}`,
      );
      return null;
    }

    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.savingsAccounts?.length) {
      this.logger.warn(`No savings accounts for client ${clientId}`);
      return 0;
    }

    let total = 0;
    for (const account of accounts.savingsAccounts) {
      const inline =
        account.accountBalance ?? account.availableBalance;
      if (inline != null) {
        total += Number(inline);
        continue;
      }
      if (account.id) {
        total += await this.getSavingsAccountBalance(account.id);
      }
    }

    return total;
  }

  async getActiveLoanIds(clientId: number): Promise<number[]> {
    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.loanAccounts?.length) return [];

    return accounts.loanAccounts
      .filter((loan) => loan.status?.active !== false)
      .map((loan) => loan.id);
  }

  /**
   * Live product config (rate, term defaults) — fetched fresh each time
   * rather than cached/hardcoded, so a manual rate edit in Fineract (like
   * the Tier2 fix made 2026-08-10) is always reflected without a
   * multiplier-service redeploy.
   */
  async getLoanProduct(productId: number): Promise<FineractLoanProductDetail> {
    return this.get<FineractLoanProductDetail>(`/loanproducts/${productId}`);
  }

  /**
   * Creates a loan application in Fineract — "Submitted and pending
   * approval" state. Does not move money; that only happens on later
   * approve+disburse (Phase 4). See
   * context/loan-approval-workflow-spec.md.
   */
  async createLoanApplication(
    params: CreateFineractLoanParams,
  ): Promise<CreateFineractLoanResponse> {
    const response = await this.post<{ loanId: number; resourceId?: number }>(
      '/loans',
      {
        clientId: params.clientId,
        productId: params.productId,
        principal: params.principal,
        loanType: 'individual',
        interestRatePerPeriod: params.interestRatePerPeriod,
        interestRateFrequencyType: 2, // per month, matches all current tiers
        numberOfRepayments: params.numberOfRepayments,
        repaymentEvery: params.repaymentEvery,
        repaymentFrequencyType: params.repaymentFrequencyType,
        loanTermFrequency: params.loanTermFrequency,
        loanTermFrequencyType: params.loanTermFrequencyType,
        interestType: params.interestType,
        interestCalculationPeriodType: params.interestCalculationPeriodType,
        amortizationType: params.amortizationType,
        transactionProcessingStrategyCode:
          params.transactionProcessingStrategyCode,
        submittedOnDate: params.submittedOnDate,
        expectedDisbursementDate: params.expectedDisbursementDate,
        dateFormat: 'dd MMMM yyyy',
        locale: 'en',
      },
    );
    return { loanId: response.loanId ?? response.resourceId ?? 0 };
  }

  /**
   * Registers the first-approving director as the loan's guarantor in
   * Fineract — relationship-only, deliberately no fund hold (decided
   * 2026-08-10: guarantor is an accountability record, not a financial
   * mechanism; recorded in Fineract so it's trackable there rather than
   * duplicated in our own tables). Fineract itself already rejects a
   * borrower guaranteeing their own loan, as a backstop to our own check.
   */
  async addGuarantor(params: AddGuarantorParams): Promise<void> {
    await this.post(`/loans/${params.loanId}/guarantors`, {
      guarantorTypeId: 1, // CUSTOMER (existing client)
      entityId: params.guarantorClientId,
      relationshipId:
        params.relationshipId ?? DEFAULT_GUARANTOR_RELATIONSHIP_ID,
      locale: 'en',
    });
  }

  /** Phase 4 — finance approval. Money doesn't move yet; disburseLoan
   * (called right after, in the same LoansService flow) is what does. */
  async approveLoan(params: ApproveFineractLoanParams): Promise<void> {
    await this.post(`/loans/${params.loanId}?command=approve`, {
      approvedOnDate: params.approvedOnDate,
      expectedDisbursementDate: params.expectedDisbursementDate,
      locale: 'en',
      dateFormat: 'dd MMMM yyyy',
    });
  }

  /** Phase 4 — the actual money-movement step. */
  async disburseLoan(params: DisburseFineractLoanParams): Promise<void> {
    await this.post(`/loans/${params.loanId}?command=disburse`, {
      actualDisbursementDate: params.actualDisbursementDate,
      locale: 'en',
      dateFormat: 'dd MMMM yyyy',
    });
  }

  /** Phase 4 — finance rejection. No fund hold to release (see spec doc —
   * that step was in an earlier draft, dropped once the guarantor design
   * became relationship-only). */
  async rejectLoan(params: RejectFineractLoanParams): Promise<void> {
    await this.post(`/loans/${params.loanId}?command=reject`, {
      rejectedOnDate: params.rejectedOnDate,
      locale: 'en',
      dateFormat: 'dd MMMM yyyy',
    });
  }
}
