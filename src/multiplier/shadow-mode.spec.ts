import { ConfigService } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from './multiplier-event.enum';

/**
 * Shadow mode: record penalties, apply none, until a chosen date.
 *
 * Penalising lateness is not the cooperative's current mode of operation, so
 * members get a real trial against their own behaviour before anyone is
 * charged — and the cooperative finds out whether the thresholds are fair
 * before they cost anybody money.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *  - REWARDS are never shadowed. There is no harm in a member benefiting
 *    during the trial, and it makes the change feel like a gain rather than a
 *    threat.
 *  - The event is still RECORDED in full, so the member sees "counted late"
 *    in their history and the ledger stamps the period as assessed — which
 *    also means it is never charged retroactively when the trial ends.
 */
describe('shadow mode', () => {
  const CLIENT = 2;

  let director: {
    clientId: number;
    currentMultiplier: number;
    loanMultiple: number;
    consecutiveOnTimeContributions: number;
    consecutiveOnTimeRepayments: number;
    lastContributionStatus: string | null;
    lastRepaymentStatus: string | null;
    updatedAt: Date;
  };
  let history: { eventType: string; stepAmount: number; notes?: string }[];

  function build(penaltiesActiveFrom?: string) {
    director = {
      clientId: CLIENT,
      currentMultiplier: 1.0,
      loanMultiple: 2.189,
      consecutiveOnTimeContributions: 0,
      consecutiveOnTimeRepayments: 0,
      lastContributionStatus: null,
      lastRepaymentStatus: null,
      updatedAt: new Date(),
    };
    history = [];

    const prisma = {
      directorMultiplier: {
        findUnique: jest.fn(async () => director),
        findUniqueOrThrow: jest.fn(async () => director),
        update: jest.fn(async (args: never) => {
          const a = args as unknown as {
            data: { currentMultiplier?: number; loanMultiple?: number };
          };
          if (a.data.currentMultiplier !== undefined) {
            director.currentMultiplier = a.data.currentMultiplier;
          }
          if (a.data.loanMultiple !== undefined) {
            director.loanMultiple = a.data.loanMultiple;
          }
          return director;
        }),
      },
      multiplierHistory: {
        create: jest.fn(async (args: never) => {
          const a = args as unknown as {
            data: { eventType: string; stepAmount: number; notes?: string };
          };
          history.push(a.data);
          return a.data;
        }),
      },
    } as unknown as PrismaService;

    const config = {
      get: (key: string) =>
        key === 'multiplier.penaltiesActiveFrom'
          ? penaltiesActiveFrom
          : key === 'multiplier.streakMilestone'
            ? 3
            : undefined,
    } as unknown as ConfigService;

    return new MultiplierService(
      prisma,
      { isConfigured: () => false } as unknown as FineractService,
      config,
    );
  }

  const FUTURE = '2099-01-01';
  const PAST = '2020-01-01';

  it('does not move the multiplier for a penalty during the trial', async () => {
    const service = build(FUTURE);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(director.currentMultiplier).toBe(1.0);
  });

  it('still RECORDS the penalty, so the member sees it', async () => {
    // The trial is only useful if members can see what would have happened.
    const service = build(FUTURE);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe(MultiplierEventType.LATE_CONTRIBUTION);
    expect(history[0].stepAmount).toBe(0);
  });

  it('says in the note what would have been charged', async () => {
    const service = build(FUTURE);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
      'Missed the week',
    );

    expect(history[0].notes).toContain('trial period');
    expect(history[0].notes).toContain('0.02');
  });

  it('still applies REWARDS during the trial', async () => {
    // Shadowing rewards would make the trial feel like a punishment with no
    // upside, which is the opposite of a gentle introduction.
    const service = build(FUTURE);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'test',
    );

    expect(director.currentMultiplier).toBeLessThan(1.0);
  });

  it('applies penalties normally once the date has passed', async () => {
    const service = build(PAST);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(director.currentMultiplier).toBeGreaterThan(1.0);
  });

  it('applies penalties normally when no date is configured', async () => {
    const service = build(undefined);

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(director.currentMultiplier).toBeGreaterThan(1.0);
  });

  it('applies penalties when the configured date is nonsense', async () => {
    // Failing towards CHARGING is the conservative reading of a config error.
    // The alternative silently suspends every penalty indefinitely, and
    // nobody would notice until an audit.
    const service = build('not-a-date');

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(director.currentMultiplier).toBeGreaterThan(1.0);
  });
});
