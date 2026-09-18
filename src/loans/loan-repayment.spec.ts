import { LoansService } from './loans.service';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * Recording money against a loan, and taking it back off.
 *
 * The property that matters most here is a NEGATIVE one: recording a
 * repayment must not record a multiplier event. Timeliness is read from
 * Fineract's schedule by the repayment sweep. An `onTime` flag supplied by
 * whoever accepted the cash verified nothing, and under it a member could
 * repay months late at no cost — that was MLTD-P009, and half the incentive
 * system sat inert because of it. Money here, verdict there.
 *
 * The undo is tested alongside rather than after, for the same reason it was
 * built alongside: the ledger is append-only, so a payment path whose first
 * mistyped amount is permanent is worse than no payment path.
 */
describe('LoansService — loan repayments', () => {
  const LOAN_ID = 11;

  let service: LoansService;
  let fineract: {
    repayLoan: jest.Mock;
    undoLoanRepayment: jest.Mock;
    getActiveLoans: jest.Mock;
  };
  let multiplier: { processEvent: jest.Mock; refreshEligibility: jest.Mock };

  beforeEach(() => {
    fineract = {
      repayLoan: jest.fn().mockResolvedValue(144),
      undoLoanRepayment: jest.fn().mockResolvedValue(undefined),
      getActiveLoans: jest.fn().mockResolvedValue([
        { id: LOAN_ID, accountNo: '000000011', balance: 56488.15 },
      ]),
    };

    multiplier = {
      processEvent: jest.fn(),
      refreshEligibility: jest.fn(),
    };

    service = new LoansService(
      multiplier as unknown as MultiplierService,
      {} as MultiplierQueueService,
      fineract as unknown as FineractService,
      {} as PrismaService,
    );
  });

  it('posts the repayment to Fineract and returns the transaction id', async () => {
    const result = await service.recordLoanRepayment(LOAN_ID, {
      amount: 20000,
      paymentTypeId: 1,
      date: '2026-09-17',
      note: 'cash at the meeting',
    });

    expect(result).toEqual({
      transactionId: 144,
      loanId: LOAN_ID,
      amount: 20000,
    });
    expect(fineract.repayLoan).toHaveBeenCalledWith({
      loanId: LOAN_ID,
      amount: 20000,
      paymentTypeId: 1,
      date: new Date('2026-09-17'),
      note: 'cash at the meeting',
    });
  });

  it('records NO multiplier event — timeliness is the sweep\'s to decide', async () => {
    await service.recordLoanRepayment(LOAN_ID, {
      amount: 20000,
      paymentTypeId: 1,
    });

    // The whole of MLTD-P009 in one assertion. If this ever starts failing
    // because someone added an `onTime` argument here, read that problem
    // entry before making it pass.
    expect(multiplier.processEvent).not.toHaveBeenCalled();
  });

  it('leaves the date to Fineract when none is given', async () => {
    await service.recordLoanRepayment(LOAN_ID, {
      amount: 500,
      paymentTypeId: 2,
    });

    expect(fineract.repayLoan).toHaveBeenCalledWith(
      expect.objectContaining({ date: undefined, note: undefined }),
    );
  });

  it('propagates a Fineract failure instead of reporting success', async () => {
    fineract.repayLoan.mockRejectedValue(new Error('date before disbursement'));

    // Money either moved or it did not. Swallowing this would show the
    // operator a success for a payment Fineract never accepted, and they
    // would have no reason to take the cash again.
    await expect(
      service.recordLoanRepayment(LOAN_ID, { amount: 20000, paymentTypeId: 1 }),
    ).rejects.toThrow('date before disbursement');
  });

  it('undoes a repayment by loan and transaction', async () => {
    await service.undoRepayment(LOAN_ID, 144);

    expect(fineract.undoLoanRepayment).toHaveBeenCalledWith({
      loanId: LOAN_ID,
      transactionId: 144,
    });
  });

  it('lists active loans with their balances', async () => {
    // The operator sees the balance before typing an amount: posting against
    // the wrong loan is the easiest mistake here, and an id alone gives
    // nothing to recognise.
    await expect(service.listActiveLoans(4)).resolves.toEqual([
      { id: LOAN_ID, accountNo: '000000011', balance: 56488.15 },
    ]);
    expect(fineract.getActiveLoans).toHaveBeenCalledWith(4);
  });
});
