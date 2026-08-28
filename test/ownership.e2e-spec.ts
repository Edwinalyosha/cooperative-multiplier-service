import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * OWNERSHIP MATRIX
 * ================
 * The auth matrix answers "may a stranger reach this route". This answers
 * the next question: "may an authenticated member reach ANOTHER member's
 * data". Those are independent failures — every route here already required
 * a valid token and was still readable by the wrong person (P1-1, P1-2).
 *
 * The endpoints take a :clientId in the URL and, until 2026-08-24, used it
 * verbatim. Any member could change the number and read another's savings
 * balance, borrowing limit, multiplier standing, and full audit report. In a
 * cooperative where members know each other personally, that is the finding
 * most likely to cause real harm, and it needs no skill beyond editing a URL.
 *
 * Tokens are minted here rather than obtained through /auth/login, because
 * login validates against Fineract and this suite runs with no network and a
 * stubbed database. What matters is that they are signed with the same secret
 * the running app verifies with, so the guards treat them as genuine.
 */

const JWT_SECRET = 'ownership-e2e-secret-at-least-32-chars';

/** Alice: a director who owns client 2. */
const ALICE_CLIENT_ID = 2;
/** Bob: a different director, client 3. Alice must never reach Bob's data. */
const BOB_CLIENT_ID = 3;

function tokenFor(
  role: UserRole,
  clientId: number | null,
  sub = 1,
): string {
  return jwt.sign(
    { sub, username: `user-${sub}`, role, clientId },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

/** Routes taking a :clientId that must belong to the caller. */
const CLIENT_SCOPED_PATHS = [
  '/mobile/v1/dashboard',
  '/mobile/v1/profile',
  '/mobile/v1/eligibility',
  '/mobile/v1/history',
  '/mobile/v1/report',
  '/loans/repayment-summary',
];

describe('Ownership matrix (e2e)', () => {
  let app: INestApplication<App>;
  let aliceToken: string;
  let financeToken: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = JWT_SECRET;
    // The suites below fire ~100 requests from one IP in a few seconds. The
    // production default (120/min) would start returning 429 as they grow,
    // producing failures that look like auth bugs but are not. Raise it here;
    // the login-specific limit is a decorator constant and still applies.
    process.env.THROTTLE_LIMIT = '10000';
    process.env.WEBHOOK_SHARED_SECRET = 'ownership-e2e-webhook-secret';
    process.env.ADMIN_API_KEY = 'ownership-e2e-admin-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    aliceToken = tokenFor(UserRole.DIRECTOR, ALICE_CLIENT_ID, 1);
    // A finance manager has no client record of their own — User.clientId is
    // nullable precisely so the role can be held by a non-borrowing member.
    financeToken = tokenFor(UserRole.FINANCE_MANAGER, null, 2);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe("a director cannot read another member's record", () => {
    it.each(CLIENT_SCOPED_PATHS)(
      'GET %s/:otherClientId → 403',
      async (base) => {
        const res = await request(app.getHttpServer())
          .get(`${base}/${BOB_CLIENT_ID}`)
          .set('authorization', `Bearer ${aliceToken}`);
        expect(res.status).toBe(403);
      },
      30_000,
    );
  });

  describe('a director can still read their own record', () => {
    // Prisma is stubbed, so these reach a handler that cannot complete and
    // return 500. That is fine and deliberate: this suite asserts only that
    // authorisation let them through. A 401/403 here would mean the guard is
    // too strict and has locked members out of their own data — which would
    // be just as much a bug as the one being fixed, and far more visible.
    it.each(CLIENT_SCOPED_PATHS)(
      'GET %s/:ownClientId → not rejected',
      async (base) => {
        const res = await request(app.getHttpServer())
          .get(`${base}/${ALICE_CLIENT_ID}`)
          .set('authorization', `Bearer ${aliceToken}`);
        expect([401, 403]).not.toContain(res.status);
      },
      30_000,
    );
  });

  describe('the finance manager may read any member', () => {
    // Exempt by role: overseeing every member's position is the job. Note
    // this token carries clientId null, so it also proves the guard does not
    // fall back to comparing against a missing client record.
    it.each(CLIENT_SCOPED_PATHS)(
      'GET %s/:anyClientId → not rejected',
      async (base) => {
        const res = await request(app.getHttpServer())
          .get(`${base}/${BOB_CLIENT_ID}`)
          .set('authorization', `Bearer ${financeToken}`);
        expect([401, 403]).not.toContain(res.status);
      },
      30_000,
    );
  });

  describe('tokens that should not be honoured', () => {
    it('rejects a token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        {
          sub: 99,
          username: 'attacker',
          role: UserRole.FINANCE_MANAGER,
          clientId: null,
        },
        'not-the-real-secret-but-also-32-chars',
        { expiresIn: '15m' },
      );
      const res = await request(app.getHttpServer())
        .get(`/mobile/v1/dashboard/${BOB_CLIENT_ID}`)
        .set('authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const expired = jwt.sign(
        {
          sub: 1,
          username: 'alice',
          role: UserRole.DIRECTOR,
          clientId: ALICE_CLIENT_ID,
        },
        JWT_SECRET,
        { expiresIn: '-1h' },
      );
      const res = await request(app.getHttpServer())
        .get(`/mobile/v1/dashboard/${ALICE_CLIENT_ID}`)
        .set('authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('rejects a director whose account has no linked clientId', async () => {
      // Such an account cannot own any client record, so it must not be able
      // to read one by naming it.
      const unlinked = tokenFor(UserRole.DIRECTOR, null, 3);
      const res = await request(app.getHttpServer())
        .get(`/mobile/v1/dashboard/${BOB_CLIENT_ID}`)
        .set('authorization', `Bearer ${unlinked}`);
      expect(res.status).toBe(403);
    });
  });
});
