/**
 * The cooperative's money movements, as double entries.
 *
 * Accounts are named by GL CODE, never by database id. Codes are stable and
 * meaningful (10003 is Company Investment wherever you look); ids are
 * whatever order the chart happened to be created in, and hardcoding one
 * means a rebuilt chart posts silently to the wrong account. Resolving by
 * code fails loudly instead — which matters, because a misposted entry is
 * very hard to spot once it is in the books.
 *
 * The finance director picks a MOVEMENT, not a pair of accounts. Nobody
 * should have to know that an expense debits 50001 to record buying fuel.
 */
export interface TreasuryMovement {
  key: string;
  label: string;
  /** Shown under the label so the effect is legible without accounting. */
  description: string;
  debitCode: string;
  creditCode: string;
}

export const GL_CODES = {
  POOLED_FUND: '10001',
  COMPANY_INVESTMENT: '10003',
  DIRECTOR_CONTRIBUTION: '20001',
  MEMBER_SHARE: '30002',
  INVESTMENT_INCOME: '40002',
  OPERATIONAL_EXPENSE: '50001',
} as const;

export const TREASURY_MOVEMENTS: TreasuryMovement[] = [
  {
    key: 'INVESTMENT_MADE',
    label: 'Investment made',
    description:
      'Money placed into an asset or a business venture. Leaves the pooled ' +
      'fund and becomes an investment the cooperative holds.',
    debitCode: GL_CODES.COMPANY_INVESTMENT,
    creditCode: GL_CODES.POOLED_FUND,
  },
  {
    key: 'INVESTMENT_RETURN',
    label: 'Return received',
    description:
      'Profit or income from an investment. Increases the pooled fund and ' +
      'is recorded as investment income — kept separate from loan interest ' +
      'so the two can be judged apart.',
    debitCode: GL_CODES.POOLED_FUND,
    creditCode: GL_CODES.INVESTMENT_INCOME,
  },
  {
    key: 'INVESTMENT_SOLD',
    label: 'Investment sold or recovered',
    description:
      'The capital comes back. Reduces what the cooperative holds as ' +
      'investments and returns the money to the pooled fund. Record any ' +
      'profit above the original amount separately as a return.',
    debitCode: GL_CODES.POOLED_FUND,
    creditCode: GL_CODES.COMPANY_INVESTMENT,
  },
  {
    key: 'EXPENSE_PAID',
    label: 'Expense paid',
    description:
      'Money spent running the cooperative — fees, transport, supplies. ' +
      'Leaves the pooled fund and is recorded as an operational expense.',
    debitCode: GL_CODES.OPERATIONAL_EXPENSE,
    creditCode: GL_CODES.POOLED_FUND,
  },
  {
    key: 'SHARE_CAPITAL_TRANSFER',
    label: 'Move contributions to share capital',
    description:
      'Reclassifies accumulated member contributions from a liability into ' +
      'equity, so the balance sheet shows what members OWN rather than what ' +
      'they are owed. Fineract savings products can only post to a ' +
      'liability, so this transfer is how share capital reaches the books. ' +
      'Run it at period end, before a profit distribution.',
    debitCode: GL_CODES.DIRECTOR_CONTRIBUTION,
    creditCode: GL_CODES.MEMBER_SHARE,
  },
];

export function findMovement(key: string): TreasuryMovement | undefined {
  return TREASURY_MOVEMENTS.find((movement) => movement.key === key);
}
