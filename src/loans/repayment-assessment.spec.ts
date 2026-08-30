import { RepaymentAssessmentService } from './repayment-assessment.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { MULTIPLIER_STEPS } from '../multiplier/multiplier-steps.constants';

/**
 * Whether a loan installment was repaid on time.
 *
 * Closes MLTD-P009: until this existed, repayment behaviour never moved a
 * member's multiplier at all. Half the incentive system was inert — a member
 * could repay months late at no cost.
 *
 * The rule is READ from Fineract's schedule, never inferred from what was
 * paid. The tests that matter most are the ones where a wrong answer costs
 * someone money: an installment judged before it was due, one judged twice,
 * and — the worst — one marked late because Fineract could not be read.
 */
describe('repayment assessment', () => {
  const CLIENT = 2;
  const LOAN = 10;
  /** "Today" for every test. */
  const NOW = new Date('2026-08-30T09:00:00Z');

  let schedule: {
    installment: number;
    dueDate: string;
    metOn: string | null;
    complete: boolean;
    outstanding: number;
  }[];
  let existing: Set<string>;
  let events: { clientId: number; eventType: MultiplierEventType }[];
  let scheduleThrow: Error | null;
  /** Stand-in for the RepaymentAssessment table. */
  let rows: {
    id: number;
    installmentNumber: number;
    outcome: string;
    clearedAt: Date | null;
  }[];

  function build(directors = [{ clientId: CLIENT }]) {
    schedule = [];
    existing = new Set();
    events = [];
    rows = [];
    scheduleThrow = null;

    const prisma = {
      directorMultiplier: { findMany: jest.fn(async () => directors) },
      repaymentAssessment: {
        create: jest.fn(async (args: never) => {
          const a = args as unknown as {
            data: {
              fineractLoanId: number;
              installmentNumber: number;
              outcome: string;
            };
          };
          const key = `${a.data.fineractLoanId}:${a.data.installmentNumber}`;
          // Stands in for the unique constraint — the actual guarantee.
          if (existing.has(key)) throw new Error('duplicate key');
          existing.add(key);
          rows.push({
            id: rows.length + 1,
            installmentNumber: a.data.installmentNumber,
            outcome: a.data.outcome,
            clearedAt: null,
          });
          return a.data;
        }),
        // Late installments not yet credited with the catch-up reward.
        findMany: jest.fn(async () =>
          rows.filter((r) => r.outcome === 'LATE' && r.clearedAt === null),
        ),
        updateMany: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: { id?: number; clearedAt?: null };
            data: { clearedAt?: Date; stepApplied?: number };
          };
          const row = rows.find((r) => r.id === a.where.id);
          if (!row) return { count: 0 };
          if ('clearedAt' in a.where && row.clearedAt !== null) {
            return { count: 0 };
          }
          if (a.data.clearedAt) row.clearedAt = a.data.clearedAt;
          return { count: 1 };
        }),
      },
    } as unknown as PrismaService;

    const fineract = {
      isConfigured: () => true,
      getActiveLoanIds: jest.fn(async () => [LOAN]),
      getRepaymentSchedule: jest.fn(async () => {
        if (scheduleThrow) throw scheduleThrow;
        return schedule;
      }),
    } as unknown as FineractService;

    const multiplier = {
      processEvent: jest.fn(
        async (clientId: number, eventType: MultiplierEventType) => {
          events.push({ clientId, eventType });
          return { stepAmount: MULTIPLIER_STEPS[eventType] };
        },
      ),
      reversePenalty: jest.fn(async () => undefined),
    } as unknown as MultiplierService;

    return new RepaymentAssessmentService(prisma, fineract, multiplier);
  }

  const count = (type: MultiplierEventType) =>
    events.filter((e) => e.eventType === type).length;

  function installment(
    n: number,
    dueDate: string,
    metOn: string | null = null,
  ) {
    return {
      installment: n,
      dueDate,
      metOn,
      complete: metOn !== null,
      outstanding: metOn === null ? 20000 : 0,
    };
  }

  describe('judging an installment', () => {
    it('rewards one paid before its due date', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', '2026-08-18')];

      const result = await service.sweep(NOW);
      expect(result.assessedOnTime).toBe(1);
      expect(count(MultiplierEventType.ON_TIME_REPAYMENT)).toBe(1);
    });

    it('rewards one paid exactly ON the due date', async () => {
      // The boundary. Paying on the day you were asked to pay is on time.
      const service = build();
      schedule = [installment(1, '2026-08-20', '2026-08-20')];

      expect((await service.sweep(NOW)).assessedOnTime).toBe(1);
    });

    it('penalises one paid a day late', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', '2026-08-21')];

      const result = await service.sweep(NOW);
      expect(result.assessedLate).toBe(1);
      expect(count(MultiplierEventType.LATE_REPAYMENT)).toBe(1);
    });

    it('penalises one that is overdue and still unpaid', async () => {
      // The case a payment-triggered webhook can never see: nothing arrived,
      // so nothing fires, and not paying would score better than paying late.
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];

      expect((await service.sweep(NOW)).assessedLate).toBe(1);
    });
  });

  describe('installments that are not yet due', () => {
    it('does not judge one due in the future', async () => {
      // A member with days left has not failed at anything.
      const service = build();
      schedule = [installment(1, '2026-09-15', null)];

      const result = await service.sweep(NOW);
      expect(result.skippedNotDue).toBe(1);
      expect(events).toHaveLength(0);
    });

    it('judges one due TODAY', async () => {
      // Due today and unpaid is late — the day has arrived.
      const service = build();
      schedule = [installment(1, '2026-08-30', null)];

      expect((await service.sweep(NOW)).assessedLate).toBe(1);
    });

    it('judges only the due installments of a mixed schedule', async () => {
      const service = build();
      schedule = [
        installment(1, '2026-07-20', '2026-07-19'),
        installment(2, '2026-08-20', null),
        installment(3, '2026-09-20', null),
        installment(4, '2026-10-20', null),
      ];

      const result = await service.sweep(NOW);
      expect(result.assessedOnTime).toBe(1);
      expect(result.assessedLate).toBe(1);
      expect(result.skippedNotDue).toBe(2);
    });
  });

  describe('assessed exactly once — the guarantee', () => {
    it('does not penalise the same installment on a second run', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];

      await service.sweep(NOW);
      await service.sweep(NOW);
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT)).toBe(1);
    });

    it('reports a repeat as already assessed, not as a fresh late', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];

      await service.sweep(NOW);
      const second = await service.sweep(NOW);

      expect(second.skippedAlreadyAssessed).toBe(1);
      expect(second.assessedLate).toBe(0);
    });

    it('does not re-judge an installment that was paid after being marked late', async () => {
      // Paying afterwards clears the debt with Fineract but does not undo the
      // lateness. Re-judging would hand out a reward for a missed payment.
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];
      await service.sweep(NOW);

      schedule = [installment(1, '2026-08-20', '2026-08-29')];
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT)).toBe(1);
      expect(count(MultiplierEventType.ON_TIME_REPAYMENT)).toBe(0);
    });
  });

  describe('paying off a late installment', () => {
    it('awards the catch-up reward once it is paid', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];
      await service.sweep(NOW);

      schedule = [installment(1, '2026-08-20', '2026-08-29')];
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT_CLEARED)).toBe(1);
    });

    it('awards it exactly once, however often the sweep runs', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];
      await service.sweep(NOW);

      schedule = [installment(1, '2026-08-20', '2026-08-29')];
      await service.sweep(NOW);
      await service.sweep(NOW);
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT_CLEARED)).toBe(1);
    });

    it('does not award it while the installment is still unpaid', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', null)];
      await service.sweep(NOW);
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT_CLEARED)).toBe(0);
    });

    it('never awards it for an installment that was paid on time', async () => {
      const service = build();
      schedule = [installment(1, '2026-08-20', '2026-08-19')];
      await service.sweep(NOW);
      await service.sweep(NOW);

      expect(count(MultiplierEventType.LATE_REPAYMENT_CLEARED)).toBe(0);
    });

    it('keeps being late worse than never being late', () => {
      // The ordering the whole reward depends on. If the catch-up ever
      // exceeded the penalty, deliberately missing a payment and settling it
      // later would be a net GAIN. Asserted against the money, so a future
      // edit has to disagree with the arithmetic and not just a table.
      const onTime = MULTIPLIER_STEPS[MultiplierEventType.ON_TIME_REPAYMENT];
      const late = MULTIPLIER_STEPS[MultiplierEventType.LATE_REPAYMENT];
      const cleared =
        MULTIPLIER_STEPS[MultiplierEventType.LATE_REPAYMENT_CLEARED];

      const lateThenPaid = late + cleared;

      expect(lateThenPaid).toBeGreaterThan(0);        // still a net loss
      expect(lateThenPaid).toBeLessThan(late);        // better than never paying
      expect(lateThenPaid).toBeGreaterThan(onTime);   // worse than paying on time
    });
  });

  describe('when Fineract cannot be read', () => {
    it('does NOT mark anyone late', async () => {
      // The most important test here. Silence is not evidence of
      // non-payment, and a wrongly-applied penalty moves a real interest rate.
      const service = build();
      scheduleThrow = new Error('ECONNREFUSED');

      const result = await service.sweep(NOW);
      expect(result.failed).toBe(1);
      expect(result.assessedLate).toBe(0);
      expect(events).toHaveLength(0);
    });

    it('carries on to the remaining members', async () => {
      const service = build([{ clientId: 1 }, { clientId: 2 }]);
      scheduleThrow = new Error('ECONNREFUSED');

      expect((await service.sweep(NOW)).failed).toBe(2);
    });
  });

  describe('when Fineract is not configured at all', () => {
    it('assesses nobody rather than marking everyone late', async () => {
      const prisma = {
        directorMultiplier: { findMany: jest.fn() },
      } as unknown as PrismaService;
      const service = new RepaymentAssessmentService(
        prisma,
        { isConfigured: () => false } as unknown as FineractService,
        { processEvent: jest.fn() } as unknown as MultiplierService,
      );

      const result = await service.sweep(NOW);
      expect(result.assessedLate).toBe(0);
      expect(prisma.directorMultiplier.findMany).not.toHaveBeenCalled();
    });
  });
});
