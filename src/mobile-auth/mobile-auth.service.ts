import {
  Injectable,
  Inject,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { redactFineractError } from '../fineract/fineract-error.util';
import { FineractService } from '../fineract/fineract.service';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { TokenResponseDto, AppUserDto } from './dto/token-response.dto';
import { MobileJwtPayload } from './strategies/mobile-jwt.strategy';

interface StoredRefreshData {
  userId: number;
  username: string;
  role: UserRole;
  clientId: number | null;
}

/**
 * HYBRID AUTH (ONBOARDING-AND-AUTH-PLAN.md step 3, built 2026-08-19):
 * password identity now lives in Fineract's own /authentication — one
 * password per person, managed in Fineract's existing Admin → Users
 * screen. App-level authorization (role, clientId, and all the
 * quorum/guarantor/expiry business logic) stays entirely in our own
 * `User` table (see context/loan-approval-workflow-spec.md) — Fineract
 * has no concept of any of that and never will.
 *
 * `User.passwordHash` is now VESTIGIAL — no longer read here. Left in the
 * schema/DTO rather than dropped in this same change, to avoid also
 * having to touch the legacy admin-created-user flow (auth.service.ts
 * createUser) and the onboarding-confirm placeholder-password logic
 * (webhooks.service.ts) in the same diff. Follow-up, not urgent: Fineract
 * being unreachable now means login is unavailable too — a real but
 * accepted new coupling, per the plan's explicit tradeoff discussion.
 *
 * Existing disposable test accounts (john_doe_test etc.) have no
 * corresponding real Fineract User — they now simply fail Fineract auth
 * and stop working. Expected, called out in the plan.
 *
 * JWT issuance + Redis-backed rotating refresh tokens are unchanged from
 * the original design — only the credential check changed.
 */
@Injectable()
export class MobileAuthService {
  private readonly logger = new Logger(MobileAuthService.name);

  constructor(
    @Inject('MOBILE_AUTH_REDIS') private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly fineract: FineractService,
  ) {}

  async loginMobile(dto: MobileLoginDto): Promise<TokenResponseDto> {
    const user = await this.validateFineractUser(dto.username, dto.password);
    return this.issueTokenPair(user);
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponseDto> {
    const key = `mobile_refresh:${refreshToken}`;
    const stored = await this.redis.get(key);

    if (!stored) {
      throw new UnauthorizedException('REFRESH_EXPIRED');
    }

    const data = JSON.parse(stored) as StoredRefreshData;

    // Token rotation: delete old key before issuing new tokens
    await this.redis.del(key);

    return this.issueTokenPair({
      id: data.userId,
      username: data.username,
      role: data.role,
      clientId: data.clientId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.redis.del(`mobile_refresh:${refreshToken}`);
  }

  private async validateFineractUser(
    username: string,
    password: string,
  ): Promise<AppUserDto> {
    // Identity/password check: Fineract's own /authentication. This is
    // the ONLY password check now — see class-level comment.
    // FineractService.authenticateUser returns null for bad credentials
    // (401/400) but THROWS for a genuine outage (timeout, 5xx, network) —
    // caught here and converted to a distinct 503 so "Fineract is down"
    // never looks identical to "wrong password" to an API consumer.
    let fineractAuth;
    try {
      fineractAuth = await this.fineract.authenticateUser(username, password);
    } catch (error) {
      this.logger.error(
        `Fineract unreachable during login: ${redactFineractError(error)}`,
      );
      throw new ServiceUnavailableException('FINERACT_UNREACHABLE');
    }
    if (!fineractAuth) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    // Authorization (role/clientId): still entirely our own table.
    // Fineract username must match ours exactly — see
    // ONBOARDING-AND-AUTH-PLAN.md's User-migration note.
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Real, valid Fineract login — just never onboarded into this app's
      // own mapping table (see PendingOnboarding / the onboarding-confirm
      // flow). Distinct code from INVALID_CREDENTIALS so this is
      // debuggable rather than looking identical to a wrong password.
      throw new UnauthorizedException('NOT_ONBOARDED');
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
    };
  }

  private async issueTokenPair(user: AppUserDto): Promise<TokenResponseDto> {
    const payload: Omit<MobileJwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
    };

    const secret = this.config.get<string>('jwt.accessSecret');
    const expiresIn =
      this.config.get<string>('jwt.accessExpiresIn') ?? '15m';
    const refreshTtl =
      this.config.get<number>('jwt.refreshTtlSeconds') ?? 604800;

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });

    const refreshToken = randomUUID();

    const storedData: StoredRefreshData = {
      userId: user.id,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
    };

    await this.redis.set(
      `mobile_refresh:${refreshToken}`,
      JSON.stringify(storedData),
      'EX',
      refreshTtl,
    );

    return { accessToken, refreshToken, expiresIn: 900, user };
  }
}
