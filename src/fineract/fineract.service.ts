import { HttpService } from '@nestjs/axios';
import { redactFineractError } from './fineract-error.util';
import { FineractSavingsWithTransactions } from './fineract.types';
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
  FineractSavingsAccountSummary,
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
      this.logger.error(
        `Fineract authentication call failed (non-401): ${redactFineractError(error)}`,
      );
      throw error;
    }
  }

  async getClient(clientId: number): Promise<FineractClient | null> {
    if (!this.isConfigured()) return null;
    try {
      return await this.get<FineractClient>(`/clients/${clientId}`);
    } catch (error) {
      this.logger.error(
        `Failed to fetch client ${clientId}: ${redactFineractError(error)}`,
      );
      return null;
    }
  }

  /**
   * Looks up Fineract Clients by exact email match, for the onboarding
   * flow's clientId-suggestion step (see ONBOARDING-AND-AUTH-PLAN.md and
   * PendingOnboarding) — this feeds a security-relevant "exactly one
   * match = safe to auto-suggest" decision, so exactness genuinely
   * matters here.
   *
   * ORIGINALLY used Fineract's `sqlSearch` list parameter (a raw SQL
   * WHERE-clause fragment) — REPLACED 2026-08-20 after finding live that
   * it does NOT do an exact `email_address = X` filter as its name
   * suggests. Confirmed directly: a Client with `emailAddress: null`
   * (John Doe) matched a `sqlSearch` query for a completely different,
   * unrelated email string. Whatever `sqlSearch` actually does under the
   * hood on this Fineract version, it's not literal/exact, which made
   * the "exactly one match" safety check untrustworthy — a false single
   * match could have silently offered the wrong Client.
   *
   * Fixed by not trusting Fineract's own filtering at all: fetch clients
   * and do the exact-match comparison ourselves, in code we control.
   * `limit=1000` is a stopgap, not real pagination — fine while this
   * Fineract instance holds a handful of Clients, but will silently miss
   * matches past that count if the member base grows. Revisit with
   * proper pagination before that becomes a real gap.
   */
  async searchClientsByEmail(email: string): Promise<FineractClient[]> {
    if (!this.isConfigured()) return [];
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await this.get<FineractClientListResponse>(
        `/clients?limit=1000`,
      );
      return (result.pageItems ?? []).filter(
        (c) => c.emailAddress?.trim().toLowerCase() === normalizedEmail,
      );
    } catch (error) {
      this.logger.error(
        `Failed to search clients by email: ${redactFineractError(error)}`,
      );
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
      this.logger.error(
        `Failed to fetch accounts for client ${clientId}: ${redactFineractError(error)}`,
      );
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
   * Deposits into a client's savings accounts on the given calendar dates,
   * inclusive. Used by the weekly contribution sweep.
   *
   * Fineract records transaction dates as CALENDAR dates with no time
   * component (`[2026, 8, 24]`), so the comparison is date-based rather than
   * timestamp-based. That sidesteps the timezone problem entirely for
   * matching — the caller decides which dates constitute the week in
   * Africa/Kampala terms, and those dates are what Fineract stored.
   *
   * Only genuine deposits count. Interest postings, fees, and withdrawals are
   * excluded: a member should not earn a contribution credit because the
   * cooperative posted interest to their account.
   */
  async getDepositsBetween(
    clientId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ date: string; amount: number }[]> {
    if (!this.isConfigured()) return [];

    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.savingsAccounts?.length) return [];

    // Contributions only. A deposit into ordinary savings is not the weekly
    // obligation, and counting it would let a member satisfy the contribution
    // requirement — and earn the multiplier improvement — with money they can
    // withdraw the next day.
    const contributionAccounts = this.accountsForProduct(
      accounts.savingsAccounts,
      this.contributionsProductId,
    );

    const deposits: { date: string; amount: number }[] = [];

    for (const account of contributionAccounts) {
      if (!account.id) continue;
      try {
        const detail = await this.get<FineractSavingsWithTransactions>(
          `/savingsaccounts/${account.id}?associations=transactions`,
        );
        for (const tx of detail.transactions ?? []) {
          if (!tx.transactionType?.deposit) continue;
          const date = FineractService.parseFineractDate(tx.date);
          if (!date || date < startDate || date > endDate) continue;
          deposits.push({ date, amount: Number(tx.amount) || 0 });
        }
      } catch (error) {
        this.logger.error(
          `Failed to fetch transactions for savings account ${account.id}: ` +
            redactFineractError(error),
        );
        // Deliberately rethrown: the caller must not mistake "we could not
        // read the account" for "no deposits were made" and mark a member
        // late for a contribution they actually paid.
        throw error;
      }
    }

    return deposits;
  }

  /**
   * Fineract returns dates as `[year, month, day]` with a 1-based month.
   * Normalised to `YYYY-MM-DD` for string comparison.
   */
  static parseFineractDate(value: unknown): string | null {
    if (typeof value === 'string') return value.slice(0, 10);
    if (!Array.isArray(value) || value.length < 3) return null;
    const [y, m, d] = value as number[];
    if (![y, m, d].every((n) => Number.isFinite(n))) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /**
   * Selects the savings accounts belonging to one product.
   *
   * When no product id is configured this returns every account, preserving
   * the pre-2026-08-29 behaviour in which all savings were contributions.
   * That is the safe degradation: a missing or mistyped product id falls back
   * to the old single-pot model rather than reporting every member as having
   * contributed nothing, which would zero their borrowing limits.
   */
  private accountsForProduct(
    accounts: FineractSavingsAccountSummary[],
    productId: number | undefined,
  ): FineractSavingsAccountSummary[] {
    if (productId == null) return accounts;
    return accounts.filter((account) => account.productId === productId);
  }

  /** Sums balances, falling back to a per-account fetch where the list
   * response omits one. */
  private async sumBalances(
    accounts: FineractSavingsAccountSummary[],
  ): Promise<number> {
    let total = 0;
    for (const account of accounts) {
      const inline = account.accountBalance ?? account.availableBalance;
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

  /**
   * The member's CONTRIBUTIONS balance — their ownership stake, built from the
   * weekly obligation. This is what the multiplier leverages 1-5x into a
   * borrowing limit and what any later profit split is apportioned by.
   *
   * Not the same as their savings: see getSavingsBalance.
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

    return this.sumBalances(
      this.accountsForProduct(
        accounts.savingsAccounts,
        this.contributionsProductId,
      ),
    );
  }

  /**
   * The member's ordinary SAVINGS balance — voluntary, liquid, conferring no
   * ownership. Adds to the borrowing limit at face value.
   *
   * Returns 0 when no savings product is configured, because in that world
   * every account is a contribution and counting it here as well would let
   * the same shilling raise a member's limit twice.
   */
  async getSavingsBalance(clientId: number): Promise<number | null> {
    if (!this.isConfigured()) return null;
    if (this.savingsProductId == null) return 0;

    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.savingsAccounts?.length) return 0;

    return this.sumBalances(
      this.accountsForProduct(accounts.savingsAccounts, this.savingsProductId),
    );
  }

  /**
   * The id of the member's ordinary savings account — the one a collateral
   * hold is placed on. Null when they have none, which is normal: savings are
   * voluntary.
   */
  async getSavingsAccountId(clientId: number): Promise<number | null> {
    if (!this.isConfigured() || this.savingsProductId == null) return null;

    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.savingsAccounts?.length) return null;

    const match = this.accountsForProduct(
      accounts.savingsAccounts,
      this.savingsProductId,
    );
    return match[0]?.id ?? null;
  }

  /**
   * Freezes part of a member's savings as collateral for a loan.
   *
   * Verified against this instance on 2026-08-30: the command takes
   * `transactionAmount` (NOT `amount`, which is rejected as unsupported) and
   * a `reasonForBlock` drawn from the SavingsTransactionFreezeReasons code.
   * Returns the hold transaction id, which is the handle releaseSavingsAmount
   * needs later — so it must be persisted, not recomputed.
   */
  async holdSavingsAmount(params: {
    savingsAccountId: number;
    amount: number;
    transactionDate?: Date;
  }): Promise<number> {
    const reasonId = this.config.get<number>('fineract.savingsHoldReasonId');
    if (reasonId == null) {
      throw new Error(
        'FINERACT_SAVINGS_HOLD_REASON_ID is not configured; refusing to place ' +
          'a savings hold without a recorded reason.',
      );
    }

    const response = await this.post<{ resourceId: number }>(
      `/savingsaccounts/${params.savingsAccountId}/transactions?command=holdAmount`,
      {
        transactionAmount: params.amount,
        reasonForBlock: reasonId,
        transactionDate: FineractService.formatFineractDate(
          params.transactionDate ?? new Date(),
        ),
        locale: 'en',
        dateFormat: 'dd MMMM yyyy',
      },
    );

    return response.resourceId;
  }

  /** Lifts a hold placed by holdSavingsAmount, returning the money to the
   * member's available balance. */
  async releaseSavingsAmount(params: {
    savingsAccountId: number;
    holdTransactionId: number;
  }): Promise<void> {
    await this.post(
      `/savingsaccounts/${params.savingsAccountId}/transactions/` +
        `${params.holdTransactionId}?command=releaseAmount`,
      {},
    );
  }

  /**
   * The member's CONTRIBUTIONS account — where the weekly obligation is paid.
   *
   * Distinct from getSavingsAccountId: money in the wrong one earns no
   * multiplier, is not leveraged into the borrowing limit, and does not count
   * toward the profit split. Null when they have none, which is a setup
   * error rather than a normal state.
   */
  async getContributionsAccountId(clientId: number): Promise<number | null> {
    if (!this.isConfigured()) return null;

    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.savingsAccounts?.length) return null;

    const match = this.accountsForProduct(
      accounts.savingsAccounts,
      this.contributionsProductId,
    );
    return match[0]?.id ?? null;
  }

  /**
   * How money may be recorded as arriving — cash, mobile money, transfer.
   *
   * Fineract requires one on every deposit, and it is what makes the ledger
   * auditable at reconciliation time: "how did this arrive" is a real
   * question later.
   */
  async getPaymentTypes(): Promise<
    { id: number; name: string; isCashPayment: boolean }[]
  > {
    const types = await this.get<
      {
        id: number;
        name: string;
        isCashPayment?: boolean;
        isSystemDefined?: boolean;
        position?: number;
      }[]
    >('/paymenttypes');

    return types
      // System-defined types are Fineract's own internal ones — "Repayment
      // Adjustment Chargeback" and the like. Offering them for a member's
      // weekly contribution would be nonsense, and picking one would put a
      // misleading label on a real transaction.
      .filter((type) => !type.isSystemDefined)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((type) => ({
        id: type.id,
        name: type.name,
        isCashPayment: type.isCashPayment ?? false,
      }));
  }

  /**
   * Records money arriving on a savings account.
   *
   * Shape verified against the live instance 2026-08-30, after two rejected
   * attempts: it takes `transactionAmount` (not `amount`) and `paymentTypeId`
   * is MANDATORY — a deposit with no payment type is refused outright.
   * Reversible via undoSavingsTransaction, which was verified at the same
   * time; a finance manager will mistype an amount eventually.
   */
  async depositToSavings(params: {
    savingsAccountId: number;
    amount: number;
    paymentTypeId: number;
    date?: Date;
    note?: string;
  }): Promise<number> {
    const response = await this.post<{ resourceId: number }>(
      `/savingsaccounts/${params.savingsAccountId}/transactions?command=deposit`,
      {
        transactionAmount: params.amount,
        paymentTypeId: params.paymentTypeId,
        transactionDate: FineractService.formatFineractDate(
          params.date ?? new Date(),
        ),
        locale: 'en',
        dateFormat: 'dd MMMM yyyy',
        ...(params.note ? { note: params.note } : {}),
      },
    );

    return response.resourceId;
  }

  /** Reverses a savings transaction — the correction path for a mistyped
   * deposit. */
  async undoSavingsTransaction(params: {
    savingsAccountId: number;
    transactionId: number;
  }): Promise<void> {
    await this.post(
      `/savingsaccounts/${params.savingsAccountId}/transactions/` +
        `${params.transactionId}?command=undo`,
      {},
    );
  }

  private get contributionsProductId(): number | undefined {
    return this.config.get<number>('fineract.contributionsProductId');
  }

  private get savingsProductId(): number | undefined {
    return this.config.get<number>('fineract.savingsProductId');
  }

  async getActiveLoanIds(clientId: number): Promise<number[]> {
    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.loanAccounts?.length) return [];

    return accounts.loanAccounts
      .filter((loan) => loan.status?.active !== false)
      .map((loan) => loan.id);
  }

  /**
   * Total still owed across a member's active loans, interest included.
   *
   * This is what reduces their borrowing headroom, so it is deliberately the
   * BALANCE rather than the original principal: a member who borrowed 80,000
   * owes 90,381 once interest is applied, and the fund is exposed for the
   * larger figure.
   *
   * Returns 0 for a member with no loans. Throws if Fineract cannot be read —
   * callers must not mistake an outage for "owes nothing".
   */
  async getOutstandingLoanBalance(clientId: number): Promise<number> {
    const accounts = await this.getClientAccounts(clientId);
    if (!accounts?.loanAccounts?.length) return 0;

    return accounts.loanAccounts
      .filter((loan) => loan.status?.active !== false)
      .reduce((total, loan) => total + Number(loan.loanBalance ?? 0), 0);
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
