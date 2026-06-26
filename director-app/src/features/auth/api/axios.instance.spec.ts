import MockAdapter from 'axios-mock-adapter';
import { axiosInstance } from './axios.instance';
import { authClient } from './auth.client';
import { useAuthStore } from '../store/auth.store';

jest.mock('../store/auth.store', () => ({
  useAuthStore: {
    getState: jest.fn(),
    setState: jest.fn(),
  },
}));

const mockStore = useAuthStore as jest.Mocked<typeof useAuthStore>;
const mock = new MockAdapter(axiosInstance);
const authMock = new MockAdapter(authClient);

const mockTokenPair = {
  accessToken: 'new.jwt.token',
  refreshToken: 'new-refresh-uuid',
  expiresIn: 900,
  user: { id: 1, username: 'u', displayName: 'U', officeId: 1 },
};

describe('axiosInstance interceptors', () => {
  beforeEach(() => {
    mock.reset();
    authMock.reset();
    jest.clearAllMocks();
  });

  afterAll(() => {
    mock.restore();
    authMock.restore();
  });

  it('attaches Authorization header when accessToken is in store', async () => {
    mockStore.getState.mockReturnValue({
      accessToken: 'current.jwt.token',
      refreshToken: 'current-refresh',
      isAuthenticated: true,
    } as any);

    mock.onGet('/test').reply(200, { ok: true });

    const response = await axiosInstance.get('/test');
    expect(response.config.headers?.Authorization).toBe('Bearer current.jwt.token');
  });

  it('does NOT attach Authorization header when accessToken is null', async () => {
    mockStore.getState.mockReturnValue({ accessToken: null } as any);

    mock.onGet('/test').reply(200, { ok: true });

    const response = await axiosInstance.get('/test');
    expect(response.config.headers?.Authorization).toBeUndefined();
  });

  it('refreshes tokens and retries request on 401', async () => {
    const setTokensMock = jest.fn();
    mockStore.getState.mockReturnValue({
      accessToken: 'expired.jwt',
      refreshToken: 'valid-refresh-uuid',
      setTokens: setTokensMock,
      markSessionExpired: jest.fn(),
    } as any);

    // First call returns 401, refresh succeeds, retry returns 200
    mock.onGet('/protected').replyOnce(401);
    authMock.onPost('/mobile/v1/auth/refresh').replyOnce(200, mockTokenPair);
    mock.onGet('/protected').replyOnce(200, { data: 'ok' });

    const response = await axiosInstance.get('/protected');

    expect(setTokensMock).toHaveBeenCalledWith(mockTokenPair);
    expect(response.data).toEqual({ data: 'ok' });
  });

  it('calls markSessionExpired() when refresh fails with 401', async () => {
    const markSessionExpiredMock = jest.fn();
    mockStore.getState.mockReturnValue({
      accessToken: 'expired.jwt',
      refreshToken: 'expired-refresh-uuid',
      setTokens: jest.fn(),
      markSessionExpired: markSessionExpiredMock,
    } as any);

    mock.onGet('/protected').replyOnce(401);
    authMock.onPost('/mobile/v1/auth/refresh').replyOnce(401);

    await expect(axiosInstance.get('/protected')).rejects.toBeDefined();
    expect(markSessionExpiredMock).toHaveBeenCalled();
  });
});
