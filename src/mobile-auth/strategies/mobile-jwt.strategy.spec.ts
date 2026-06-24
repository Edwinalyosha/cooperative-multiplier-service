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
