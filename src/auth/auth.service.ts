import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';

/** See api-key.guard.ts for why comparisons here are constant-time. */
function constantTimeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Legacy admin login: exchanges env-configured credentials for the static
   * admin API key. Per-person login for the loan-approval workflow lives in
   * mobile-auth/mobile-auth.service.ts against the User table instead.
   *
   * All three values previously had fallbacks — 'admin' / 'changeme' /
   * 'dev-api-key' — every one of them committed to this repository. Had the
   * env vars been unset in production, anyone who read the source could have
   * logged in here and received a key that mints logins mapped to any
   * member's clientId. Now fails closed.
   */
  login(dto: LoginDto): AuthTokenResponse {
    const expectedUser = this.config.get<string>('api.username');
    const expectedPass = this.config.get<string>('api.password');
    const adminKey = this.config.get<string>('api.adminKey');

    if (!expectedUser || !expectedPass || !adminKey) {
      this.logger.error(
        'Legacy admin login is not configured (needs API_USERNAME, ' +
          'API_PASSWORD, ADMIN_API_KEY). Refusing to authenticate.',
      );
      throw new ServiceUnavailableException('Admin login not configured');
    }

    // Constant-time on both fields: a plain !== leaks the matching prefix
    // length through timing, which is enough to recover a password by retry.
    const userOk = constantTimeEquals(dto.username, expectedUser);
    const passOk = constantTimeEquals(dto.password, expectedPass);
    if (!userOk || !passOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: adminKey,
      tokenType: 'Bearer',
      // The token IS the static API key, so it does not actually expire.
      // Reported for client compatibility; rotation is manual. See
      // director-webapp/RESOLUTION-PLAN.md Phase 2.3.
      expiresIn: 86400,
    };
  }

  /**
   * Backs GET /auth/validate. Accepts either scope — the endpoint answers
   * "is this token good for anything", not "what may it do". Authorisation
   * is enforced by AdminApiKeyGuard / ReportsApiKeyGuard on each route.
   */
  validateToken(token: string): boolean {
    if (!token) return false;
    return [
      this.config.get<string>('api.adminKey'),
      this.config.get<string>('api.reportsKey'),
    ]
      .filter((key): key is string => Boolean(key))
      .some((key) => constantTimeEquals(token, key));
  }

  /**
   * Admin-only (see auth.controller.ts — guarded by AdminApiKeyGuard, same as
   * /reports/*). Creates one of the fixed set of director/finance-manager
   * logins for the loan-approval workflow. Not public self-registration.
   */
  async createUser(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException(`Username '${dto.username}' already exists`);
    }

    if (dto.clientId !== undefined && dto.clientId !== null) {
      const existingClientLink = await this.prisma.user.findUnique({
        where: { clientId: dto.clientId },
      });
      if (existingClientLink) {
        throw new ConflictException(
          `clientId ${dto.clientId} is already linked to user '${existingClientLink.username}'`,
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: dto.role,
        clientId: dto.clientId ?? null,
      },
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
      createdAt: user.createdAt,
    };
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      clientId: u.clientId,
      createdAt: u.createdAt,
    }));
  }
}
