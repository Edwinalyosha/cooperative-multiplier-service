import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { FineractWebhookDto } from './dto/fineract-event.dto';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

/** Public base URL this API is actually reachable at — used to build the
 * confirm-link sent in the onboarding email. Not yet in config/env; see
 * ONBOARDING-AND-AUTH-PLAN.md context for why this whole flow is new. */
const PUBLIC_API_BASE_URL = 'https://api.sagehive.cloud';

/** How long a confirm link stays valid before it's rejected as expired. */
const CONFIRM_TOKEN_TTL_HOURS = 72;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
    private readonly prisma: PrismaService,
    private readonly fineract: FineractService,
  ) {}

  private async dispatch(
    dto: FineractWebhookDto,
    eventType: MultiplierEventType,
    defaultNote: string,
  ) {
    const notes =
      dto.notes ??
      `${defaultNote} (external: ${dto.externalId ?? 'n/a'})`;

    if (this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        'fineract-webhook',
        notes,
      );
    }

    return this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      'fineract-webhook',
      notes,
    );
  }

  handleContributionOnTime(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'Contribution on time',
    );
  }

  handleContributionLate(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.LATE_CONTRIBUTION,
      'Contribution late',
    );
  }

  handleRepaymentOnTime(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.ON_TIME_REPAYMENT,
      'Repayment on time',
    );
  }

  handleRepaymentLate(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.LATE_REPAYMENT,
      'Repayment late',
    );
  }

  handleEarlyPayoff(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.EARLY_FULL_PAYOFF,
      'Early payoff',
    );
  }

  /**
   * Picks the first non-empty string value across a list of possible key
   * names. Used because we genuinely don't yet know which key names the
   * real Fineract hook payload uses (see PendingOnboarding's schema comment)
   * — this is a discovery endpoint, not a validated contract.
   */
  private pickString(
    payload: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }

  async captureFineractUserCreate(rawPayload: Record<string, unknown>) {
    // n8n's Extract Fields node sends its best-guess parsed fields
    // top-level, plus the untouched Fineract hook body under `rawPayload`.
    // Fall back to the whole request body if `rawPayload` wasn't sent
    // (e.g. a manual test POST without going through n8n).
    const raw = rawPayload.rawPayload ?? rawPayload;

    const email = this.pickString(rawPayload, ['email']);

    const entry = await this.prisma.pendingOnboarding.create({
      data: {
        fineractUsername: this.pickString(rawPayload, ['username']),
        email,
        firstname: this.pickString(rawPayload, ['firstname']),
        lastname: this.pickString(rawPayload, ['lastname']),
        fineractRole: this.pickString(rawPayload, ['role', 'fineractRole']),
        rawPayload: raw as Prisma.InputJsonValue,
      },
    });

    // Suggest a clientId via exact-email match against Fineract Clients.
    // SUGGESTION only — never applied without a human clicking the emailed
    // confirm link. Zero or multiple matches: leave unresolved, no token
    // issued, entry just sits PENDING for manual handling.
    let confirmUrl: string | undefined;
    if (email) {
      const matches = await this.fineract.searchClientsByEmail(email);
      if (matches.length === 1) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenExpiresAt = new Date(
          Date.now() + CONFIRM_TOKEN_TTL_HOURS * 60 * 60 * 1000,
        );
        await this.prisma.pendingOnboarding.update({
          where: { id: entry.id },
          data: {
            suggestedClientId: matches[0].id,
            confirmToken: token,
            tokenExpiresAt,
          },
        });
        confirmUrl = `${PUBLIC_API_BASE_URL}/webhooks/fineract/onboarding/confirm?token=${token}`;
      } else {
        this.logger.log(
          `PendingOnboarding ${entry.id}: ${matches.length} Fineract Client email matches for ${email} — leaving unresolved for manual handling.`,
        );
      }
    }

    return {
      id: entry.id,
      status: entry.status,
      confirmUrl,
    };
  }

  listPendingOnboarding() {
    return this.prisma.pendingOnboarding.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Read-only lookup for the confirm link's preview step (GET). Validates
   * the token but creates/changes nothing — see confirmOnboarding for why
   * this is split from the actual mutating action.
   */
  async previewOnboarding(token: string): Promise<
    | {
        outcome: 'ok';
        username: string;
        firstname: string | null;
        lastname: string | null;
        clientId: number;
      }
    | { outcome: 'not_found' }
    | { outcome: 'expired' }
    | { outcome: 'already_resolved' }
  > {
    const entry = await this.prisma.pendingOnboarding.findUnique({
      where: { confirmToken: token },
    });
    if (!entry) return { outcome: 'not_found' };
    if (entry.status !== 'PENDING') return { outcome: 'already_resolved' };
    if (!entry.tokenExpiresAt || entry.tokenExpiresAt < new Date()) {
      return { outcome: 'expired' };
    }
    if (!entry.suggestedClientId || !entry.fineractUsername) {
      return { outcome: 'not_found' };
    }
    return {
      outcome: 'ok',
      username: entry.fineractUsername,
      firstname: entry.firstname,
      lastname: entry.lastname,
      clientId: entry.suggestedClientId,
    };
  }

  /**
   * Creates the User mapping row for a PendingOnboarding entry and marks it
   * RESOLVED, with a proactive collision check plus a P2002 catch as a
   * safety net for a concurrent race (see confirmOnboarding's history:
   * caught a real unhandled 500 here 2026-08-19 before this existed).
   *
   * passwordHash is a random, nobody-knows-it placeholder: the hybrid-auth
   * switch to Fineract-based login (ONBOARDING-AND-AUTH-PLAN.md step 3)
   * isn't built yet, so this row can't actually log in via password today.
   * It's forward-compatible — once step 3 ships, this row just starts
   * working, no re-creation needed.
   */
  private async createMappingRow(
    entryId: number,
    username: string,
    clientId: number,
    role: UserRole,
    clearToken: boolean,
  ): Promise<
    | { outcome: 'confirmed'; username: string; clientId: number }
    | { outcome: 'already_mapped'; existingUsername: string; clientId: number }
  > {
    const existing = await this.prisma.user.findUnique({
      where: { clientId },
    });
    if (existing) {
      return {
        outcome: 'already_mapped',
        existingUsername: existing.username,
        clientId,
      };
    }

    const placeholderPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);

    try {
      await this.prisma.$transaction([
        this.prisma.user.create({
          data: { username, clientId, passwordHash, role },
        }),
        this.prisma.pendingOnboarding.update({
          where: { id: entryId },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedClientId: clientId,
            ...(clearToken ? { confirmToken: null } : {}),
          },
        }),
      ]);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const raceWinner = await this.prisma.user.findUnique({
          where: { clientId },
        });
        return {
          outcome: 'already_mapped',
          existingUsername: raceWinner?.username ?? '(unknown)',
          clientId,
        };
      }
      throw error;
    }

    return { outcome: 'confirmed', username, clientId };
  }

  /**
   * Consumes a confirm-link token (POST only — see webhooks.controller.ts
   * for why GET is a separate, non-mutating preview): validates it (exists,
   * PENDING, unexpired), then delegates to createMappingRow. Single-use —
   * the token is cleared as part of the same update, so a reused/replayed
   * link fails the "exists" check on its second use.
   */
  async confirmOnboarding(
    token: string,
  ): Promise<
    | { outcome: 'confirmed'; username: string; clientId: number }
    | { outcome: 'not_found' }
    | { outcome: 'expired' }
    | { outcome: 'already_resolved' }
    | { outcome: 'already_mapped'; existingUsername: string; clientId: number }
  > {
    const entry = await this.prisma.pendingOnboarding.findUnique({
      where: { confirmToken: token },
    });
    if (!entry) return { outcome: 'not_found' };
    if (entry.status !== 'PENDING') return { outcome: 'already_resolved' };
    if (!entry.tokenExpiresAt || entry.tokenExpiresAt < new Date()) {
      return { outcome: 'expired' };
    }
    if (!entry.suggestedClientId || !entry.fineractUsername) {
      return { outcome: 'not_found' };
    }

    // Auto-confirm (email-match) path is scoped to Director onboarding
    // only — the original discussion that shaped this pipeline explicitly
    // limited it to Director, not Finance Manager or other roles. Finance
    // Manager (and anything else) goes through manualResolveOnboarding
    // below, where an admin picks the role explicitly.
    return this.createMappingRow(
      entry.id,
      entry.fineractUsername,
      entry.suggestedClientId,
      'DIRECTOR',
      true,
    );
  }

  /**
   * Admin-only (ApiKeyGuard, same convention as POST /auth/users) manual
   * resolution for entries that never got an auto-match confirm link —
   * zero/multiple Fineract Client email matches, OR a role other than
   * Director (Finance Manager onboarding always goes through here, never
   * the auto-confirm path — see confirmOnboarding's comment).
   */
  async manualResolveOnboarding(
    id: number,
    clientId: number,
    role: UserRole,
  ): Promise<
    | { outcome: 'confirmed'; username: string; clientId: number }
    | { outcome: 'already_mapped'; existingUsername: string; clientId: number }
    | { outcome: 'not_found' }
    | { outcome: 'already_resolved' }
  > {
    const entry = await this.prisma.pendingOnboarding.findUnique({
      where: { id },
    });
    if (!entry || !entry.fineractUsername) return { outcome: 'not_found' };
    if (entry.status !== 'PENDING') return { outcome: 'already_resolved' };

    return this.createMappingRow(
      entry.id,
      entry.fineractUsername,
      clientId,
      role,
      false,
    );
  }
}
