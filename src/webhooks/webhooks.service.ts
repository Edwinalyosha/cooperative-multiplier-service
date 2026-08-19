import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
   * Consumes a confirm-link token: validates it (exists, PENDING,
   * unexpired), creates the real User mapping row, and marks the
   * PendingOnboarding entry RESOLVED. Single-use — the token is cleared
   * (set null) as part of the same update, so a reused/replayed link
   * fails the "exists" check on its second use.
   *
   * passwordHash is a random, nobody-knows-it placeholder: the hybrid-auth
   * switch to Fineract-based login (ONBOARDING-AND-AUTH-PLAN.md step 3)
   * isn't built yet, so this row can't actually log in via password today.
   * It's forward-compatible — once step 3 ships, this row just starts
   * working, no re-creation needed.
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

    // Guard against the same Fineract Client already having a User mapping
    // (User.clientId is unique — one director-webapp login per Client).
    // Caught this the hard way 2026-08-19: repeated test payloads all
    // matched clientId 1, which john_doe_test already owns, and the raw
    // DB constraint violation bubbled up as an unhandled 500 instead of a
    // clean message. Checking proactively here for a clear result; the
    // transaction below is still wrapped as a safety net for the race
    // where two confirms land concurrently.
    const existing = await this.prisma.user.findUnique({
      where: { clientId: entry.suggestedClientId },
    });
    if (existing) {
      return {
        outcome: 'already_mapped',
        existingUsername: existing.username,
        clientId: entry.suggestedClientId,
      };
    }

    const placeholderPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);

    try {
      await this.prisma.$transaction([
        this.prisma.user.create({
          data: {
            username: entry.fineractUsername,
            clientId: entry.suggestedClientId,
            passwordHash,
            role: 'DIRECTOR',
          },
        }),
        this.prisma.pendingOnboarding.update({
          where: { id: entry.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedClientId: entry.suggestedClientId,
            confirmToken: null,
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
        // Concurrent confirm won the race between our check above and this
        // write. Re-fetch so the message is accurate either way.
        const raceWinner = await this.prisma.user.findUnique({
          where: { clientId: entry.suggestedClientId },
        });
        return {
          outcome: 'already_mapped',
          existingUsername: raceWinner?.username ?? '(unknown)',
          clientId: entry.suggestedClientId,
        };
      }
      throw error;
    }

    return {
      outcome: 'confirmed',
      username: entry.fineractUsername,
      clientId: entry.suggestedClientId,
    };
  }
}
