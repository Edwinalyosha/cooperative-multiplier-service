/** Parses an optional integer env var; undefined when unset or unparseable. */
function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses an optional float env var; undefined when unset or unparseable. */
function optionalFloat(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  fineract: {
    baseUrl: process.env.FINERACT_BASE_URL,
    tenantId: process.env.FINERACT_TENANT_ID ?? 'default',
    username: process.env.FINERACT_USERNAME,
    password: process.env.FINERACT_PASSWORD,
    /**
     * Savings products that separate the two kinds of member money.
     *
     * CONTRIBUTIONS is the weekly obligation — the ownership stake. It earns
     * the multiplier, is leveraged 1-5x into the borrowing limit, and is the
     * basis for any later profit split.
     *
     * SAVINGS is voluntary and liquid. It adds to the borrowing limit at face
     * value and confers no ownership.
     *
     * Both UNSET means the pre-2026-08-29 behaviour: every savings account is
     * treated as a contribution and savings are zero. That keeps this
     * deployable before the Fineract products exist, and means a
     * misconfiguration degrades to the old model rather than zeroing
     * everybody's limit.
     */
    contributionsProductId: optionalInt(
      process.env.FINERACT_CONTRIBUTIONS_PRODUCT_ID,
    ),
    savingsProductId: optionalInt(process.env.FINERACT_SAVINGS_PRODUCT_ID),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  queue: {
    /** When true, webhooks and optional API calls enqueue BullMQ jobs */
    asyncEnabled: process.env.QUEUE_ASYNC_ENABLED !== 'false',
  },
  /**
   * Multiplier policy — the cooperative's dials, changeable without a deploy.
   *
   * `contributionPeriodDays` is how often a contribution is expected. It is
   * COUPLED to the step values below: those are per contribution, not per unit
   * of time, so moving from weekly (7) to monthly (30) without retuning turns
   * "best rate in ~27 weeks" into "best rate in ~27 months". Change one,
   * revisit the other. See multiplier-steps.constants.ts for the arithmetic.
   *
   * Step overrides set magnitude only. A value whose SIGN would invert the
   * incentive (rewarding lateness, punishing early payoff) is rejected at
   * runtime and the built-in default used instead — magnitudes are policy,
   * directions are not.
   */
  multiplier: {
    contributionPeriodDays: parseInt(
      process.env.CONTRIBUTION_PERIOD_DAYS ?? '7',
      10,
    ),
    /**
     * Award the streak bonus every Nth consecutive on-time contribution.
     * Single source of truth: previously hardcoded as 3 in BOTH
     * multiplier.service.ts and streak.scheduler.ts, which could drift apart
     * and award bonuses on different cadences depending on which path fired.
     */
    streakMilestone: parseInt(process.env.STREAK_MILESTONE ?? '3', 10),
    /**
     * Minimum deposit, per contribution period, for the week to count as
     * ON TIME. Below it the week is LATE — a partial payment is not a met
     * obligation. Cooperative-wide; if members ever get individual amounts
     * this needs to become per-member data rather than config.
     */
    weeklyContributionMinimum: parseInt(
      process.env.WEEKLY_CONTRIBUTION_MINIMUM ?? '20000',
      10,
    ),
    /**
     * How much each shilling of ordinary savings adds to a member's borrowing
     * limit: `limit = contributions x loanMultiple + savings x savingsFactor`.
     *
     * 1.0 by default — savings count at face value. Contributions are
     * leveraged 1-5x because they are committed capital that also earns the
     * multiplier; savings are withdrawable, so lending more against them than
     * they are worth would let a member borrow and then remove the backing.
     * Below 1.0 would penalise money the member has actually placed with the
     * cooperative.
     *
     * Savings deliberately do NOT move the multiplier. Contributions buy a
     * better RATE; savings buy CAPACITY only. A member with no savings account
     * is not disadvantaged — contributions alone carry the full 1-5x.
     */
    savingsFactor: optionalFloat(process.env.SAVINGS_FACTOR) ?? 1.0,
    steps: {
      ON_TIME_CONTRIBUTION: optionalFloat(process.env.STEP_ON_TIME_CONTRIBUTION),
      CONSECUTIVE_ON_TIME_CONTRIBUTIONS: optionalFloat(
        process.env.STEP_CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
      ),
      LATE_CONTRIBUTION: optionalFloat(process.env.STEP_LATE_CONTRIBUTION),
      ON_TIME_REPAYMENT: optionalFloat(process.env.STEP_ON_TIME_REPAYMENT),
      LATE_REPAYMENT: optionalFloat(process.env.STEP_LATE_REPAYMENT),
      EARLY_FULL_PAYOFF: optionalFloat(process.env.STEP_EARLY_FULL_PAYOFF),
    },
  },
  eligibility: {
    /** Cache TTL in minutes before auto-refresh from Fineract */
    cacheTtlMinutes: parseInt(
      process.env.ELIGIBILITY_CACHE_TTL_MINUTES ?? '60',
      10,
    ),
    /** Minimum max loan to count as eligible */
    minLoanAmount: parseInt(process.env.MIN_ELIGIBLE_LOAN_AMOUNT ?? '100000', 10),
  },
  cron: {
    eligibilityRefresh: process.env.CRON_ELIGIBILITY_REFRESH ?? '0 2 * * *',
    streakCheck: process.env.CRON_STREAK_CHECK ?? '0 6 * * *',
    /** Hourly by default (2026-08-11 decision) — keeps the 48h loan
     * application expiry deadline reasonably tight rather than the daily
     * cadence used by the other two schedulers. */
    loanExpiryCheck: process.env.CRON_LOAN_EXPIRY_CHECK ?? '0 * * * *',
    /**
     * Weekly contribution sweep. Default is Sunday 22:00 UTC = Monday 01:00
     * in Kampala (UTC+3) — an hour after the week closes, so the period is
     * definitively over. The container runs TZ=UTC, so this expression is in
     * UTC while the PERIOD is anchored to Kampala; see
     * contribution-period.util.ts.
     */
    contributionSweep: process.env.CRON_CONTRIBUTION_SWEEP ?? '0 22 * * 0',
  },
  mobile: {
    corsOrigins: (process.env.MOBILE_CORS_ORIGINS ?? '*')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  /**
   * Static API credentials for the machine-facing admin surfaces. Split into
   * two scopes on 2026-08-24: a single key previously unlocked both
   * identity operations and reporting, so anyone who needed a dashboard
   * export also held the ability to mint a login mapped to any member's
   * clientId and role.
   *
   * NONE of these have fallback values, deliberately. The previous defaults
   * were 'admin' / 'changeme' / 'dev-api-key', all committed to this
   * repository — anyone who read the source could have logged in and minted
   * themselves an account. A secret with a default is indistinguishable from
   * a real one at runtime: the service looks protected while being open.
   */
  api: {
    username: process.env.API_USERNAME,
    password: process.env.API_PASSWORD,
    /** Identity operations: create/list logins, resolve onboarding. */
    adminKey: process.env.ADMIN_API_KEY,
    /** Read-only reporting. Safe to hand to an accountant or a dashboard. */
    reportsKey: process.env.REPORTS_API_KEY,
  },
  /**
   * Rate limiting. The login limit is deliberately much tighter than the
   * general one: mobile login validates the password against Fineract's own
   * /authentication, so a brute-force attempt does not just hammer this
   * service — it hammers Fineract, and can trip Fineract's own account
   * lockouts for the member being guessed at.
   */
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
    // Login limits are NOT configurable here: @Throttle takes its arguments
    // at class-decoration time, before ConfigService exists. They are constants
    // in the two login controllers (5 attempts / 5 minutes). Env entries for
    // them would be dead config that reads as live.
  },
  /**
   * Swagger publishes a complete, self-documenting index of every endpoint
   * and which ones carry auth. Defaults to OFF: must be switched on
   * explicitly, and only in an environment where that map is not a gift to
   * anyone scanning the host.
   */
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },
  /**
   * Outbound member email. Separate from the custom Java email plugin inside
   * the Fineract container (AGENT_HANDOFF.md) — that sends credentials and
   * password resets; this says where to use them. Unconfigured means the
   * email is skipped with a warning, never an onboarding failure.
   */
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.ONBOARDING_EMAIL_FROM,
    portalUrl:
      process.env.PORTAL_LOGIN_URL ?? 'https://director.8teventures.com/login',
  },
  webhooks: {
    /**
     * Shared secret n8n presents on the Fineract webhook receivers.
     * DELIBERATELY has no fallback: an unset secret must fail closed (see
     * WebhookSecretGuard), never silently accept a value that anyone who has
     * read this repository already knows.
     */
    sharedSecret: process.env.WEBHOOK_SHARED_SECRET,
  },
  jwt: {
    /**
     * No fallback. This previously defaulted to
     * 'dev-jwt-secret-change-in-prod', a literal committed to this repo —
     * had the env var ever been unset, anyone reading the source could have
     * forged a token for any user, role, and clientId, walking through every
     * guard in the application. (Verified set to a real 64-character value in
     * production on 2026-08-24, so no forgery was ever possible.)
     *
     * Unlike the API keys, a missing JWT secret is fatal at boot rather than
     * per-request: there is no safe degraded mode for a service that cannot
     * verify its own tokens.
     */
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshTtlSeconds: parseInt(
      process.env.JWT_REFRESH_TTL_SECONDS ?? '604800',
      10,
    ),
  },
});
