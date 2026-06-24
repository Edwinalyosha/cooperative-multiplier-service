import { act } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from './auth.store';

jest.mock('expo-secure-store');
jest.mock('../api/auth.api', () => ({
  authApi: {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  },
}));

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      sessionExpired: false,
      error: null,
    });
    jest.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.sessionExpired).toBe(false);
  });

  it('markSessionExpired() sets sessionExpired=true and clears tokens', () => {
    useAuthStore.setState({ accessToken: 'tok', refreshToken: 'ref', isAuthenticated: true });

    act(() => {
      useAuthStore.getState().markSessionExpired();
    });

    const state = useAuthStore.getState();
    expect(state.sessionExpired).toBe(true);
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('clearError() resets error to null', () => {
    useAuthStore.setState({ error: 'Invalid credentials' });

    act(() => {
      useAuthStore.getState().clearError();
    });

    expect(useAuthStore.getState().error).toBeNull();
  });

  it('setTokens() updates accessToken and refreshToken in store', () => {
    const pair = {
      accessToken: 'new.jwt',
      refreshToken: 'new-refresh-uuid',
      expiresIn: 900,
      user: { id: 1, username: 'u', displayName: 'U', officeId: 1 },
    };

    mockSecureStore.setItemAsync.mockResolvedValue();

    act(() => {
      useAuthStore.getState().setTokens(pair);
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new.jwt');
    expect(state.refreshToken).toBe('new-refresh-uuid');
  });

  it('initialize() routes to login when SecureStore has no tokens', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);

    await act(async () => {
      await useAuthStore.getState().initialize();
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});
