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
  },
  mobile: {
    corsOrigins: (process.env.MOBILE_CORS_ORIGINS ?? '*')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ?? 'dev-jwt-secret-change-in-prod',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshTtlSeconds: parseInt(
      process.env.JWT_REFRESH_TTL_SECONDS ?? '604800',
      10,
    ),
  },
});
