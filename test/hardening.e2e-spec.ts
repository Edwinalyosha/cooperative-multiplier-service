import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 5 hardening: rate limiting and Swagger gating.
 *
 * Deliberately its OWN suite with its own app instance. The throttler keys
 * on client IP and every test here shares one, so mixing these with the auth
 * or ownership matrices would have each suite eating the other's budget and
 * produce 429s that read as auth failures.
 */
describe('Hardening (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'hardening-e2e-secret-at-least-32-chars';
    process.env.WEBHOOK_SHARED_SECRET = 'hardening-e2e-webhook-secret';
    process.env.ADMIN_API_KEY = 'hardening-e2e-admin-key';
    // Leave the general limit high: this suite is testing the LOGIN limit,
    // which is a decorator constant and applies regardless.
    process.env.THROTTLE_LIMIT = '10000';
    // Explicitly unset, to assert the default is closed rather than open.
    delete process.env.SWAGGER_ENABLED;

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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe('login rate limiting', () => {
    /**
     * Mobile login validates the password against Fineract's own
     * /authentication, so an unthrottled brute force does not merely hammer
     * this service — it hammers Fineract, and can trip Fineract's account
     * lockout for the member being guessed at. Throttling protects the
     * member's ability to log in, not just our uptime.
     */
    it('blocks a 6th login attempt within the window', async () => {
      const attempt = () =>
        request(app.getHttpServer())
          .post('/mobile/v1/auth/login')
          .send({ username: 'guesser', password: 'wrong' });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await attempt()).status);
      }

      // The first five are allowed through to be rejected on their merits;
      // only the sixth is refused for rate.
      expect(statuses.slice(0, 5)).not.toContain(429);
      expect(statuses[5]).toBe(429);
    }, 60_000);

    it('does not throttle ordinary traffic at the login rate', async () => {
      // The health probe shares the global limit, not login's. Six requests
      // must not trip it, or the login rule has leaked onto everything.
      for (let i = 0; i < 6; i++) {
        const res = await request(app.getHttpServer()).get('/');
        expect(res.status).not.toBe(429);
      }
    }, 60_000);
  });

  describe('Swagger', () => {
    /**
     * /api/docs published a complete index of every endpoint and which ones
     * carried @ApiBearerAuth — the map an attacker would otherwise build by
     * hand. It was reachable unauthenticated until 2026-08-28.
     */
    it('is OFF when SWAGGER_ENABLED is unset', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs');
      expect(res.status).toBe(404);
    });

    it('does not serve the OpenAPI JSON either', async () => {
      // Gating only the UI while leaving the spec served would give away the
      // same information in a more convenient form.
      const res = await request(app.getHttpServer()).get('/api/docs-json');
      expect(res.status).toBe(404);
    });
  });
});
