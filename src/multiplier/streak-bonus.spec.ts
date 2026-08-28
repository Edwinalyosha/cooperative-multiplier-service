import { ConfigService } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { MultiplierEventType } from './multiplier-event.enum';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/**
 * The consecutive-on-time bonus must be awarded ONCE per milestone reached.
 *
 * There used to be two paths awarding it: this one (inline, synchronous, on
 * the event that caused the milestone) and a daily StreakScheduler deduped by
 * "was there one in the last 24 hours". The scheduler was removed 2026-08-28
 * because that dedupe cannot express "once per streak value" — a weekly
 * cadence leaves a streak sitting at a milestone for a whole week, so it
 * re-awarded roughly daily — and because with the async queue its check read
 * MultiplierHistory before the worker had written to it, so an outage made it
 * enqueue one more job every day until they all landed at once.
 *
 * Invisible while the step was 0.000. At -0.020 it would have moved a member
 * a third of the way across the 0.6-1.5 band after any worker downtime.
 *
 * These tests pin the surviving path so a second one is not quietly added back.
 */
describe('streak bonus', () => {
  const CLIENT = 2;

  let events: MultiplierEventType[];
  let streakAfterUpdate: number;

  function build() {
    events = [];
    streakAfterUpdate = 0;

    const director = {
      clientId: CLIENT,
      currentMultiplier: 1.0,
      loanMultiple: 2.189,
      consecutiveOnTimeContributions: 0,
      consecutiveOnTimeRepayments: 0,
      lastContributionStatus: null,
      lastRepaymentStatus: null,
      updatedAt: new Date(),
    };

    const prisma = {
      directorMultiplier: {
        findUnique: jest.fn(async () => director),
        findUniqueOrThrow: jest.fn(async () => director),
        update: jest.fn(async () => ({
          ...director,
          consecutiveOnTimeContributions: streakAfterUpdate,
        })),
      },
      multiplierHistory: {
        create: jest.fn(async (args: { data: { eventType: string } }) => {
          events.push(args.data.eventType as MultiplierEventType);
          return args.data;
        }),
      },
    } as unknown as PrismaService;

    // isConfigured false so processEvent skips the post-event Fineract
    // eligibility refresh — irrelevant here and would need more mocking.
    const fineract = {
      isConfigured: () => false,
    } as unknown as FineractService;

    const config = {
      get: (key: string) =>
        key === 'multiplier.streakMilestone' ? 3 : undefined,
    } as unknown as ConfigService;

    return new MultiplierService(prisma, fineract, config);
  }

  it('awards the bonus when a contribution reaches the milestone', async () => {
    const service = build();
    streakAfterUpdate = 3;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'test',
    );

    expect(events).toEqual([
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
    ]);
  });

  it('awards it exactly once, not once per call', async () => {
    const service = build();
    streakAfterUpdate = 3;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'test',
    );

    const bonuses = events.filter(
      (e) => e === MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
    );
    expect(bonuses).toHaveLength(1);
  });

  it('does not award between milestones', async () => {
    const service = build();
    streakAfterUpdate = 4;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'test',
    );

    expect(events).toEqual([MultiplierEventType.ON_TIME_CONTRIBUTION]);
  });

  it('awards again at the next milestone', async () => {
    const service = build();
    streakAfterUpdate = 6;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'test',
    );

    expect(events).toContain(
      MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
    );
  });

  it('does not award on a LATE contribution, even at a milestone streak', async () => {
    const service = build();
    streakAfterUpdate = 3;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.LATE_CONTRIBUTION,
      'test',
    );

    expect(events).toEqual([MultiplierEventType.LATE_CONTRIBUTION]);
  });

  it('does not recurse — the bonus event does not award another bonus', async () => {
    // maybeApplyStreakBonus calls processEvent again. If it did not filter on
    // event type, that second call would qualify and loop.
    const service = build();
    streakAfterUpdate = 3;

    await service.processEvent(
      CLIENT,
      MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
      'test',
    );

    expect(events).toEqual([
      MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
    ]);
  });
});
