import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FineractService } from '../fineract/fineract.service';
import { describeFineractError } from '../fineract/fineract-error.util';
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
    // A product-generated entry cannot be hand-reversed, and should not be:
    // it belongs to a loan disbursement or a savings deposit, and undoing it
    // means undoing THAT transaction on its own account, not editing the
    // ledger underneath it. Fineract refuses, and without this the refusal
    // reached the finance manager as a bare 500.
    const entry = await this.findEntry(transactionId);

    if (entry?.reversed) {
      throw new BadRequestException(
        `Transaction ${transactionId} has already been reversed. The ` +
          'offsetting entry is already in the books.',
      );
    }

    if (entry && !this.isOwnRecording(entry.comments)) {
      throw new BadRequestException(
        `Transaction ${transactionId} was not recorded here — it came from a ` +
          'loan, a savings account, an accrual, or was entered directly in ' +
          'mifos-web. Undo it where it was made; the books cannot be edited ' +
          'underneath it.',
      );
    }

    try {
      await this.fineract.reverseJournalEntry(
        transactionId,
        `Reversed: ${reason}`,
      );
    } catch (error) {
      throw new BadRequestException(
        `Fineract would not reverse transaction ${transactionId}` +
          describeFineractError(error),
      );
    }

    this.logger.warn(`Reversed journal transaction ${transactionId}: ${reason}`);
  }

  /**
   * Was this recorded HERE, through the Books tab?
   *
   * `manualEntry` alone is not enough. Fineract sets it on anything not
   * generated by a product — including a reversal, and including anything
   * somebody typed into mifos-web by hand. It has no field meaning "I am a
   * reversal", so the reversal of an investment looks exactly like an
   * investment.
   *
   * Our own entries are identifiable because we write their comments:
   * `"<Movement label>: <description>"` on a recording, `"Reversed: …"` on a
   * reversal. Matching that prefix means the Books tab offers to reverse only
   * what it recorded — not a reversal, not an accrual, and not an entry made
   * elsewhere. That is a narrower rule than "is it manual", and the right
   * one: this screen is not a general ledger editor.
   */
  private isOwnRecording(comments: string | null | undefined): boolean {
    if (!comments) return false;
    return TREASURY_MOVEMENTS.some((movement) =>
      comments.startsWith(`${movement.label}:`),
    );
  }

  private async findEntry(transactionId: string) {
    const entries = await this.fineract.getJournalEntries(500);
    return entries.find((e) => e.transactionId === transactionId);
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
        reversible: boolean;
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
        // Only what the Books tab recorded can be reversed here. A reversal
        // is itself manualEntry:true, so "is it manual" would offer to
        // reverse a reversal — see isOwnRecording.
        reversible:
          entry.reversed !== true && this.isOwnRecording(entry.comments),
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
        // EVERY entry, reversed ones included.
        //
        // A Fineract reversal ADDS an offsetting entry and flags one of the
        // pair. Filtering the flagged one out leaves its opposite standing
        // alone, so a reversal either does nothing or counts twice instead of
        // cancelling — which is how Pooled Fund read -14,951,000 when it
        // should have read -14,950,000.
        //
        // Including both is not a workaround: cancellation is what
        // double-entry is FOR, and it is the only version that stays correct
        // whichever side Fineract chooses to flag.
        const mine = entries.filter((entry) => entry.glAccountId === account.id);
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
