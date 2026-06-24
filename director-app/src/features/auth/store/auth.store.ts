import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { jwtDecode } from 'jwt-decode';
import { FineractUser, TokenPair } from '../types/auth.types';
import { authApi } from '../api/auth.api';

const KEYS = {
  ACCESS_TOKEN: 'auth_access_token',
  REFRESH_TOKEN: 'auth_refresh_token',
  USER: 'auth_user',
} as const;

interface MobileJwtPayload {
  sub: number;
  username: string;
  displayName: string;
  officeId: number;
  exp: number;
}

interface AuthState {
  user: FineractUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (pair: TokenPair) => void;
  markSessionExpired: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  sessionExpired: false,
  error: null,

  initialize: async () => {
    set({ isLoading: true });
    try {
      const [storedAccess, storedRefresh, storedUser] = await Promise.all([
        SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
        SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
        SecureStore.getItemAsync(KEYS.USER),
      ]);

      if (!storedAccess && !storedRefresh) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      // Decode JWT locally to check expiry (no network call)
      if (storedAccess) {
        try {
          const decoded = jwtDecode<MobileJwtPayload>(storedAccess);
          const nowPlusBuffer = Date.now() / 1000 + 60;
          if (decoded.exp > nowPlusBuffer) {
            // Token is still valid
            const user: FineractUser = storedUser
              ? JSON.parse(storedUser)
              : {
                  id: decoded.sub,
                  username: decoded.username,
                  displayName: decoded.displayName,
                  officeId: decoded.officeId,
                };
            set({
              accessToken: storedAccess,
              refreshToken: storedRefresh,
              user,
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }
        } catch {
          // Malformed token — fall through to refresh attempt
        }
      }

      // Access token expired or malformed — try silent refresh
      if (storedRefresh) {
        try {
          const newPair = await authApi.refresh(storedRefresh);
          await Promise.all([
            SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, newPair.accessToken),
            SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, newPair.refreshToken),
            SecureStore.setItemAsync(KEYS.USER, JSON.stringify(newPair.user)),
          ]);
          set({
            accessToken: newPair.accessToken,
            refreshToken: newPair.refreshToken,
            user: newPair.user,
            isAuthenticated: true,
            isLoading: false,
          });
          return;
        } catch {
          // Silent refresh failed — not authenticated
          await Promise.all([
            SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
            SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
            SecureStore.deleteItemAsync(KEYS.USER),
          ]);
        }
      }

      set({ isLoading: false, isAuthenticated: false });
    } catch {
      set({ isLoading: false, isAuthenticated: false });
    }
  },

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const pair = await authApi.login(credentials);
      await Promise.all([
        SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, pair.accessToken),
        SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, pair.refreshToken),
        SecureStore.setItemAsync(KEYS.USER, JSON.stringify(pair.user)),
      ]);
      set({
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        user: pair.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      const code = (err as any)?.response?.data?.message ?? 'UNKNOWN_ERROR';
      const messages: Record<string, string> = {
        INVALID_CREDENTIALS: 'Invalid username or password',
        FINERACT_UNAVAILABLE: 'Service temporarily unavailable. Try again shortly.',
      };
      set({
        isLoading: false,
        error: messages[code] ?? 'No connection. Check your network.',
      });
      throw err;
    }
  },

  logout: async () => {
    const { refreshToken } = get();
    // Fire-and-forget: clear local state immediately
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      sessionExpired: false,
      error: null,
    });
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(KEYS.USER),
    ]);
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => {
        // Best-effort server logout; access token expires in ≤15 min regardless
      });
    }
  },

  setTokens: (pair: TokenPair) => {
    set({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      user: pair.user,
      isAuthenticated: true,
    });
    // Persist to SecureStore (fire-and-forget)
    Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, pair.accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, pair.refreshToken),
      SecureStore.setItemAsync(KEYS.USER, JSON.stringify(pair.user)),
    ]).catch(() => {});
  },

  markSessionExpired: () => {
    set({
      sessionExpired: true,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      user: null,
    });
    // Clear SecureStore (fire-and-forget)
    Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(KEYS.USER),
    ]).catch(() => {});
  },

  clearError: () => set({ error: null }),
}));
