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
} from './fineract.types';

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
}
