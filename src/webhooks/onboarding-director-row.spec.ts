import { UserRole } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { OnboardingEmailService } from './onboarding-email.service';

/**
 * Resolving a member must also create their DirectorMultiplier row.
 *
 * It used to be lazy — created on first dashboard load — and the contribution
 * sweep iterates DirectorMultiplier. So a member who was onboarded but never
 * signed in was never assessed: no arrears, no penalty, while everyone who
 * did sign in was assessed normally. Inconsistent enforcement, and nothing
 * surfaced it. Found during the 2026-09-12 cutover.
 *
 * `createdAt` on that row is also what decides "too new to assess", so a late
 * first login used to push a member's assessment clock late with it.
 */
describe('WebhooksService — resolve creates the director row', () => {
  function build(opts: { ensureThrows?: boolean } = {}) {
    const ensured: number[] = [];
    const emails: string[] = [];

    const prisma = {
      pendingOnboarding: {
        findUnique: jest.fn(async () => ({
          id: 9,
          fineractUsername: 'NEWDIR',
          status: 'PENDING',
          email: 'dir@example.com',
          firstname: 'New',
        })),
        update: jest.fn(async () => ({})),
      },
      user: { findUnique: jest.fn(async () => null), create: jest.fn() },
      $transaction: jest.fn(async () => []),
    } as unknown as PrismaService;

    const multiplier = {
      ensureDirector: jest.fn(async (clientId: number) => {
        if (opts.ensureThrows) throw new Error('db down');
        ensured.push(clientId);
        return {} as never;
      }),
    } as unknown as MultiplierService;

    const onboardingEmail = {
      sendPortalReady: jest.fn(async (p: { username: string }) => {
        emails.push(p.username);
      }),
    } as unknown as OnboardingEmailService;

    const service = new WebhooksService(
      multiplier,
      {} as unknown as MultiplierQueueService,
      prisma,
      {} as unknown as FineractService,
      onboardingEmail,
    );

    return { service, ensured, emails, multiplier };
  }

  it('creates the DirectorMultiplier row for a DIRECTOR', async () => {
    const { service, ensured } = build();

    const result = await service.manualResolveOnboarding(
      9,
      6,
      UserRole.DIRECTOR,
    );

    expect(result).toEqual({
      outcome: 'confirmed',
      username: 'NEWDIR',
      clientId: 6,
    });
    // The row must exist now, not at first login — the sweep reads it.
    expect(ensured).toEqual([6]);
  });

  it('does NOT create one for a finance manager', async () => {
    const { service, ensured } = build();

    await service.manualResolveOnboarding(9, 6, UserRole.FINANCE_MANAGER);

    // A finance manager who is not a director has no weekly obligation. A row
    // would put a phantom member into the sweep and into the ownership-share
    // denominator, diluting everyone's real percentage.
    expect(ensured).toEqual([]);
  });

  it('still reports success, and still emails, if the row cannot be created', async () => {
    const { service, emails, multiplier } = build({ ensureThrows: true });

    const result = await service.manualResolveOnboarding(
      9,
      6,
      UserRole.DIRECTOR,
    );

    // The mapping is already committed and the member can log in. Failing
    // here would tempt a retry, and the retry would hit `already_mapped` —
    // strictly worse than a missing row that any later ensureDirector call
    // repairs.
    expect(result).toMatchObject({ outcome: 'confirmed' });
    expect(multiplier.ensureDirector).toHaveBeenCalled();
    expect(emails).toEqual(['NEWDIR']);
  });
});
