import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  /**
   * Note this deliberately does NOT honour @Public(), unlike MobileJwtGuard.
   *
   * @Public() means "this route does not require a JWT" — it is read by the
   * global MobileJwtGuard. Routes carrying @UseGuards(ApiKeyGuard) are marked
   * @Public() precisely so they can opt out of JWT and use the API key
   * instead. If this guard also honoured the marker, that opt-out would
   * switch off both schemes and leave the route unauthenticated.
   *
   * That is not hypothetical: it is exactly what happened when the global
   * guard was introduced on 2026-08-24, and it silently opened
   * POST /auth/users (which mints a login with any role and clientId), all
   * of /reports, and the manual onboarding resolve. The auth-matrix e2e
   * caught it. A guard applied explicitly to a route should enforce its own
   * scheme unconditionally.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';

    if (!this.authService.validateToken(token)) {
      throw new UnauthorizedException('Invalid or missing Bearer token');
    }

    return true;
  }
}
