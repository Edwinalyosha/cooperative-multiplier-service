import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FineractService } from '../fineract/fineract.service';
import {
  TREASURY_MOVEMENTS,
  findMovement,
  type TreasuryMovement,
} from './treasury.constants';

/**
 * The cooperative's own money: investments it holds, returns it receives,
 * expenses it pays.
 *
 * Fineract has no concept of an institutional investment — it models what
 * MEMBERS do with the institution, not what the institution does with its
 * money. So these are journal entries against the chart of accounts, which is
 * both the correct bookkeeping and what an auditor expects to see.
 *
 * Investments here are assets held and stakes in ventures, NOT lending. If
 * the cooperative ever places money expecting a repayment schedule, that
 * should be modelled as a Fineract loan instead, where schedules and interest
 * accrual come for free.
 */
@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(private readonly fineract: FineractService) {}

  /** The movements a finance director can record, for the form's dropdown. */
  listMovements() {
    return TREASURY_MOVEMENTS.map(({ key, label, description }) => ({
      key,
      label,
      description,
    }));
  }

  /**
   * Resolves a GL code to its account id, and refuses clearly if it is
   * missing.
   *
   * Codes rather than ids throughout: ids depend on the order the chart was
   * created, so hardcoding one means a rebuilt chart posts silently to the
   * wrong account. A missing code is loud, and loud is what you want when the
   * alternative is a misposted entry nobody notices for a year.
   */
  private resolveAccount(
    accounts: { id: number; glCode: string; name: string }[],
    glCode: string,
  ): { id: number; name: string } {
    const account = accounts.find((a) => a.glCode === glCode);
    if (!account) {
      throw new BadRequestException(
        `The chart of accounts has no account with code ${glCode}. It must ` +
          'exist before this movement can be recorded — add it in mifos-web ' +
          'under Accounting, Chart of Accounts.',
      );
    }
    return { id: account.id, name: account.name };
  }

  /**
   * Records a movement as a two-sided journal entry.
   *
   * Fineract rejects an entry whose debits and credits differ, so double
   * entry is enforced by the ledger rather than trusted to this code.
   */
  async record(params: {
    movementKey: string;
    amount: number;
    description: string;
    date?: string;
  }): Promise<{
    transactionId: string;
    movement: TreasuryMovement;
    debitAccount: string;
    creditAccount: string;
    amount: number;
  }> {
    const movement = findMovement(params.movementKey);
    if (!movement) {
      throw new BadRequestException(
        `Unknown movement "${params.movementKey}".`,
      );
    }

    if (!(params.amount > 0)) {
      throw new BadRequestException('Amount must be greater than zero.');
    }

    const accounts = await this.fineract.getGlAccounts();
    const debit = this.resolveAccount(accounts, movement.debitCode);
    const credit = this.resolveAccount(accounts, movement.creditCode);

    const transactionId = await this.fineract.createJournalEntry({
      debits: [{ glAccountId: debit.id, amount: params.amount }],
      credits: [{ glAccountId: credit.id, amount: params.amount }],
      comments: `${movement.label}: ${params.description}`,
      date: params.date ? new Date(params.date) : undefined,
    });

    this.logger.log(
      `${movement.label} ${params.amount}: Dr ${debit.name} / Cr ` +
        `${credit.name} (transaction ${transactionId}) — ${params.description}`,
    );

    return {
      transactionId,
      movement,
      debitAccount: debit.name,
      creditAccount: credit.name,
      amount: params.amount,
    };
  }

  /**
   * Reverses an entry recorded in error.
   *
   * The ledger is append-only: this posts an OFFSETTING entry rather than
   * deleting anything, and both remain visible. That is the point — an
   * accounting record that could be erased would be worth nothing. It also
   * means a reversal is itself a permanent fact, so it deserves a reason.
   */
  async reverse(transactionId: string, reason: string): Promise<void> {
    await this.fineract.reverseJournalEntry(
      transactionId,
      `Reversed: ${reason}`,
    );
    this.logger.warn(`Reversed journal transaction ${transactionId}: ${reason}`);
  }

  /**
   * Recent entries, paired into the postings a person recorded.
   *
   * Fineract stores each side as its own row; showing them raw would make one
   * investment look like two events. They are grouped by transactionId so the
   * list reads as "what happened", with both accounts named.
   */
  async recentEntries(limit = 40) {
    const entries = await this.fineract.getJournalEntries(limit * 2);

    const byTransaction = new Map<
      string,
      {
        transactionId: string;
        date: string | null;
        amount: number;
        comments: string | null;
        reversed: boolean;
        debit: string | null;
        credit: string | null;
      }
    >();

    for (const entry of entries) {
      const existing = byTransaction.get(entry.transactionId) ?? {
        transactionId: entry.transactionId,
        date: FineractService.parseFineractDate(entry.transactionDate),
        amount: Number(entry.amount ?? 0),
        comments: entry.comments ?? null,
        reversed: entry.reversed === true,
        debit: null,
        credit: null,
      };

      // entryType 2 is a debit, 1 a credit.
      if (entry.entryType?.id === 2) existing.debit = entry.glAccountName ?? null;
      else existing.credit = entry.glAccountName ?? null;

      byTransaction.set(entry.transactionId, existing);
    }

    return [...byTransaction.values()].slice(0, limit);
  }

  /**
   * Balances by account — the closest thing to a balance sheet.
   *
   * Sign convention: assets and expenses are debit-normal, everything else
   * credit-normal, so a "balance" here is what a reader expects rather than a
   * raw debit-minus-credit that shows liabilities as negative.
   */
  async balances() {
    const [accounts, entries] = await Promise.all([
      this.fineract.getGlAccounts(),
      this.fineract.getJournalEntries(1000),
    ]);

    return accounts
      .map((account) => {
        const mine = entries.filter(
          (entry) => entry.glAccountId === account.id && !entry.reversed,
        );
        const debits = mine
          .filter((entry) => entry.entryType?.id === 2)
          .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
        const credits = mine
          .filter((entry) => entry.entryType?.id === 1)
          .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);

        const typeId = account.type?.id ?? 0;
        const debitNormal = typeId === 1 || typeId === 5; // Asset, Expense

        return {
          glCode: account.glCode,
          name: account.name,
          type: account.type?.value ?? 'UNKNOWN',
          balance: debitNormal ? debits - credits : credits - debits,
          entries: mine.length,
        };
      })
      .filter((account) => account.entries > 0)
      .sort((a, b) => a.glCode.localeCompare(b.glCode));
  }
}
