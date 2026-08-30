import { ConfigService } from '@nestjs/config';
import { ContributionSweepService } from './contribution-sweep.service';
import { ContributionLedgerService } from './contribution-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * What the SWEEP is responsible for, now that the ledger owns the verdict.
 *
 * The sweep decides WHO to assess and hands the ledger a number. Whether that
 * number satisfies the week, whether a penalty is charged, and whether it is
 * charged twice are the ledger's business and are tested in
 * contribution-ledger.spec.ts.
 *
 * What is left here still matters, because each case is one where a wrong
 * answer costs a member money: someone assessed for a week before they
 * joined, and — the worst — someone marked late because Fineract was briefly
 * unreachable.
 */
describe('ContributionSweepService', () => {
  const MINIMUM = 20000;
  /** A Monday 09:00 in Kampala; the week 24–30 Aug 2026 has just closed. */
  const MONDAY = new Date('2026-08-31T06:00:00Z');

  let deposits: { date: string; amount: number }[];
  let depositsThrow: Error | null;
  let assessed: { clientId: number; deposits: number; amountDue: number }[];
  let assessment: { satisfied: boolean; penaltyCharged: boolean };

  function build(directors = [{ clientId: 2, createdAt: new Date('2026-01-01') }]) {
    deposits = [];
    depositsThrow = null;
    assessed = [];
    assessment = { satisfied: true, penaltyCharged: false };

    const prisma = {
      directorMultiplier: { findMany: jest.fn(async () => directors) },
    } as unknown as PrismaService;

    const fineract = {
      isConfigured: () => true,
      getDepositsBetween: jest.fn(async () => {
        if (depositsThrow) throw depositsThrow;
        return deposits;
      }),
    } as unknown as FineractService;

    const ledger = {
      assessPeriod: jest.fn(
        async (
          clientId: number,
          _period: unknown,
          amountDue: number,
          total: number,
        ) => {
          assessed.push({ clientId, deposits: total, amountDue });
          return {
            clientId,
            periodStart: '2026-08-24',
            amountDue,
            amountPaid: total,
            satisfied: assessment.satisfied,
            penaltyCharged: assessment.penaltyCharged,
            arrearsCleared: [],
            arrearsRemaining: 0,
          };
        },
      ),
    } as unknown as ContributionLedgerService;

    const config = {
      get: (key: string) =>
        key === 'multiplier.weeklyContributionMinimum' ? MINIMUM : undefined,
    } as unknown as ConfigService;

    return new ContributionSweepService(prisma, fineract, ledger, config);
  }

  describe('what it hands the ledger', () => {
    it('sums every deposit in the week', async () => {
      const service = build();
      deposits = [
        { date: '2026-08-25', amount: 12000 },
        { date: '2026-08-28', amount: 8000 },
      ];
      await service.sweep(MONDAY);
      expect(assessed[0].deposits).toBe(20000);
    });

    it('passes the CURRENT weekly amount, for the ledger to snapshot', async () => {
      // The amount changes over time and each week must keep the figure that
      // applied when it closed — otherwise raising it turns paid weeks into
      // arrears retroactively.
      const service = build();
      await service.sweep(MONDAY);
      expect(assessed[0].amountDue).toBe(MINIMUM);
    });

    it('assesses a member who deposited nothing', async () => {
      // The whole reason this is a scheduled sweep and not a webhook: money
      // arriving can fire an event, but nothing fires when it does not, so
      // non-participation would score better than late participation.
      const service = build();
      deposits = [];
      await service.sweep(MONDAY);
      expect(assessed).toHaveLength(1);
      expect(assessed[0].deposits).toBe(0);
    });
  });

  describe('counting the outcome', () => {
    it('reports a satisfied week as on time', async () => {
      const service = build();
      assessment = { satisfied: true, penaltyCharged: false };
      const result = await service.sweep(MONDAY);
      expect(result.onTime).toBe(1);
    });

    it('reports a newly penalised week as late', async () => {
      const service = build();
      assessment = { satisfied: false, penaltyCharged: true };
      const result = await service.sweep(MONDAY);
      expect(result.late).toBe(1);
    });

    it('reports an already-penalised week as already processed, not late again', async () => {
      // A re-run must not read as a second missed week. The ledger refuses to
      // charge twice; the sweep must not report it as a fresh late either.
      const service = build();
      assessment = { satisfied: false, penaltyCharged: false };
      const result = await service.sweep(MONDAY);
      expect(result.skippedAlreadyProcessed).toBe(1);
      expect(result.late).toBe(0);
    });
  });

  describe('members who joined mid-period', () => {
    it('skips someone created during the week just closed', async () => {
      const service = build([{ clientId: 9, createdAt: new Date('2026-08-27') }]);
      const result = await service.sweep(MONDAY);
      expect(result.skippedTooNew).toBe(1);
      expect(assessed).toHaveLength(0);
    });

    it('assesses someone who was present for the whole week', async () => {
      const service = build([{ clientId: 9, createdAt: new Date('2026-08-24') }]);
      deposits = [{ date: '2026-08-26', amount: MINIMUM }];
      const result = await service.sweep(MONDAY);
      expect(result.onTime).toBe(1);
    });
  });

  describe('when Fineract cannot be read', () => {
    it('does NOT assess the member at all', async () => {
      // The most important test here. Silence from Fineract is not evidence a
      // member failed to pay, and a wrongly-applied penalty changes the real
      // interest rate on their next loan.
      const service = build();
      depositsThrow = new Error('ECONNREFUSED');
      const result = await service.sweep(MONDAY);
      expect(result.failed).toBe(1);
      expect(result.late).toBe(0);
      expect(assessed).toHaveLength(0);
    });

    it('carries on to the remaining members', async () => {
      const service = build([
        { clientId: 1, createdAt: new Date('2026-01-01') },
        { clientId: 2, createdAt: new Date('2026-01-01') },
      ]);
      depositsThrow = new Error('ECONNREFUSED');
      const result = await service.sweep(MONDAY);
      expect(result.failed).toBe(2);
    });
  });

  describe('when Fineract is not configured at all', () => {
    it('sweeps nobody rather than marking everyone late', async () => {
      const prisma = {
        directorMultiplier: { findMany: jest.fn() },
      } as unknown as PrismaService;
      const service = new ContributionSweepService(
        prisma,
        { isConfigured: () => false } as unknown as FineractService,
        { assessPeriod: jest.fn() } as unknown as ContributionLedgerService,
        { get: () => MINIMUM } as unknown as ConfigService,
      );

      const result = await service.sweep(MONDAY);
      expect(result.late).toBe(0);
      expect(result.onTime).toBe(0);
      expect(prisma.directorMultiplier.findMany).not.toHaveBeenCalled();
    });
  });

  it('reports the period it assessed', async () => {
    const service = build();
    const result = await service.sweep(MONDAY);
    expect(result.period).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-08-30',
    });
  });
});
