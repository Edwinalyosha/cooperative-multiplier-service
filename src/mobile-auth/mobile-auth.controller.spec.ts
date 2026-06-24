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
