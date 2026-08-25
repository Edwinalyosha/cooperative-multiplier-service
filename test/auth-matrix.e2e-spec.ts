import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * THE AUTH MATRIX
 * ===============
 * Every HTTP route in the application, and whether an *unauthenticated*
 * caller may reach it.
 *
 * Why this exists: authentication in this codebase is opt-in per route
 * decorator (`@UseGuards(...)`), with no APP_GUARD. A route whose author
 * forgets the decorator is silently public — which is exactly how the P0
 * findings in director-webapp/PRODUCTION-READINESS.md happened. Reading
 * controllers cannot prove the absence of that mistake; this can.
 *
 * Written deliberately BEFORE the global-guard fix (RESOLUTION-PLAN.md
 * Phase 2.2), so it fails first and names the open endpoints from a running
 * application rather than from code review. When Phase 2.1/2.2 land, this
 * going green IS the proof that P0 is closed.
 *
 * Kept in test/ (run via `npm run test:e2e`), separate from the unit suite,
 * so the expected pre-fix failures do not mask regressions in `npm test`.
 *
 * MAINTENANCE: adding a route without adding it here should be treated as
 * an incomplete change. The final test in this file fails if any route is
 * missing from the matrix.
 */

/** An unauthenticated caller must be rejected. */
const PROTECTED: [string, string][] = [
  // --- loans: correctly guarded today ---
  ['post', '/loans/apply'],
  ['get', '/loans/applications/mine'],
  ['get', '/loans/applications/pending-my-decision'],
  ['get', '/loans/applications/1'],
  ['post', '/loans/applications/1/director-decision'],
  ['post', '/loans/applications/1/finance-decision'],
  ['post', '/loans/applications/1/withdraw'],

  // --- loans: UNGUARDED TODAY (PRODUCTION-READINESS P0-4) ---
  ['post', '/loans/repayment/record'],
  ['get', '/loans/repayment-summary/1'],

  // --- mobile: guarded at class level, but no ownership check (P1-1) ---
  ['get', '/mobile/v1/dashboard/1'],
  ['get', '/mobile/v1/profile/1'],
  ['get', '/mobile/v1/eligibility/1'],
  ['get', '/mobile/v1/history/1'],
  ['get', '/mobile/v1/report/1'],
  ['post', '/mobile/v1/auth/logout'],

  // --- multiplier: ENTIRE CONTROLLER UNGUARDED TODAY (P0-1) ---
  ['post', '/multiplier/process'],
  ['post', '/multiplier/contribution/on-time'],
  ['post', '/multiplier/contribution/late'],
  ['post', '/multiplier/repayment/on-time'],
  ['post', '/multiplier/repayment/late'],
  ['post', '/multiplier/loan/early-payoff'],
  ['get', '/multiplier/profile/1'],
  ['get', '/multiplier/history/1'],
  // P0-2: this one also PERSISTS an attacker-supplied contributionBalance
  ['get', '/multiplier/eligibility/1'],
  ['post', '/multiplier/eligibility/1/refresh'],
  ['post', '/multiplier/eligibility/refresh-all'],
  ['post', '/multiplier/test/1'],

  // --- contributions: ENTIRE CONTROLLER UNGUARDED TODAY (P0-3) ---
  ['post', '/contributions/record'],
  ['get', '/contributions/1/summary'],

  // --- admin surfaces (ApiKeyGuard) ---
  ['post', '/auth/users'],
  ['get', '/auth/users'],
  ['get', '/reports/dashboard'],
  ['get', '/reports/audit'],
  ['get', '/reports/clients'],
  ['get', '/reports/clients/1'],
  ['get', '/reports/eligibility'],
  ['get', '/reports/events/summary'],
  ['get', '/webhooks/fineract/pending-onboarding'],
  ['post', '/webhooks/fineract/pending-onboarding/1/resolve'],

  // --- Fineract webhook receivers: UNGUARDED TODAY ---
  // Each mutates a member's multiplier, so each is the P0-1 exploit through
  // a different door. Only USER/CREATE is registered in Fineract (verified
  // against m_hook_registered_events 2026-08-24), so nothing legitimate
  // calls these. They need a shared-secret guard or deletion.
  ['post', '/webhooks/fineract/contribution/on-time'],
  ['post', '/webhooks/fineract/contribution/late'],
  ['post', '/webhooks/fineract/repayment/on-time'],
  ['post', '/webhooks/fineract/repayment/late'],
  ['post', '/webhooks/fineract/loan/early-payoff'],

  // P0-0: returns a single-use confirm token in its response body, which
  // maps a caller-supplied username onto any unmapped member's clientId.
  // Must require a shared secret only n8n holds (Phase 2.1).
  ['post', '/webhooks/fineract/user/create'],
];

