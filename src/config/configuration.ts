export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  fineract: {
    baseUrl: process.env.FINERACT_BASE_URL,
    tenantId: process.env.FINERACT_TENANT_ID ?? 'default',
    username: process.env.FINERACT_USERNAME,
    password: process.env.FINERACT_PASSWORD,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  queue: {
    /** When true, webhooks and optional API calls enqueue BullMQ jobs */
    asyncEnabled: process.env.QUEUE_ASYNC_ENABLED !== 'false',
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
