import { ContributionLedgerService } from './contribution-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { MULTIPLIER_STEPS } from '../multiplier/multiplier-steps.constants';
import type { ContributionPeriod } from './contribution-period.util';

/**
 * The contribution ledger.
 *
 * The cooperative's model: every week a director owes a set amount; a missed
 * week is DEFERRED interest-free rather than forgiven; a payment covers the
 * current week first and then backfills the oldest unpaid one; and a missed
 * week is penalised EXACTLY ONCE.
 *
 * That last promise is the reason this table exists. The previous design
 * asked MultiplierHistory "has anything happened since the period closed?",
 * which is a proxy — it skipped a member entirely if a finance manager had
 * recorded a contribution by hand, silently suppressing the sweep's own
 * verdict. Here the penalty is charged in the same write that stamps
 * penaltyAppliedAt, so re-runs are harmless by construction.
 */
describe('contribution ledger', () => {
  const CLIENT = 2;
  const DUE = 20000;

  const WEEK: ContributionPeriod = {
    startDate: '2026-08-24',
    endDate: '2026-08-30',
    closedAt: new Date('2026-08-30T21:00:00Z'),
  };

  interface Row {
    id: number;
    clientId: number;
    periodStart: Date;
    periodEnd: Date;
    amountDue: number;
    amountPaid: number;
    status: string;
    penaltyAppliedAt: Date | null;
    arrearsRewardAppliedAt: Date | null;
    satisfiedAt: Date | null;
  }

  let rows: Row[];
  let events: { clientId: number; eventType: MultiplierEventType }[];
  let nextId: number;

  /** `periodStart` is a YYYY-MM-DD string for readability; the row stores a
   * Date, as Prisma returns for a DATE column. */
  function row(periodStart: string, overrides: Partial<Row> = {}): Row {
    return {
      id: nextId++,
      clientId: CLIENT,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodStart),
      amountDue: DUE,
      amountPaid: 0,
      status: 'OPEN',
      penaltyAppliedAt: null,
      arrearsRewardAppliedAt: null,
      satisfiedAt: null,
      ...overrides,
    };
  }

  function build(existing: Row[] = []) {
    nextId = 1;
    rows = existing;
    events = [];

    const prisma = {
      contributionPeriod: {
        upsert: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: { clientId_periodStart: { periodStart: Date } };
            create: { periodStart: Date; periodEnd: Date; amountDue: number };
          };
          const key = a.where.clientId_periodStart.periodStart
            .toISOString()
            .slice(0, 10);
          const found = rows.find(
            (r) => r.periodStart.toISOString().slice(0, 10) === key,
          );
          if (found) return found;
          const created = row(key, { amountDue: a.create.amountDue });
          rows.push(created);
          return created;
        }),
        findUnique: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: { clientId_periodStart: { periodStart: Date } };
          };
          const key = a.where.clientId_periodStart.periodStart
            .toISOString()
            .slice(0, 10);
          return (
            rows.find((r) => r.periodStart.toISOString().slice(0, 10) === key) ??
            null
          );
        }),
        create: jest.fn(async (args: never) => {
          const a = args as unknown as { data: Record<string, unknown> };
          const created = { ...a.data, id: nextId++ } as unknown as Row;
          rows.push(created);
          return created;
        }),
        count: jest.fn(async () => rows.length),
        findMany: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: { status?: { in: string[] } };
          };
          const statuses = a.where.status?.in;
          return rows
            .filter((r) => !statuses || statuses.includes(r.status))
            .sort((x, y) => (x.periodStart < y.periodStart ? -1 : 1));
        }),
        update: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: { id: number };
            data: Partial<Row>;
          };
          const found = rows.find((r) => r.id === a.where.id)!;
          Object.assign(found, a.data);
          return found;
        }),
        updateMany: jest.fn(async (args: never) => {
          const a = args as unknown as {
            where: {
              id: number;
              penaltyAppliedAt?: null;
              arrearsRewardAppliedAt?: null;
            };
            data: Partial<Row>;
          };
          const found = rows.find((r) => r.id === a.where.id);
          if (!found) return { count: 0 };
          // The guard clauses that make "once" true. A row already stamped
          // matches nothing, so a second call is a no-op rather than a
          // second charge.
          if ('penaltyAppliedAt' in a.where && found.penaltyAppliedAt !== null) {
            return { count: 0 };
          }
          if (
            'arrearsRewardAppliedAt' in a.where &&
            found.arrearsRewardAppliedAt !== null
          ) {
            return { count: 0 };
          }
          Object.assign(found, a.data);
          return { count: 1 };
        }),
      },
    } as unknown as PrismaService;

    const multiplier = {
      processEvent: jest.fn(
        async (clientId: number, eventType: MultiplierEventType) => {
          events.push({ clientId, eventType });
          // The ledger records what was ACTUALLY applied, so a later waiver
          // can reverse exactly that.
          return { stepAmount: MULTIPLIER_STEPS[eventType] };
        },
      ),
      reversePenalty: jest.fn(async () => undefined),
    } as unknown as MultiplierService;

    return new ContributionLedgerService(prisma, multiplier);
  }

  const count = (type: MultiplierEventType) =>
    events.filter((e) => e.eventType === type).length;

  describe('meeting the week', () => {
    it('rewards a week paid in full', async () => {
      const ledger = build();
      const result = await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE);

      expect(result.satisfied).toBe(true);
      expect(count(MultiplierEventType.ON_TIME_CONTRIBUTION)).toBe(1);
      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(0);
    });

    it('penalises a week paid short, and keeps the money', async () => {
      const ledger = build();
      const result = await ledger.assessPeriod(CLIENT, WEEK, DUE, 12000);

      expect(result.satisfied).toBe(false);
      expect(result.amountPaid).toBe(12000);
      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(1);
    });

    it('penalises a week with nothing paid', async () => {
      const ledger = build();
      await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);
      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(1);
    });
  });

  describe('penalised exactly once — the guarantee', () => {
    it('does not charge again when the sweep re-runs', async () => {
      const ledger = build();
      await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);
      await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);
      await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);

      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(1);
    });

    it('reports penaltyCharged only on the run that charged it', async () => {
      const ledger = build();
      const first = await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);
      const second = await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);

      expect(first.penaltyCharged).toBe(true);
      expect(second.penaltyCharged).toBe(false);
    });

    it('is not fooled by an unrelated multiplier event', async () => {
      // The old time-based check skipped a member entirely if ANY event had
      // been recorded since the period closed — so a manually recorded
      // contribution suppressed the sweep's verdict. The ledger looks at this
      // specific week and is unaffected by anything else.
      const ledger = build();
      await ledger.assessPeriod(CLIENT, WEEK, DUE, 0);
      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(1);
    });
  });

  describe('deferred arrears', () => {
    it('backfills the oldest missed week once the current one is covered', async () => {
      const ledger = build([
        row('2026-08-17', { status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-08-17') }),
      ]);

      // Two weeks' worth: covers this week, then clears the old one.
      const result = await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE * 2);

      expect(result.satisfied).toBe(true);
      expect(result.arrearsCleared).toEqual(['2026-08-17']);
      expect(count(MultiplierEventType.ARREARS_CLEARED)).toBe(1);
    });

    it('covers the current week BEFORE any backlog', async () => {
      // Otherwise a member paying weekly while behind services old debt,
      // takes a fresh penalty every week, and can never catch up.
      const ledger = build([
        row('2026-08-17', { status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-08-17') }),
      ]);

      const result = await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE);

      expect(result.satisfied).toBe(true);
      expect(count(MultiplierEventType.LATE_CONTRIBUTION)).toBe(0);
      expect(result.arrearsCleared).toEqual([]);
    });

    it('rewards clearing arrears exactly once', async () => {
      const ledger = build([
        row('2026-08-17', { status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-08-17') }),
      ]);

      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE * 2);
      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE * 2);

      expect(count(MultiplierEventType.ARREARS_CLEARED)).toBe(1);
    });

    it('does not reward a week that was never in arrears', async () => {
      // Paying on time earns ON_TIME_CONTRIBUTION, not a catch-up bonus too.
      const ledger = build();
      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE);
      expect(count(MultiplierEventType.ARREARS_CLEARED)).toBe(0);
    });

    it('settles a week that earns no reward, instead of leaving it open', async () => {
      // An opening balance seeded at launch carries no catch-up reward: the
      // debt predates the system, so it was never penalised and must not be
      // rewarded. It must still SETTLE when paid — guarding the settlement on
      // the reward would leave it absorbing the same money every week and
      // never closing.
      const ledger = build([
        row('2026-08-17', {
          status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-08-17'),
          arrearsRewardAppliedAt: new Date('2026-08-17'),
        }),
      ]);

      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE * 2);

      expect(count(MultiplierEventType.ARREARS_CLEARED)).toBe(0);
      expect(await ledger.getArrears(CLIENT)).toBe(0);
    });

    it('leaves a partially-backfilled week still owing', async () => {
      const ledger = build([
        row('2026-08-17', { status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-08-17') }),
      ]);

      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE + 5000);

      expect(count(MultiplierEventType.ARREARS_CLEARED)).toBe(0);
      expect(await ledger.getArrears(CLIENT)).toBe(15000);
    });
  });

  describe('the incentive must stay the right way round', () => {
    it('makes a missed-then-paid week cost more than paying on time', () => {
      // The catch-up reward MUST be smaller than the penalty. If it ever
      // exceeded it, deliberately missing a week and paying later would be a
      // net GAIN and the whole obligation becomes gameable. Asserted against
      // the money, so a future edit has to disagree with the arithmetic
      // rather than just a table of constants.
      const penalty = MULTIPLIER_STEPS[MultiplierEventType.LATE_CONTRIBUTION];
      const reward = MULTIPLIER_STEPS[MultiplierEventType.ARREARS_CLEARED];
      const onTime = MULTIPLIER_STEPS[MultiplierEventType.ON_TIME_CONTRIBUTION];

      const missedThenPaid = penalty + reward;

      expect(missedThenPaid).toBeGreaterThan(0);       // still a net loss
      expect(missedThenPaid).toBeLessThan(penalty);    // better than never paying
      expect(missedThenPaid).toBeGreaterThan(onTime);  // worse than paying on time
    });
  });

  describe('opening arrears seeded at launch', () => {
    const buildSeeding = build;

    const WEEKS = [
      {
        periodStart: '2026-07-06',
        periodEnd: '2026-07-12',
        amountDue: 20000,
      },
    ];

    it('records the debt as arrears', async () => {
      const ledger = buildSeeding();
      const result = await ledger.seedOpeningArrears(CLIENT, WEEKS);

      expect(result.created).toEqual(['2026-07-06']);
      expect(await ledger.getArrears(CLIENT)).toBe(20000);
    });

    it('charges no multiplier penalty for weeks that predate the system', async () => {
      // Assessing months nobody was ever measured on would drop every
      // member's multiplier at launch, for behaviour the cooperative had not
      // yet defined.
      const ledger = buildSeeding();
      await ledger.seedOpeningArrears(CLIENT, WEEKS);
      expect(events).toHaveLength(0);
    });

    it('stamps both timestamps, so the week is never penalised OR rewarded', async () => {
      const ledger = buildSeeding();
      await ledger.seedOpeningArrears(CLIENT, WEEKS);

      const seeded = rows.find(
        (r) => r.periodStart.toISOString().slice(0, 10) === '2026-07-06',
      )!;
      expect(seeded.penaltyAppliedAt).not.toBeNull();
      expect(seeded.arrearsRewardAppliedAt).not.toBeNull();
    });

    it('refuses to overwrite a week that already has a real assessment', async () => {
      const ledger = buildSeeding();
      rows.push(
        row('2026-07-06', {
          status: 'ARREARS',
          penaltyAppliedAt: new Date('2026-07-13'),
        }),
      );

      const result = await ledger.seedOpeningArrears(CLIENT, WEEKS);
      expect(result.created).toEqual([]);
      expect(result.skipped).toEqual(['2026-07-06']);
    });

    it('accepts a part-paid week', async () => {
      const ledger = buildSeeding();
      await ledger.seedOpeningArrears(CLIENT, [
        { ...WEEKS[0], amountPaid: 5000 },
      ]);
      expect(await ledger.getArrears(CLIENT)).toBe(15000);
    });

    it('honours a week whose amount differed from today', async () => {
      // The weekly figure changes over time; each seeded week carries the
      // amount that actually applied then.
      const ledger = buildSeeding();
      await ledger.seedOpeningArrears(CLIENT, [
        { ...WEEKS[0], amountDue: 15000 },
      ]);
      expect(await ledger.getArrears(CLIENT)).toBe(15000);
    });
  });

  describe('arrears reporting', () => {
    it('totals what is still owed across every unpaid week', async () => {
      const ledger = build([
        row('2026-08-10', { status: 'ARREARS', amountPaid: 5000 }),
        row('2026-08-17', { status: 'ARREARS' }),
      ]);
      expect(await ledger.getArrears(CLIENT)).toBe(15000 + 20000);
    });

    it('is zero for a member who is paid up', async () => {
      const ledger = build();
      await ledger.assessPeriod(CLIENT, WEEK, DUE, DUE);
      expect(await ledger.getArrears(CLIENT)).toBe(0);
    });

    it('lists unpaid weeks oldest first, with what each still owes', async () => {
      const ledger = build([
        row('2026-08-17', { status: 'ARREARS', amountPaid: 5000 }),
        row('2026-08-10', { status: 'ARREARS' }),
      ]);

      const list = await ledger.listArrears(CLIENT);
      expect(list[0].periodStart).toBe('2026-08-10');
      expect(list[1].outstanding).toBe(15000);
    });
  });
});
