import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MobileJwtPayload } from '../strategies/mobile-jwt.strategy';

/**
 * Enforces that a `:clientId` route parameter refers to the caller's OWN
 * client record — closing P1-1 in director-webapp/PRODUCTION-READINESS.md.
 *
 * Those routes authenticated but never checked ownership: they took the
 * clientId straight from the URL, so any member could change the number and
 * read another member's savings balance, borrowing limit, multiplier
 * standing, and full audit report. In a cooperative where members know each
 * other personally, that is the finding most likely to cause real harm, and
 * it needs no skill beyond editing a URL.
 *
 * FINANCE_MANAGER is exempt: the role exists to oversee every member's
 * position, and it is deliberately decoupled from "is a director" (which is
 * why User.clientId is nullable — a finance manager may have no client record
 * of their own).
 *
 * Runs after MobileJwtGuard, which attaches request.user.
 *
 * This follows the pattern loans.controller.ts already documents — take the
 * caller's identity from the token, never from the request — applied to the
 * routes that had not adopted it.
 */
@Injectable()
export class ClientOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: MobileJwtPayload;
      params: Record<string, string>;
    }>();

    const user = request.user;
    if (!user) {
      // Only reachable if this guard is ever applied to a @Public() route.
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role === UserRole.FINANCE_MANAGER) {
      return true;
    }

    const raw = request.params?.clientId;
    if (raw === undefined) {
      // Misconfiguration, not a client error: the guard is on a route with no
      // :clientId to check. Fail closed rather than waving the request past.
      throw new ForbiddenException(
        'Ownership could not be verified for this route',
      );
    }

    const requested = Number(raw);
    if (!Number.isInteger(requested)) {
      throw new BadRequestException('clientId must be an integer');
    }

    if (user.clientId === null || user.clientId !== requested) {
      // Deliberately does not reveal whether the requested client exists.
      throw new ForbiddenException(
        'You may only access your own client record',
      );
    }

    return true;
  }
}
