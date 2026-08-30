import {
  lastCompletedWeek,
  currentWeek,
  wasOpenForWholePeriod,
  KAMPALA_UTC_OFFSET_HOURS,
} from './contribution-period.util';

/**
 * The boundary arithmetic is where an off-by-one would live, and its
 * consequence is a member being marked late for a week they paid in. These
 * tests pin the Kampala/UTC offset behaviour specifically, because the
 * three-hour gap sits exactly on the period boundary.
 *
 * 2026-08-31 is a Monday; 2026-08-30 a Sunday. So the week that closes at
 * Monday 31st 00:00 Kampala runs 24th–30th August.
 */
describe('lastCompletedWeek', () => {
  /** Helper: an instant expressed in Kampala wall-clock. */
  const kampala = (iso: string) =>
    new Date(Date.parse(`${iso}Z`) - KAMPALA_UTC_OFFSET_HOURS * 3600 * 1000);

  it('returns the Monday–Sunday week that has just closed', () => {
    const period = lastCompletedWeek(kampala('2026-08-31T09:00:00'));
    expect(period.startDate).toBe('2026-08-24');
    expect(period.endDate).toBe('2026-08-30');
  });

  it('never includes the week in progress', () => {
    // Thursday: the current week is 31 Aug – 6 Sep and must not be swept,
    // or a member would be marked late with days still to go.
    const period = lastCompletedWeek(kampala('2026-09-03T09:00:00'));
    expect(period.startDate).toBe('2026-08-24');
    expect(period.endDate).toBe('2026-08-30');
  });

  describe('the Kampala/UTC boundary — the three hours that matter', () => {
    it('01:00 Monday in Kampala is already the new week', () => {
      // Same instant is 22:00 Sunday UTC. A naive UTC sweep would still be
      // in the old week and would credit Monday deposits to it.
      const period = lastCompletedWeek(kampala('2026-08-31T01:00:00'));
      expect(period.endDate).toBe('2026-08-30');
      expect(period.startDate).toBe('2026-08-24');
    });

    it('23:00 Sunday in Kampala is still the old week', () => {
      // 20:00 Sunday UTC. The week 24th–30th has not closed yet, so the
      // most recently completed one is the week before.
      const period = lastCompletedWeek(kampala('2026-08-30T23:00:00'));
      expect(period.startDate).toBe('2026-08-17');
      expect(period.endDate).toBe('2026-08-23');
    });

    it('exactly Monday 00:00 Kampala closes the week that just ended', () => {
      const period = lastCompletedWeek(kampala('2026-08-31T00:00:00'));
      expect(period.startDate).toBe('2026-08-24');
      expect(period.endDate).toBe('2026-08-30');
    });
  });

  it('reports closedAt as the real UTC instant of Monday 00:00 Kampala', () => {
    const period = lastCompletedWeek(kampala('2026-08-31T09:00:00'));
    // Monday 00:00 +03:00 is Sunday 21:00 UTC.
    expect(period.closedAt.toISOString()).toBe('2026-08-30T21:00:00.000Z');
  });

  it('always spans exactly seven days', () => {
    // Walk a month of start instants; the window must never stretch or slip.
    for (let day = 1; day <= 30; day++) {
      const iso = `2026-09-${String(day).padStart(2, '0')}T12:00:00`;
      const period = lastCompletedWeek(kampala(iso));
      const spanDays =
        (Date.parse(period.endDate) - Date.parse(period.startDate)) /
        (24 * 3600 * 1000);
      expect(spanDays).toBe(6); // inclusive dates: Mon..Sun
    }
  });

  it('starts on a Monday and ends on a Sunday, every time', () => {
    for (let day = 1; day <= 30; day++) {
      const iso = `2026-09-${String(day).padStart(2, '0')}T12:00:00`;
      const period = lastCompletedWeek(kampala(iso));
      expect(new Date(`${period.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${period.endDate}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });
});

describe('wasOpenForWholePeriod', () => {
  const period = lastCompletedWeek(
    new Date(Date.parse('2026-08-31T09:00:00Z') - 3 * 3600 * 1000),
  );

  it('includes an account opened before the period began', () => {
    expect(wasOpenForWholePeriod('2026-08-01', period)).toBe(true);
  });

  it('includes an account opened exactly on the first day', () => {
    expect(wasOpenForWholePeriod('2026-08-24', period)).toBe(true);
  });

  it('EXCLUDES an account opened mid-week', () => {
    // The cooperative's rule: skip the half week, start counting from the
    // first full one. Marking a new member late for days before they joined
    // would be their first experience of the portal.
    expect(wasOpenForWholePeriod('2026-08-27', period)).toBe(false);
  });

  it('treats an unknown opening date as long-standing', () => {
    // The alternative would silently drop existing members from the sweep.
    expect(wasOpenForWholePeriod(null, period)).toBe(true);
  });
});

/**
 * The week IN PROGRESS — what a member sees on their home screen.
 *
 * Same UTC+3 boundary hazard as lastCompletedWeek, and the same reason for
 * testing it apart from any service: the offset sits exactly ON the
 * Monday-midnight boundary, so between 21:00 and midnight UTC the server's
 * date and Kampala's date disagree. Getting this wrong shows a member the
 * wrong week's progress and tells them they are short when they are not.
 */
describe('currentWeek', () => {
  it('returns the week containing a mid-week moment', () => {
    // Thursday 27 Aug 2026, midday Kampala.
    const period = currentWeek(new Date('2026-08-27T09:00:00Z'));
    expect(period.startDate).toBe('2026-08-24');
    expect(period.endDate).toBe('2026-08-30');
  });

  it('starts a new week at Monday 00:00 Kampala, not UTC', () => {
    // 21:00 UTC Sunday IS Monday 00:00 in Kampala — the new week has begun
    // for the member even though it is still Sunday for the server.
    const period = currentWeek(new Date('2026-08-30T21:00:00Z'));
    expect(period.startDate).toBe('2026-08-31');
  });

  it('still reports the old week an hour before that boundary', () => {
    // 20:00 UTC Sunday = 23:00 Sunday Kampala. Same week, one hour left.
    const period = currentWeek(new Date('2026-08-30T20:00:00Z'));
    expect(period.startDate).toBe('2026-08-24');
    expect(period.endDate).toBe('2026-08-30');
  });

  it('reports Monday as the first day of its own week', () => {
    const period = currentWeek(new Date('2026-08-24T09:00:00Z'));
    expect(period.startDate).toBe('2026-08-24');
  });

  it('reports Sunday as the last day of its own week', () => {
    const period = currentWeek(new Date('2026-08-30T09:00:00Z'));
    expect(period.endDate).toBe('2026-08-30');
  });

  it('closes exactly when the next week opens', () => {
    // The instant this week closes must be the instant lastCompletedWeek
    // starts counting from, or a moment could fall in both weeks or neither.
    const now = new Date('2026-08-27T09:00:00Z');
    const current = currentWeek(now);
    const after = lastCompletedWeek(current.closedAt);

    expect(after.startDate).toBe(current.startDate);
    expect(after.endDate).toBe(current.endDate);
  });

  it('never overlaps the week that just closed', () => {
    const now = new Date('2026-08-27T09:00:00Z');
    expect(lastCompletedWeek(now).endDate < currentWeek(now).startDate).toBe(true);
  });
});
