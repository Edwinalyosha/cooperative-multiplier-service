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

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

/**
 * Shared-secret guard for the Fineract webhook receivers, which are called
 * by n8n rather than by a logged-in human, so they carry no JWT.
 *
 * Deliberately NOT ApiKeyGuard: that key also unlocks /reports and
 * POST /auth/users (which mints logins). A webhook receiver should not hold
 * that much authority just to report that someone made a contribution.
 *
 * Closes P0-0. POST /webhooks/fineract/user/create returns a single-use
 * confirm token in its response body; that token maps a caller-supplied
 * username onto any not-yet-onboarded member's clientId. Unauthenticated,
 * that is an identity-hijack primitive. Restricted to n8n, returning the
 * token is fine — n8n is the thing that needs it in order to send the email.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('webhooks.sharedSecret');

    // Fail CLOSED when unconfigured. `configuration.ts` deliberately gives
    // this no default value: a fallback secret is indistinguishable from a
    // real one at runtime, so the endpoint would look protected while being
    // open to anyone who has read the source. (See JWT_ACCESS_SECRET's
    // 'dev-jwt-secret-change-in-prod' fallback for the pattern being avoided
    // here.) Refusing to serve is noisy and safe; serving is quiet and not.
    if (!expected) {
      this.logger.error(
        'WEBHOOK_SHARED_SECRET is not configured — refusing all webhook ' +
          'traffic. Set it in the service environment and restart.',
      );
      throw new ServiceUnavailableException('Webhook receiver not configured');
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers[WEBHOOK_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : (header ?? '');

    if (!this.matches(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing webhook secret');
    }

    return true;
  }

  /**
   * Constant-time comparison. A plain `===` leaks the length of the matching
   * prefix through timing, which lets a caller who can retry recover the
   * secret byte by byte. timingSafeEqual requires equal lengths, so compare
   * lengths separately and only then the bytes.
   */
  private matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
