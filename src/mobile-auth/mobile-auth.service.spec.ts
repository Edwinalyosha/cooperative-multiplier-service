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
