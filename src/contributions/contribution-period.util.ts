/**
 * Contribution periods, anchored to Africa/Kampala.
 *
 * The cooperative's week runs Monday to Sunday and closes at Sunday midnight
 * LOCAL time (UTC+3). The Fineract container runs TZ=UTC, so "midnight" means
 * two different instants in the two systems — a three-hour window sitting
 * exactly on the boundary. A deposit made at 1am Monday in Kampala is 10pm
 * Sunday UTC, and a naive UTC sweep would credit it to the week that had just
 * closed. Over eight members and a year that quietly misattributes
 * contributions and moves people's interest rates.
 *
 * Fineract stores transaction dates as CALENDAR dates with no time component,
 * so once the right dates are chosen the comparison is unambiguous. These
 * functions decide which calendar dates make up a week in Kampala terms.
 *
 * Kept pure and separate from the sweep so the boundary arithmetic — where
 * off-by-one errors live — is testable without Fineract, a database, or a
 * clock.
 */

/** Africa/Kampala is UTC+3 year-round; Uganda observes no daylight saving. */
export const KAMPALA_UTC_OFFSET_HOURS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ContributionPeriod {
  /** First day of the week, `YYYY-MM-DD` (Monday, Kampala). */
  startDate: string;
  /** Last day of the week, `YYYY-MM-DD` (Sunday, Kampala). */
  endDate: string;
  /** The instant the period closed — Monday 00:00 Kampala, as UTC. */
  closedAt: Date;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The most recently COMPLETED Monday–Sunday week, in Kampala terms.
 *
 * Always looks backwards: a sweep running on Monday processes the week that
 * ended the night before, never the week in progress. A member cannot be
 * marked late for a week they still have time left in.
 */
export function lastCompletedWeek(
  now: Date,
  offsetHours: number = KAMPALA_UTC_OFFSET_HOURS,
): ContributionPeriod {
  const offsetMs = offsetHours * 60 * 60 * 1000;

  // Shift into local time, then read with UTC getters so the wall-clock
  // values are Kampala's without depending on the server's own zone.
  const local = new Date(now.getTime() + offsetMs);

  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );

  // getUTCDay: 0 = Sunday. Days elapsed since the most recent Monday.
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;

  // Monday 00:00 local of the CURRENT week — which is precisely the instant
  // the previous week closed.
  const thisWeekStart = localMidnight - daysSinceMonday * MS_PER_DAY;

  const lastWeekStart = thisWeekStart - 7 * MS_PER_DAY;
  const lastWeekEnd = thisWeekStart - MS_PER_DAY; // the Sunday

  return {
    startDate: toYmd(new Date(lastWeekStart)),
    endDate: toYmd(new Date(lastWeekEnd)),
    // Back to a real UTC instant for comparison against stored timestamps.
    closedAt: new Date(thisWeekStart - offsetMs),
  };
}

/**
 * The week currently IN PROGRESS, in Kampala terms.
 *
 * The counterpart to lastCompletedWeek, and the one a member sees. Nothing is
 * judged here — no ledger row exists for a week that has not closed — but
 * showing it is the whole point: a member should be able to see they are
 * short with days left to fix it, rather than first learning of a miss when
 * their multiplier moves.
 *
 * `closedAt` is when this week WILL close: next Monday 00:00 Kampala. That
 * makes "how long do I have" a subtraction rather than another piece of
 * calendar arithmetic at the call site.
 */
export function currentWeek(
  now: Date,
  offsetHours: number = KAMPALA_UTC_OFFSET_HOURS,
): ContributionPeriod {
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);

  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );

  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const thisWeekStart = localMidnight - daysSinceMonday * MS_PER_DAY;
  const thisWeekEnd = thisWeekStart + 6 * MS_PER_DAY; // the Sunday
  const nextWeekStart = thisWeekStart + 7 * MS_PER_DAY;

  return {
    startDate: toYmd(new Date(thisWeekStart)),
    endDate: toYmd(new Date(thisWeekEnd)),
    closedAt: new Date(nextWeekStart - offsetMs),
  };
}

/**
 * Was this account open for the WHOLE period?
 *
 * A member onboarded mid-week must not be marked late for a week they were
 * only present for part of — counting starts from their first full week, per
 * the cooperative's decision. An account with no known opening date is
 * treated as long-standing, since the alternative would silently exclude
 * existing members from the sweep entirely.
 */
export function wasOpenForWholePeriod(
  openedOn: string | null | undefined,
  period: ContributionPeriod,
): boolean {
  if (!openedOn) return true;
  return openedOn.slice(0, 10) <= period.startDate;
}
