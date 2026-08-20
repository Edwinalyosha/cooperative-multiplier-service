import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  FineractAuthResult,
  FineractClient,
  FineractClientListResponse,
  FineractClientAccountsResponse,
  FineractSavingsAccountDetail,
  FineractLoanProductDetail,
  CreateFineractLoanParams,
  CreateFineractLoanResponse,
  AddGuarantorParams,
  ApproveFineractLoanParams,
  DisburseFineractLoanParams,
  RejectFineractLoanParams,
  WithdrawFineractLoanParams,
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

  /**
   * Validates end-user credentials against Fineract's own login (hybrid
   * auth — ONBOARDING-AND-AUTH-PLAN.md step 3). Deliberately NOT using
   * this.auth (the static admin service account) — this call validates
   * the exact username/password being checked, on behalf of the person
   * logging in.
   *
   * Credentials go in a JSON BODY, not URL query params or Basic Auth —
   * this Fineract instance rejects the classic query-param approach with
   * "Invalid JSON in BODY (no longer URL param; see FINERACT-726)".
   * Found live 2026-08-20 the hard way: query-param requests with a WRONG
   * password returned a clean 401 (fails before reaching the body-parsing
   * code), but the CORRECT password reached further into
   * AuthenticationApiResource.authenticate() and 500'd trying to parse a
   * body we never sent — which is what actually confirmed the password
   * was right all along, not a red herring.
   *
   * Returns null for invalid credentials (401) so callers can't
   * distinguish "wrong password" from "network hiccup" by exception type
   * alone — but a genuine non-auth failure (Fineract unreachable, 5xx)
   * is logged and rethrown rather than silently treated as bad
   * credentials, so an outage doesn't look identical to a wrong password.
   */
  async authenticateUser(
    username: string,
    password: string,
  ): Promise<FineractAuthResult | null> {
    if (!this.isConfigured()) return null;
    const url = `${this.baseUrl}/authentication`;
    try {
      const { data } = await firstValueFrom(
        this.http.post<FineractAuthResult>(
          url,
          { username, password },
          {
            headers: {
              'Fineract-Platform-TenantId':
                this.config.get<string>('fineract.tenantId') ?? 'default',
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            timeout: 15_000,
          },
        ),
      );
      return data?.authenticated ? data : null;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 401 || status === 400) {
        return null;
      }
      this.logger.error('Fineract authentication call failed (non-401)', error);
      throw error;
    }
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

  /**
   * Looks up Fineract Clients by exact email match, for the onboarding
   * flow's clientId-suggestion step (see ONBOARDING-AND-AUTH-PLAN.md and
   * PendingOnboarding). Uses Fineract's `sqlSearch` list parameter — a raw
   * SQL WHERE-clause fragment against m_client, a documented but low-level
   * Fineract feature. Single quotes in the input are escaped, but this is
   * still string-built SQL rather than a parameterized query; only ever
   * called with email addresses captured from a Fineract-admin-only Create
   * User form, not arbitrary end-user input.
   *
   * Unverified against this specific Fineract instance as of 2026-08-19 —
   * first live call should be treated as a test of this method too, not
   * just the onboarding flow around it.
   */
  async searchClientsByEmail(email: string): Promise<FineractClient[]> {
    if (!this.isConfigured()) return [];
    const escaped = email.replace(/'/g, "''");
    try {
      const result = await this.get<FineractClientListResponse>(
        `/clients?sqlSearch=${encodeURIComponent(`email_address='${escaped}'`)}`,
      );
      return result.pageItems ?? [];
    } catch (error) {
      this.logger.error(`Failed to search clients by email`, error);
      return [];
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

  /** Phase 5 — borrower withdraws their own pending application. Used for
   * both explicit withdrawal and the system-driven 48h expiry sweep (the
   * expiry scheduler calls rejectLoan instead — see
   * loan-expiry.scheduler.ts — since "withdrawn" implies the client acted,
   * which isn't true for an auto-expiry). */
  async withdrawLoan(params: WithdrawFineractLoanParams): Promise<void> {
    await this.post(`/loans/${params.loanId}?command=withdrawnByApplicant`, {
      withdrawnOnDate: params.withdrawnOnDate,
      locale: 'en',
      dateFormat: 'dd MMMM yyyy',
    });
  }
}
