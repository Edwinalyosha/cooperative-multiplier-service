import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';

/**
 * Registered as an APP_GUARD (see app.module.ts), so it applies to EVERY
 * route by default. Authentication is therefore opt-OUT via @Public(),
 * rather than opt-in via @UseGuards() — which is the change that closes the
 * P0 findings in director-webapp/PRODUCTION-READINESS.md.
 *
 * The previous arrangement made "forgot a decorator" and "deliberately
 * public" indistinguishable in the source, and produced 22 unauthenticated
 * endpoints including ones that moved members' borrowing limits. Under this
 * arrangement the same mistake produces a 401, and a deliberate choice is
 * visible as an explicit @Public() that a reviewer can question.
 *
 * @Public() only switches off THIS guard. Route-level guards still run, so
 * endpoints carrying @UseGuards(ApiKeyGuard) or @UseGuards(WebhookSecretGuard)
 * are marked @Public() to opt out of JWT while keeping their own scheme.
 */
@Injectable()
export class MobileJwtGuard extends AuthGuard('mobile-jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
