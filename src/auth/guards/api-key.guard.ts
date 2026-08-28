import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Static-API-key auth for the machine-facing admin surfaces, split into two
 * scopes on 2026-08-24.
 *
 * A single key previously covered both tiers below, which meant anyone who
 * needed a reports export also held the ability to mint a login mapped to any
 * member's clientId and role — the highest privilege in the system, since it
 * lets the holder *become* a member.
 *
 * ADMIN is a superset: it satisfies the reports scope too, so day-to-day
 * administration does not require juggling two keys. The point of the split
 * is that a reports key can be handed out without conferring identity
 * powers, and that either can be rotated without touching the other.
 *
 * These guards deliberately do NOT honour @Public(), unlike MobileJwtGuard.
 * @Public() means only "this route does not require a JWT" — routes here are
 * marked @Public() precisely so they can opt out of JWT and use an API key
 * instead. Honouring it here would switch off both schemes and leave the
 * route open. That is not hypothetical: it happened when the global guard
 * landed, silently exposing POST /auth/users and all of /reports, and the
 * auth-matrix e2e caught it.
 */
abstract class BaseApiKeyGuard implements CanActivate {
  protected abstract readonly scopeName: string;
  /** Config paths accepted for this scope, most privileged first. */
  protected abstract readonly acceptedKeyPaths: string[];

  private readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const accepted = this.acceptedKeyPaths
      .map((path) => this.config.get<string>(path))
      .filter((value): value is string => Boolean(value));

    // Fail CLOSED when nothing is configured. Chosen over refusing to boot
    // because the service runs under `restart: unless-stopped`: a hard boot
    // failure produces an endless crash loop that floods the log and takes
    // the whole API down, including endpoints that are fine. This way the
    // service stays up, the health probe answers, and only the affected
    // routes refuse — with a log line naming the missing variable.
    if (accepted.length === 0) {
      this.logger.error(
        `No API key configured for the ${this.scopeName} scope ` +
          `(expected one of: ${this.acceptedKeyPaths.join(', ')}). ` +
          'Refusing all requests to this route.',
      );
      throw new ServiceUnavailableException(
        `${this.scopeName} API not configured`,
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';

    if (!accepted.some((key) => constantTimeEquals(token, key))) {
      throw new UnauthorizedException(
        `Invalid or missing Bearer token for the ${this.scopeName} scope`,
      );
    }

    return true;
  }
}

/**
 * Constant-time comparison. A plain `===` short-circuits at the first
 * differing byte, leaking the length of the matching prefix through timing
 * and letting a caller who can retry recover the key byte by byte.
 * timingSafeEqual requires equal-length buffers, so compare lengths first.
 */
function constantTimeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Both subclasses declare their constructor explicitly rather than inheriting
 * it. TypeScript only emits `design:paramtypes` for a class that declares its
 * own constructor, and Nest reads that metadata to resolve dependencies — so
 * inheriting the base constructor silently produces a guard built with zero
 * arguments and an undefined `config`, which fails at request time with a 500
 * rather than at boot. (Hit exactly this on 2026-08-24; the auth-matrix e2e
 * caught it, typecheck could not.)
 */

/** Identity operations: create/list logins, resolve pending onboarding. */
@Injectable()
export class AdminApiKeyGuard extends BaseApiKeyGuard {
  protected readonly scopeName = 'admin';
  protected readonly acceptedKeyPaths = ['api.adminKey'];

  constructor(config: ConfigService) {
    super(config);
  }
}

/** Read-only reporting. Also satisfied by the admin key. */
@Injectable()
export class ReportsApiKeyGuard extends BaseApiKeyGuard {
  protected readonly scopeName = 'reports';
  protected readonly acceptedKeyPaths = ['api.adminKey', 'api.reportsKey'];

  constructor(config: ConfigService) {
    super(config);
  }
}
