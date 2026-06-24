# Auth Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `mobile-auth` NestJS module that proxies Fineract credentials, issues JWT access tokens, and stores rotating UUID refresh tokens in Redis — without touching any existing auth infrastructure.

**Architecture:** New `src/mobile-auth/` module with its own controller, service, Passport JWT strategy, guard, and Redis provider. Existing `src/auth/` is untouched. `src/mobile/mobile.controller.ts` has its login route removed and its class-level guard swapped to `MobileJwtGuard`.

**Tech Stack:** NestJS 11, `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `ioredis`, `@nestjs/axios`, `ConfigService`, Jest + Supertest.

**Spec:** `director-app/docs/superpowers/specs/2026-06-24-auth-module-design.md`

**Working directory for all commands:** `cooperative-multiplier-service/`

---

### Task 1: Install packages, add env vars, extend configuration

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env`
- Modify: `src/config/configuration.ts`

- [ ] **Step 1: Install runtime dependencies**

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt uuid
```

Expected: packages added to `dependencies` in `package.json`, no peer dep errors.

- [ ] **Step 2: Install dev dependencies**

```bash
npm install -D @types/passport-jwt @types/uuid
```

- [ ] **Step 3: Add env vars to `.env`**

Add these three lines to the end of `.env`:

```dotenv
JWT_ACCESS_SECRET=changeme-replace-with-64-char-random-hex-before-production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_TTL_SECONDS=604800
```

- [ ] **Step 4: Extend `src/config/configuration.ts` with jwt section**

Current file ends after the `mobile` block. Add a `jwt` block:

```typescript
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  fineract: {
    baseUrl: process.env.FINERACT_BASE_URL,
    tenantId: process.env.FINERACT_TENANT_ID ?? 'default',
    username: process.env.FINERACT_USERNAME,
    password: process.env.FINERACT_PASSWORD,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  queue: {
    asyncEnabled: process.env.QUEUE_ASYNC_ENABLED !== 'false',
  },
  eligibility: {
    cacheTtlMinutes: parseInt(
      process.env.ELIGIBILITY_CACHE_TTL_MINUTES ?? '60',
      10,
    ),
    minLoanAmount: parseInt(process.env.MIN_ELIGIBLE_LOAN_AMOUNT ?? '100000', 10),
  },
  cron: {
    eligibilityRefresh: process.env.CRON_ELIGIBILITY_REFRESH ?? '0 2 * * *',
    streakCheck: process.env.CRON_STREAK_CHECK ?? '0 6 * * *',
  },
  mobile: {
    corsOrigins: (process.env.MOBILE_CORS_ORIGINS ?? '*')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ?? 'dev-jwt-secret-change-in-prod',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshTtlSeconds: parseInt(
      process.env.JWT_REFRESH_TTL_SECONDS ?? '604800',
      10,
    ),
  },
});
```

- [ ] **Step 5: Verify the app still compiles**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/config/configuration.ts .env package.json package-lock.json
git commit -m "chore: install jwt/passport deps and add jwt config section"
```

---

### Task 2: DTOs

**Files:**
- Create: `src/mobile-auth/dto/mobile-login.dto.ts`
- Create: `src/mobile-auth/dto/token-response.dto.ts`
- Create: `src/mobile-auth/dto/mobile-login.dto.spec.ts`

- [ ] **Step 1: Write the failing DTO validation test**

Create `src/mobile-auth/dto/mobile-login.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MobileLoginDto } from './mobile-login.dto';

describe('MobileLoginDto', () => {
  it('passes with valid username and password', async () => {
    const dto = plainToInstance(MobileLoginDto, {
      username: 'john.doe',
      password: 'secret123',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when username is an empty string', async () => {
    const dto = plainToInstance(MobileLoginDto, {
      username: '',
      password: 'secret123',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });

  it('fails when password is missing', async () => {
    const dto = plainToInstance(MobileLoginDto, { username: 'john.doe' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('fails when both fields are missing', async () => {
    const dto = plainToInstance(MobileLoginDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test -- --testPathPattern=mobile-login.dto
```

Expected: FAIL — `MobileLoginDto` is not defined.