/** Deliberately reachable without a bearer token. */
const PUBLIC: [string, string][] = [
  ['get', '/'], // health probe
  ['post', '/mobile/v1/auth/login'], // this IS the login
  // Carries no bearer token by design — it is authorised by the refresh
  // token in its body. With the empty body sent below it returns 400 from
  // the ValidationPipe, which is a rejection by validation, not by auth.
  ['post', '/mobile/v1/auth/refresh'],
  ['post', '/auth/login'], // legacy env-based API-key login
  ['get', '/auth/validate'], // token-validity oracle

  // Clicked by a human from an email; authorised by the single-use token in
  // the query string rather than by a bearer token.
  ['get', '/webhooks/fineract/onboarding/confirm'],
  ['post', '/webhooks/fineract/onboarding/confirm'],
];

const REJECTED = [401, 403];

describe('Auth matrix (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Guards run before any handler, so a rejected request never reaches
      // the database. Stubbing Prisma keeps this suite runnable without
      // infrastructure — and means a 500 from a missing DB can never be
      // mistaken for a route being correctly locked down.
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts, so validation behaves as it does in production and a
    // 400 here means the same thing it means live.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    // Booting the full module graph exceeds Jest's default 5s hook timeout.
  }, 60_000);

  afterAll(async () => {
    // Closing waits on BullMQ's Redis connection to drain, which is slow
    // when Redis is not present (as it is not, here).
    await app?.close();
  }, 60_000);

  describe('routes that must reject an unauthenticated caller', () => {
    // Generous timeout: an unguarded route reaches its handler, and some
    // handlers call Fineract over HTTP, which has no route to anywhere from
    // a test runner. A slow response here is itself a symptom of the bug —
    // a guarded route rejects in milliseconds without touching the network.
    it.each(PROTECTED)(
      '%s %s → 401/403',
      async (method, path) => {
        const res = await request(app.getHttpServer())[method](path).send({});
        expect(REJECTED).toContain(res.status);
      },
      30_000,
    );
  });

  describe('routes that are deliberately public', () => {
    // Asserts only that auth did not reject them. The status may be 200,
    // 400 (validation), or 404 (bad token) depending on the payload — what
    // matters is that the request was not turned away for lack of a token.
    it.each(PUBLIC)(
      '%s %s → not rejected by auth',
      async (method, path) => {
        const res = await request(app.getHttpServer())[method](path).send({});
        expect(REJECTED).not.toContain(res.status);
      },
      30_000,
    );
  });

  // Guards against the failure mode this file exists to prevent: a new
  // endpoint shipping without anyone deciding whether it should be public.
  it('every registered route appears in the matrix', () => {
    // Express 5 exposes `router`; Express 4 exposed `_router`. Read through
    // the Nest adapter rather than the raw http.Server, whose internals
    // differ again between versions.
    type Layer = {
      route?: { path: string; methods: Record<string, boolean> };
    };
    const expressApp = app.getHttpAdapter().getInstance() as {
      router?: { stack: Layer[] };
      _router?: { stack: Layer[] };
    };
    const router = expressApp.router ?? expressApp._router;
    if (!router) {
      throw new Error(
        'Could not read the Express router stack — this Express version ' +
          'stores it elsewhere. Fix this introspection rather than deleting ' +
          'the test: it is what stops a new route shipping unreviewed.',
      );
    }

    const registered: string[] = router.stack.flatMap((layer) =>
      layer.route
        ? [
            `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`.toLowerCase(),
          ]
        : [],
    );

    const covered = new Set(
      [...PROTECTED, ...PUBLIC].map(([m, p]) => `${m} ${p}`.toLowerCase()),
    );

    // Express stores parameterised routes as :param, so normalise the
    // concrete ids used above (…/1) back to the declared parameter names.
    const uncovered = registered.filter((route) => {
      if (covered.has(route)) return false;
      const pattern = new RegExp(
        '^' + route.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$',
      );
      return ![...covered].some((c) => pattern.test(c));
    });

    expect(uncovered).toEqual([]);
  });
});
