import { ConfigService } from '@nestjs/config';
import { ContributionSweepService } from './contribution-sweep.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';

/**
 * The sweep decides, once a week, whether each member met their obligation.
 * Getting it wrong moves a real interest rate, so the cases that matter most
 * are the ones where a wrong answer costs someone money: a member penalised
 * twice, a member penalised for a week before they joined, and — the worst —
 * a member penalised because Fineract was briefly unreachable.
 */
describe('ContributionSweepService', () => {
  const MINIMUM = 20000;
  /** A Monday 09:00 in Kampala; the week 24–30 Aug 2026 has just closed. */
  const MONDAY = new Date('2026-08-31T06:00:00Z');

  let deposits: { date: string; amount: number }[];
  let historyRows: unknown[];
  let processed: { clientId: number; eventType: MultiplierEventType }[];
  let depositsThrow: Error | null;

  function build(directors = [{ clientId: 2, createdAt: new Date('2026-01-01') }]) {
    deposits = [];
    historyRows = [];
    processed = [];
    depositsThrow = null;

    const prisma = {
      directorMultiplier: { findMany: jest.fn(async () => directors) },
      multiplierHistory: {
        findFirst: jest.fn(async () => historyRows[0] ?? null),
      },
    } as unknown as PrismaService;

    const fineract = {
      isConfigured: () => true,
      getDepositsBetween: jest.fn(async () => {
        if (depositsThrow) throw depositsThrow;
        return deposits;
      }),
    } as unknown as FineractService;

    const multiplier = {
      processEvent: jest.fn(async (clientId: number, eventType: MultiplierEventType) => {
        processed.push({ clientId, eventType });
      }),
    } as unknown as MultiplierService;

    const config = {
      get: (key: string) =>
        key === 'multiplier.weeklyContributionMinimum' ? MINIMUM : undefined,
    } as unknown as ConfigService;

    return new ContributionSweepService(prisma, fineract, multiplier, config);
  }

  describe('meeting the minimum', () => {
    it('marks a member on time when they deposit the full amount', async () => {
      const service = build();
      deposits = [{ date: '2026-08-26', amount: MINIMUM }];
      const result = await service.sweep(MONDAY);
      expect(result.onTime).toBe(1);
      expect(processed[0].eventType).toBe(
        MultiplierEventType.ON_TIME_CONTRIBUTION,
      );
    });

    it('sums several deposits across the week', async () => {
      const service = build();
      deposits = [
        { date: '2026-08-25', amount: 12000 },
        { date: '2026-08-28', amount: 8000 },
      ];
      const result = await service.sweep(MONDAY);
      expect(result.onTime).toBe(1);
    });

    it('marks a PARTIAL payment late, not on time', async () => {
      // Per the cooperative: a partial payment is not a met obligation.
      // 5,000 against a 20,000 week is not a quarter of a contribution.
      const service = build();
      deposits = [{ date: '2026-08-26', amount: 5000 }];
      const result = await service.sweep(MONDAY);
      expect(result.late).toBe(1);
      expect(processed[0].eventType).toBe(
        MultiplierEventType.LATE_CONTRIBUTION,
      );
    });

    it('marks a member with NO deposits late', async () => {
      // The whole reason this is a scheduled sweep rather than a webhook:
      // absence has to be noticed, or not contributing would score better
      // than contributing late.
      const service = build();
      deposits = [];
      const result = await service.sweep(MONDAY);
      expect(result.late).toBe(1);
      expect(processed[0].eventType).toBe(
        MultiplierEventType.LATE_CONTRIBUTION,
      );
    });
  });

  describe('idempotency', () => {
    it('does not assess a member twice for the same period', async () => {
      // A restart or a manual re-run must not move a multiplier by 0.04
      // instead of 0.02, with nothing recording why.
      const service = build();
      historyRows = [{ id: 1 }]; // an event already recorded since the close
      const result = await service.sweep(MONDAY);
      expect(result.skippedAlreadyProcessed).toBe(1);
      expect(processed).toHaveLength(0);
    });
  });

  describe('members who joined mid-period', () => {
    it('skips someone created during the week just closed', async () => {
      const service = build([
        { clientId: 9, createdAt: new Date('2026-08-27') },
      ]);
      const result = await service.sweep(MONDAY);
      expect(result.skippedTooNew).toBe(1);
      expect(processed).toHaveLength(0);
    });

    it('assesses someone who was present for the whole week', async () => {
      const service = build([
        { clientId: 9, createdAt: new Date('2026-08-24') },
      ]);
      deposits = [{ date: '2026-08-26', amount: MINIMUM }];
      const result = await service.sweep(MONDAY);
      expect(result.onTime).toBe(1);
    });
  });

  describe('when Fineract cannot be read', () => {
    it('does NOT mark the member late', async () => {
      // The most important test here. Silence from Fineract is not evidence
      // a member failed to pay, and a wrongly-applied penalty changes the
      // real interest rate on their next loan.
      const service = build();
      depositsThrow = new Error('ECONNREFUSED');
      const result = await service.sweep(MONDAY);
      expect(result.failed).toBe(1);
      expect(result.late).toBe(0);
      expect(processed).toHaveLength(0);
    });

    it('carries on to the remaining members', async () => {
      const service = build([
        { clientId: 1, createdAt: new Date('2026-01-01') },
        { clientId: 2, createdAt: new Date('2026-01-01') },
      ]);
      depositsThrow = new Error('ECONNREFUSED');
      const result = await service.sweep(MONDAY);
      // One member's outage must not abandon the rest of the sweep.
      expect(result.failed).toBe(2);
    });
  });

  describe('when Fineract is not configured at all', () => {
    it('sweeps nobody rather than marking everyone late', async () => {
      const prisma = {
        directorMultiplier: { findMany: jest.fn() },
        multiplierHistory: { findFirst: jest.fn() },
      } as unknown as PrismaService;
      const service = new ContributionSweepService(
        prisma,
        { isConfigured: () => false } as unknown as FineractService,
        { processEvent: jest.fn() } as unknown as MultiplierService,
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