- [ ] **Step 3: Create `src/mobile-auth/dto/mobile-login.dto.ts`**

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MobileLoginDto {
  @ApiProperty({ example: 'john.doe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
```

- [ ] **Step 4: Create `src/mobile-auth/dto/token-response.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class FineractUserDto {
  @ApiProperty() id: number;
  @ApiProperty() username: string;
  @ApiProperty() displayName: string;
  @ApiProperty() officeId: number;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'UUID refresh token (7 days, stored in Redis)' })
  refreshToken: string;

  @ApiProperty({ description: 'Access token TTL in seconds', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: FineractUserDto })
  user: FineractUserDto;
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm run test -- --testPathPattern=mobile-login.dto
```

Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/mobile-auth/
git commit -m "feat(mobile-auth): add login and token-response DTOs"
```

---

### Task 3: JWT Strategy and Guard

**Files:**
- Create: `src/mobile-auth/strategies/mobile-jwt.strategy.ts`
- Create: `src/mobile-auth/strategies/mobile-jwt.strategy.spec.ts`
- Create: `src/mobile-auth/guards/mobile-jwt.guard.ts`

- [ ] **Step 1: Write the failing strategy test**

Create `src/mobile-auth/strategies/mobile-jwt.strategy.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { MobileJwtStrategy, MobileJwtPayload } from './mobile-jwt.strategy';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'jwt.accessSecret') return 'test-secret-32chars-minimum-len!';
    return undefined;
  }),
} as unknown as ConfigService;

describe('MobileJwtStrategy', () => {
  let strategy: MobileJwtStrategy;

  beforeEach(() => {
    strategy = new MobileJwtStrategy(mockConfig);
  });

  it('validate() returns the payload unchanged', () => {
    const payload: MobileJwtPayload = {
      sub: 42,
      username: 'john.doe',
      displayName: 'John Doe',
      officeId: 1,
      iat: 1000000,
      exp: 9999999999,
    };
    expect(strategy.validate(payload)).toEqual(payload);
  });

  it('validate() preserves all payload fields', () => {
    const payload: MobileJwtPayload = {
      sub: 1,
      username: 'user',
      displayName: 'User',
      officeId: 2,
      iat: 0,
      exp: 9999999999,
    };
    const result = strategy.validate(payload);
    expect(result.sub).toBe(1);
    expect(result.officeId).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test -- --testPathPattern=mobile-jwt.strategy
```

Expected: FAIL — `MobileJwtStrategy` is not defined.

- [ ] **Step 3: Create `src/mobile-auth/strategies/mobile-jwt.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface MobileJwtPayload {
  sub: number;
  username: string;
  displayName: string;
  officeId: number;
  iat: number;
  exp: number;
}

@Injectable()
export class MobileJwtStrategy extends PassportStrategy(
  Strategy,
  'mobile-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('jwt.accessSecret') ??
        'dev-jwt-secret-change-in-prod',
      clockTolerance: 30,
    });
  }

  validate(payload: MobileJwtPayload): MobileJwtPayload {
    return payload;
  }
}
```

- [ ] **Step 4: Create `src/mobile-auth/guards/mobile-jwt.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class MobileJwtGuard extends AuthGuard('mobile-jwt') {}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm run test -- --testPathPattern=mobile-jwt.strategy
```

Expected: PASS — 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/mobile-auth/strategies/ src/mobile-auth/guards/
git commit -m "feat(mobile-auth): add MobileJwtStrategy and MobileJwtGuard"
```

---

### Task 4: Service — `loginMobile()`

**Files:**
- Create: `src/mobile-auth/mobile-auth.service.ts`
- Create: `src/mobile-auth/mobile-auth.service.spec.ts`

- [ ] **Step 1: Write the failing login tests**

Create `src/mobile-auth/mobile-auth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { MobileAuthService } from './mobile-auth.service';

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

const mockHttp = { post: jest.fn() } as unknown as HttpService;

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'fineract.baseUrl': 'http://fineract.test',
      'fineract.tenantId': 'test',
      'jwt.accessSecret': 'test-secret',
      'jwt.accessExpiresIn': '15m',
      'jwt.refreshTtlSeconds': 604800,
    };
    return map[key];
  }),
} as unknown as ConfigService;

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
} as unknown as JwtService;

const fineractSuccessResponse: AxiosResponse = {
  data: {
    userId: 42,
    username: 'john.doe',
    displayName: 'John Doe',
    officeId: 1,
    authenticated: true,
  },
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as any,
};

