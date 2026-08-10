import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
 * Authenticates against this service's own `User` table (see
 * context/loan-approval-workflow-spec.md) — deliberately NOT Fineract's own
 * user directory. Directors/finance manager get lightweight, app-scoped
 * credentials here rather than Fineract "Admin User" back-office access.
 *
 * JWT issuance + Redis-backed rotating refresh tokens are unchanged from
 * the original design — only the credential check and token payload
 * changed.
 */
@Injectable()
export class MobileAuthService {
  constructor(
    @Inject('MOBILE_AUTH_REDIS') private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async loginMobile(dto: MobileLoginDto): Promise<TokenResponseDto> {
    const user = await this.validateLocalUser(dto.username, dto.password);
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

  private async validateLocalUser(
    username: string,
    password: string,
  ): Promise<AppUserDto> {
    const user = await this.prisma.user.findUnique({ where: { username } });

    if (!user) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
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
