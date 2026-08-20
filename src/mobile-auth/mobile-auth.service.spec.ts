import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
} as unknown as PrismaService;

const mockFineract = {
  authenticateUser: jest.fn(),
} as unknown as FineractService;

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
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

const fineractAuthSuccess = {
  userId: 42,
  username: 'john.doe',
  authenticated: true,
  roles: [{ id: 4, name: 'Director' }],
};

const mappedUser = {
  id: 1,
  username: 'john.doe',
  role: 'DIRECTOR' as const,
  clientId: 1,
};

async function buildService() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MobileAuthService,
      { provide: 'MOBILE_AUTH_REDIS', useValue: mockRedis },
      { provide: PrismaService, useValue: mockPrisma },
      { provide: FineractService, useValue: mockFineract },
      { provide: ConfigService, useValue: mockConfig },
      { provide: JwtService, useValue: mockJwt },
    ],
  }).compile();
  return module.get<MobileAuthService>(MobileAuthService);
}

describe('MobileAuthService — loginMobile() (hybrid auth: Fineract identity + local User authorization)', () => {
  let service: MobileAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildService();
  });

  it('returns accessToken, refreshToken, expiresIn, user when Fineract auth succeeds and a mapping row exists', async () => {
    (mockFineract.authenticateUser as jest.Mock).mockResolvedValue(fineractAuthSuccess);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mappedUser);
    mockRedis.set.mockResolvedValue('OK');

    const result = await service.loginMobile({ username: 'john.doe', password: 'secret' });

    expect(result.accessToken).toBe('mock.jwt.token');
    expect(result.refreshToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.expiresIn).toBe(900);
    expect(result.user).toEqual({
      id: 1,
      username: 'john.doe',
      role: 'DIRECTOR',
      clientId: 1,
    });
  });

  it('stores refresh token in Redis with 7-day TTL, keyed on the local User row (not Fineract userId)', async () => {
    (mockFineract.authenticateUser as jest.Mock).mockResolvedValue(fineractAuthSuccess);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mappedUser);
    mockRedis.set.mockResolvedValue('OK');

    const result = await service.loginMobile({ username: 'john.doe', password: 'secret' });

    expect(mockRedis.set).toHaveBeenCalledWith(
      `mobile_refresh:${result.refreshToken}`,
      JSON.stringify({ userId: 1, username: 'john.doe', role: 'DIRECTOR', clientId: 1 }),
      'EX',
      604800,
    );
  });

  it('throws UnauthorizedException(INVALID_CREDENTIALS) when Fineract rejects the password', async () => {
    (mockFineract.authenticateUser as jest.Mock).mockResolvedValue(null);

    await expect(
      service.loginMobile({ username: 'wrong', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException(NOT_ONBOARDED) when Fineract accepts the login but no local mapping row exists', async () => {
    (mockFineract.authenticateUser as jest.Mock).mockResolvedValue(fineractAuthSuccess);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.loginMobile({ username: 'john.doe', password: 'secret' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws ServiceUnavailableException when Fineract itself is unreachable, distinct from a bad password', async () => {
    (mockFineract.authenticateUser as jest.Mock).mockRejectedValue(new Error('timeout'));

    await expect(
      service.loginMobile({ username: 'john.doe', password: 'secret' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('MobileAuthService — refreshTokens()', () => {
  let service: MobileAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildService();
  });

  it('returns new token pair when refresh token is valid', async () => {
    const storedData = JSON.stringify({
      userId: 1, username: 'john.doe', role: 'DIRECTOR', clientId: 1,
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
      userId: 1, username: 'john.doe', role: 'DIRECTOR', clientId: 1,
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
    service = await buildService();
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
