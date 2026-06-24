import {
  Injectable,
  Inject,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { Redis } from 'ioredis';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { TokenResponseDto, FineractUserDto } from './dto/token-response.dto';
import { MobileJwtPayload } from './strategies/mobile-jwt.strategy';

interface StoredRefreshData {
  userId: number;
  username: string;
  displayName: string;
  officeId: number;
}

@Injectable()
export class MobileAuthService {
  constructor(
    @Inject('MOBILE_AUTH_REDIS') private readonly redis: Redis,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async loginMobile(dto: MobileLoginDto): Promise<TokenResponseDto> {
    const user = await this.validateWithFineract(dto.username, dto.password);
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
      displayName: data.displayName,
      officeId: data.officeId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.redis.del(`mobile_refresh:${refreshToken}`);
  }

  private async validateWithFineract(
    username: string,
    password: string,
  ): Promise<FineractUserDto> {
    const baseUrl = this.config.get<string>('fineract.baseUrl');
    const tenantId =
      this.config.get<string>('fineract.tenantId') ?? 'default';

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${baseUrl}/fineract-provider/api/v1/authentication`,
          { username, password },
          {
            headers: {
              'Fineract-Platform-TenantId': tenantId,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        ),
      );

      const d = response.data;
      return {
        id: d.userId as number,
        username: d.username as string,
        displayName: d.displayName as string,
        officeId: d.officeId as number,
      };
    } catch (error: unknown) {
      const status = (error as any)?.response?.status;
      if (status === 401) {
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      }
      throw new ServiceUnavailableException('FINERACT_UNAVAILABLE');
    }
  }

  private async issueTokenPair(user: FineractUserDto): Promise<TokenResponseDto> {
    const payload: Omit<MobileJwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      officeId: user.officeId,
    };

    const secret = this.config.get<string>('jwt.accessSecret');
    const expiresIn =
      this.config.get<string>('jwt.accessExpiresIn') ?? '15m';
    const refreshTtl =
      this.config.get<number>('jwt.refreshTtlSeconds') ?? 604800;

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn,
    });

    const refreshToken = uuidv4();

    const storedData: StoredRefreshData = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      officeId: user.officeId,
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