describe('MobileAuthService — loginMobile()', () => {
  let service: MobileAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: 'MOBILE_AUTH_REDIS', useValue: mockRedis },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get<MobileAuthService>(MobileAuthService);
  });

  it('returns accessToken, refreshToken, expiresIn, user on success', async () => {
    (mockHttp.post as jest.Mock).mockReturnValue(of(fineractSuccessResponse));
    mockRedis.set.mockResolvedValue('OK');

    const result = await service.loginMobile({ username: 'john.doe', password: 'secret' });

    expect(result.accessToken).toBe('mock.jwt.token');
    expect(result.refreshToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.expiresIn).toBe(900);
    expect(result.user).toEqual({
      id: 42,
      username: 'john.doe',
      displayName: 'John Doe',
      officeId: 1,
    });
  });

  it('stores refresh token in Redis with 7-day TTL', async () => {
    (mockHttp.post as jest.Mock).mockReturnValue(of(fineractSuccessResponse));
    mockRedis.set.mockResolvedValue('OK');

    const result = await service.loginMobile({ username: 'john.doe', password: 'secret' });

    expect(mockRedis.set).toHaveBeenCalledWith(
      `mobile_refresh:${result.refreshToken}`,
      JSON.stringify({ userId: 42, username: 'john.doe', displayName: 'John Doe', officeId: 1 }),
      'EX',
      604800,
    );
  });

  it('throws UnauthorizedException on Fineract 401', async () => {
    const err = new AxiosError('Unauthorized', '401');
    (err as any).response = { status: 401 };
    (mockHttp.post as jest.Mock).mockReturnValue(throwError(() => err));

    await expect(
      service.loginMobile({ username: 'wrong', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws ServiceUnavailableException on Fineract timeout', async () => {
    (mockHttp.post as jest.Mock).mockReturnValue(
      throwError(() => new Error('timeout')),
    );

    await expect(
      service.loginMobile({ username: 'john', password: 'pass' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test -- --testPathPattern=mobile-auth.service
```

Expected: FAIL — `MobileAuthService` is not defined.

- [ ] **Step 3: Create `src/mobile-auth/mobile-auth.service.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- --testPathPattern=mobile-auth.service
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/mobile-auth/mobile-auth.service.ts src/mobile-auth/mobile-auth.service.spec.ts
git commit -m "feat(mobile-auth): add MobileAuthService with Fineract proxy and Redis token store"
```

---

### Task 5: Service — `refreshTokens()` and `logout()` tests

**Files:**
- Modify: `src/mobile-auth/mobile-auth.service.spec.ts`

- [ ] **Step 1: Add refresh and logout tests to the existing spec file**

Append these two describe blocks to `src/mobile-auth/mobile-auth.service.spec.ts` (after the `loginMobile` describe block, before the closing of the file):

```typescript
describe('MobileAuthService — refreshTokens()', () => {
  let service: MobileAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: 'MOBILE_AUTH_REDIS', useValue: mockRedis },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get<MobileAuthService>(MobileAuthService);
  });

  it('returns new token pair when refresh token is valid', async () => {
    const storedData = JSON.stringify({
      userId: 42, username: 'john.doe', displayName: 'John Doe', officeId: 1,
    });
    mockRedis.get.mockResolvedValue(storedData);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');

    const result = await service.refreshTokens('valid-uuid');

    expect(result.accessToken).toBe('mock.jwt.token');
    expect(result.refreshToken).not.toBe('valid-uuid'); // rotated
  });

  it('deletes old Redis key on refresh (token rotation)', async () => {
    const storedData = JSON.stringify({
      userId: 42, username: 'john.doe', displayName: 'John Doe', officeId: 1,
    });
    mockRedis.get.mockResolvedValue(storedData);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');

    await service.refreshTokens('old-token-uuid');

    expect(mockRedis.del).toHaveBeenCalledWith('mobile_refresh:old-token-uuid');
  });

  it('throws UnauthorizedException when refresh token not in Redis', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(service.refreshTokens('expired-uuid')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('MobileAuthService — logout()', () => {
  let service: MobileAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: 'MOBILE_AUTH_REDIS', useValue: mockRedis },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get<MobileAuthService>(MobileAuthService);
  });

  it('deletes the refresh token key from Redis', async () => {
    mockRedis.del.mockResolvedValue(1);

    await service.logout('some-refresh-uuid');

    expect(mockRedis.del).toHaveBeenCalledWith('mobile_refresh:some-refresh-uuid');
  });

  it('resolves without error even if key does not exist', async () => {
    mockRedis.del.mockResolvedValue(0); // 0 = key not found, still succeeds

    await expect(service.logout('nonexistent-uuid')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run all service tests**

```bash
npm run test -- --testPathPattern=mobile-auth.service
```

Expected: PASS — all tests passing (login + refresh + logout suites).

- [ ] **Step 3: Commit**

```bash
git add src/mobile-auth/mobile-auth.service.spec.ts
git commit -m "test(mobile-auth): add refresh and logout service tests"
```

---

### Task 6: Controller

**Files:**
- Create: `src/mobile-auth/mobile-auth.controller.ts`
- Create: `src/mobile-auth/mobile-auth.controller.spec.ts`

- [ ] **Step 1: Write the failing controller tests**

Create `src/mobile-auth/mobile-auth.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';

const mockTokenResponse = {
  accessToken: 'mock.jwt.token',
  refreshToken: 'mock-refresh-uuid',
  expiresIn: 900,
  user: { id: 1, username: 'user', displayName: 'User', officeId: 1 },
};

const mockService = {
  loginMobile: jest.fn().mockResolvedValue(mockTokenResponse),
  refreshTokens: jest.fn().mockResolvedValue(mockTokenResponse),
  logout: jest.fn().mockResolvedValue(undefined),
};

describe('MobileAuthController', () => {
  let controller: MobileAuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MobileAuthController],
      providers: [{ provide: MobileAuthService, useValue: mockService }],
    })
      .overrideGuard(MobileJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MobileAuthController>(MobileAuthController);
  });

  it('login() delegates to service.loginMobile()', async () => {
    const result = await controller.login({
      username: 'john.doe',
      password: 'secret',
    });
    expect(mockService.loginMobile).toHaveBeenCalledWith({
      username: 'john.doe',
      password: 'secret',
    });
    expect(result).toEqual(mockTokenResponse);
  });

  it('refresh() delegates to service.refreshTokens()', async () => {
    const result = await controller.refresh('some-refresh-uuid');
    expect(mockService.refreshTokens).toHaveBeenCalledWith('some-refresh-uuid');
    expect(result).toEqual(mockTokenResponse);
  });

  it('logout() delegates to service.logout()', async () => {
    await controller.logout('some-refresh-uuid');
    expect(mockService.logout).toHaveBeenCalledWith('some-refresh-uuid');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test -- --testPathPattern=mobile-auth.controller
```

Expected: FAIL — `MobileAuthController` is not defined.

- [ ] **Step 3: Create `src/mobile-auth/mobile-auth.controller.ts`**

```typescript
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MobileAuthService } from './mobile-auth.service';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';

@ApiTags('mobile-auth')
@Controller('mobile/v1/auth')
export class MobileAuthController {
  constructor(private readonly mobileAuthService: MobileAuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Mobile login — authenticate with Fineract credentials' })
  login(@Body() dto: MobileLoginDto): Promise<TokenResponseDto> {
    return this.mobileAuthService.loginMobile(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using a valid refresh token' })
  refresh(@Body('refreshToken') refreshToken: string): Promise<TokenResponseDto> {
    return this.mobileAuthService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(MobileJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@Body('refreshToken') refreshToken: string): Promise<void> {
    return this.mobileAuthService.logout(refreshToken);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- --testPathPattern=mobile-auth.controller
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/mobile-auth/mobile-auth.controller.ts src/mobile-auth/mobile-auth.controller.spec.ts
git commit -m "feat(mobile-auth): add MobileAuthController with login/refresh/logout endpoints"
```

---

### Task 7: Module wiring + AppModule registration

**Files:**
- Create: `src/mobile-auth/mobile-auth.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `src/mobile-auth/mobile-auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { Redis } from 'ioredis';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { MobileJwtStrategy } from './strategies/mobile-jwt.strategy';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [MobileAuthController],
  providers: [
    MobileAuthService,
    MobileJwtStrategy,
    MobileJwtGuard,
    {
      provide: 'MOBILE_AUTH_REDIS',
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('redis.host') ?? 'localhost',
          port: config.get<number>('redis.port') ?? 6379,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [MobileJwtGuard, MobileJwtStrategy],
})
export class MobileAuthModule {}
```

- [ ] **Step 2: Register `MobileAuthModule` in `src/app.module.ts`**

Add the import at the top of `src/app.module.ts`:

```typescript
import { MobileAuthModule } from './mobile-auth/mobile-auth.module';
```

Add `MobileAuthModule` to the `imports` array (after `AuthModule`):

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    FineractModule,
    MultiplierModule,
    QueueModule,
    SchedulerModule,
    AuthModule,
    MobileAuthModule,
    WebhooksModule,
    ContributionsModule,
    LoansModule,
    ReportsModule,
    MobileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Verify the full build compiles**

```bash
npm run build
```

Expected: Build succeeds. No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/mobile-auth/mobile-auth.module.ts src/app.module.ts
git commit -m "feat(mobile-auth): wire MobileAuthModule and register in AppModule"
```

---

### Task 8: Migrate `mobile.controller.ts`

Remove the old env-based login endpoint and swap the class-level guard from `ApiKeyGuard` to `MobileJwtGuard`.

**Files:**
- Modify: `src/mobile/mobile.controller.ts`
- Modify: `src/mobile/mobile.module.ts`

- [ ] **Step 1: Update `src/mobile/mobile.module.ts` to import `MobileAuthModule`**

Replace the existing content with:

```typescript
import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { FineractModule } from '../fineract/fineract.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [MobileAuthModule, MultiplierModule, FineractModule, ReportsModule],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
```

- [ ] **Step 2: Replace `src/mobile/mobile.controller.ts`**

Remove `@Public()`, `LoginDto`, old login route, and `ApiKeyGuard`; swap to `MobileJwtGuard`:

```typescript
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MobileJwtGuard } from '../mobile-auth/guards/mobile-jwt.guard';
import { MobileService } from './mobile.service';
import { MobileHistoryQueryDto } from './dto/mobile-history-query.dto';
import { MobileEligibilityQueryDto } from './dto/mobile-eligibility-query.dto';

@ApiTags('mobile')
@Controller('mobile/v1')
@UseGuards(MobileJwtGuard)
@ApiBearerAuth()
export class MobileController {
  constructor(private readonly mobileService: MobileService) {}

  @Get('dashboard/:clientId')
  @ApiOperation({
    summary: 'Mobile home screen — profile, eligibility, history, tips',
  })
  dashboard(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getDashboard(clientId);
  }

  @Get('profile/:clientId')
  @ApiOperation({ summary: 'Director multiplier profile' })
  profile(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getProfile(clientId);
  }

  @Get('eligibility/:clientId')
  @ApiOperation({ summary: 'Loan eligibility for mobile' })
  eligibility(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileEligibilityQueryDto,
  ) {
    return this.mobileService.getEligibility(clientId, query.refresh);
  }

  @Get('history/:clientId')
  @ApiOperation({ summary: 'Recent multiplier events' })
  history(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileHistoryQueryDto,
  ) {
    return this.mobileService.getHistory(clientId, query.limit);
  }

  @Get('report/:clientId')
  @ApiOperation({ summary: 'Full client audit report (mobile-friendly)' })
  report(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getClientReport(clientId);
  }
}
```

- [ ] **Step 3: Build to verify no compilation errors**

```bash
npm run build
```

Expected: Build succeeds. The old `LoginDto` and `ApiKeyGuard` imports are gone from `mobile.controller.ts`.

- [ ] **Step 4: Run the full test suite**

```bash
npm run test
```

Expected: All existing tests pass. New mobile-auth tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/mobile.controller.ts src/mobile/mobile.module.ts
git commit -m "feat(mobile): swap ApiKeyGuard for MobileJwtGuard, remove env-based login route"
```

---

## Backend Plan Complete

All 8 tasks produce a working, independently testable `mobile-auth` module. Run `npm run test` from `cooperative-multiplier-service/` to verify the full suite.

Endpoints now live at:
- `POST /mobile/v1/auth/login` — public, issues JWT pair
- `POST /mobile/v1/auth/refresh` — public, rotates refresh token
- `POST /mobile/v1/auth/logout` — requires `MobileJwtGuard`
- `GET  /mobile/v1/*` — all require `MobileJwtGuard`
