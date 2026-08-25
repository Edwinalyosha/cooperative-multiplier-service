import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
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
      role: UserRole.DIRECTOR,
      clientId: 7,
      iat: 1000000,
      exp: 9999999999,
    };
    expect(strategy.validate(payload)).toEqual(payload);
  });

  // role and clientId are the authorization-bearing fields: controllers read
  // them off req.user to decide what the caller may see and do, rather than
  // trusting anything in the request body or URL. If validate() ever dropped
  // or altered them, every ownership check downstream would silently fail
  // open, so assert them explicitly rather than relying on toEqual above.
  it('validate() preserves the authorization fields', () => {
    const payload: MobileJwtPayload = {
      sub: 1,
      username: 'user',
      role: UserRole.FINANCE_MANAGER,
      clientId: null,
      iat: 0,
      exp: 9999999999,
    };
    const result = strategy.validate(payload);
    expect(result.sub).toBe(1);
    expect(result.role).toBe(UserRole.FINANCE_MANAGER);
    expect(result.clientId).toBeNull();
  });
});
