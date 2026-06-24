# Auth Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete authentication feature for the Director App — NativeWind config, Zustand store, Axios interceptors, Login screen (Layout B: floating card on gradient), Splash bootstrap, and Session Expired Modal.

**Architecture:** All auth logic lives under `src/features/auth/`. expo-router is restructured into `(auth)/` and `(app)/` route groups. Root `_layout.tsx` owns the auth bootstrap and session expiry modal. NativeWind is wired up before any styled component is written.

**Tech Stack:** Expo 56, expo-router 4, NativeWind 4.x, Zustand 5, Axios, React Hook Form + Zod, `expo-secure-store`, Jest + `@testing-library/react-native`.

**Spec:** `director-app/docs/superpowers/specs/2026-06-24-auth-module-design.md`

**Working directory for all commands:** `cooperative-multiplier-service/director-app/`

**Backend dependency:** Tasks 1–8 can be developed and tested independently using mocked API responses. Full integration with a live backend requires the backend plan to be completed first.

---

### Task 1: Wire NativeWind

NativeWind is installed but not configured. Four config files and a CSS update are needed before any `className` prop will work.

**Files:**
- Create: `tailwind.config.js`
- Create: `babel.config.js`
- Create: `metro.config.js`
- Create: `nativewind-env.d.ts`
- Modify: `src/global.css`

NativeWind config is pure configuration — no TDD cycle applies. No test step.

- [ ] **Step 1: Create `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#0F766E',
        secondary: '#14B8A6',
        accent: '#F59E0B',
        background: '#F8FAFC',
        foreground: '#0F172A',
        success: '#16A34A',
        destructive: '#DC2626',
      },
    },
  },
};
```

- [ ] **Step 2: Create `babel.config.js`**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

- [ ] **Step 3: Create `metro.config.js`**

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: './src/global.css' });
```

- [ ] **Step 4: Create `nativewind-env.d.ts`**

```typescript
/// <reference types="nativewind/types" />
```

- [ ] **Step 5: Add Tailwind directives to `src/global.css`**

Prepend these three lines to the top of `src/global.css` (before the existing CSS custom properties):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Verify Expo starts without errors**

```bash
npx expo start --clear
```

Expected: Metro bundler starts. No "NativeWind not configured" or "cannot find module" errors. Press `q` to quit.

- [ ] **Step 7: Commit**

```bash
git add tailwind.config.js babel.config.js metro.config.js nativewind-env.d.ts src/global.css
git commit -m "chore(director-app): wire NativeWind 4.x with brand color tokens"
```

---

### Task 2: Auth types and Zod schema

**Files:**
- Create: `src/features/auth/types/auth.types.ts`
- Create: `src/features/auth/validators/login.schema.ts`
- Create: `src/features/auth/validators/login.schema.spec.ts`

- [ ] **Step 1: Write the failing Zod schema tests**

Create `src/features/auth/validators/login.schema.spec.ts`:

```typescript
import { loginSchema } from './login.schema';

describe('loginSchema', () => {
  it('passes with valid username and password', () => {
    const result = loginSchema.safeParse({ username: 'john.doe', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('fails when username is empty', () => {
    const result = loginSchema.safeParse({ username: '', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('username');
    }
  });

  it('fails when password is empty', () => {
    const result = loginSchema.safeParse({ username: 'john', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('password');
    }
  });

  it('fails when both fields are missing', () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(2);
    }
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest src/features/auth/validators/login.schema.spec.ts
```

Expected: FAIL — `loginSchema` is not defined.

- [ ] **Step 3: Create `src/features/auth/types/auth.types.ts`**

```typescript
export interface FineractUser {
  id: number;
  username: string;
  displayName: string;
  officeId: number;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: FineractUser;
}
```

- [ ] **Step 4: Create `src/features/auth/validators/login.schema.ts`**

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormData = z.infer<typeof loginSchema>;
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx jest src/features/auth/validators/login.schema.spec.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/features/
git commit -m "feat(auth): add auth types and Zod login schema"
```

---

### Task 3: Install test dependencies + Zustand auth store

**Files:**
- Create: `src/features/auth/store/auth.store.ts`
- Create: `src/features/auth/store/auth.store.spec.ts`

- [ ] **Step 1: Install test dependencies**

```bash
npx expo install @testing-library/react-native @testing-library/jest-native
npm install -D jest-expo axios-mock-adapter
```

Verify `package.json` now has these in `devDependencies`.

- [ ] **Step 2: Add jest config to `package.json`**

Add or update the `jest` section in `package.json`:

```json
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind)"
  ]
}
```

> **Note:** `@testing-library/react-native` v12+ auto-applies the jest-native matchers — no `setupFilesAfterFramework` entry is required.

- [ ] **Step 3: Write the failing store tests**

Create `src/features/auth/store/auth.store.spec.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
npx jest src/features/auth/store/auth.store.spec.ts
```

Expected: FAIL — `useAuthStore` is not defined.

- [ ] **Step 5: Create `src/features/auth/store/auth.store.ts`**

```typescript
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
```

- [ ] **Step 6: Install `jwt-decode`**

```bash
npx expo install jwt-decode
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx jest src/features/auth/store/auth.store.spec.ts
```

Expected: PASS — 5 tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/features/auth/store/ package.json package-lock.json
git commit -m "feat(auth): add Zustand auth store with initialize/login/logout/setTokens"
```

---

### Task 4: Axios instance with interceptors

**Files:**
- Create: `src/features/auth/api/axios.instance.ts`
- Create: `src/features/auth/api/axios.instance.spec.ts`
- Create: `src/features/auth/api/auth.api.ts`

**Note on circular imports:** `auth.store.ts` → `auth.api.ts` → `axios.instance.ts` → `auth.store.ts` forms a cycle. This is safe because all cross-module calls happen inside function bodies (not at module initialisation time), which Metro and ts-jest handle correctly. `axios.instance.ts` must be created before `auth.api.ts` so TypeScript can resolve the import.

- [ ] **Step 1: Write the failing Axios interceptor tests**

Create `src/features/auth/api/axios.instance.spec.ts`:

```typescript
import MockAdapter from 'axios-mock-adapter';
import { axiosInstance } from './axios.instance';
import { useAuthStore } from '../store/auth.store';

jest.mock('../store/auth.store', () => ({
  useAuthStore: {
    getState: jest.fn(),
    setState: jest.fn(),
  },
}));

const mockStore = useAuthStore as jest.Mocked<typeof useAuthStore>;
const mock = new MockAdapter(axiosInstance);

const mockTokenPair = {
  accessToken: 'new.jwt.token',
  refreshToken: 'new-refresh-uuid',
  expiresIn: 900,
  user: { id: 1, username: 'u', displayName: 'U', officeId: 1 },
};

describe('axiosInstance interceptors', () => {
  beforeEach(() => {
    mock.reset();
    jest.clearAllMocks();
  });

  afterAll(() => {
    mock.restore();
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
    mock.onPost('/mobile/v1/auth/refresh').replyOnce(200, mockTokenPair);
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
    mock.onPost('/mobile/v1/auth/refresh').replyOnce(401);

    await expect(axiosInstance.get('/protected')).rejects.toBeDefined();
    expect(markSessionExpiredMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest src/features/auth/api/axios.instance.spec.ts
```

Expected: FAIL — `axiosInstance` is not defined.

- [ ] **Step 4: Create `src/features/auth/api/axios.instance.ts`**

```typescript
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { useAuthStore } from '../store/auth.store';
import { TokenPair } from '../types/auth.types';

export const axiosInstance: AxiosInstance = axios.create({
  baseURL: 'https://api.sagehive.cloud',
  timeout: 15000,
});

// --- Request interceptor: attach access token ---
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// --- Response interceptor: handle 401 with refresh + mutex ---
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null): void {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token!);
    }
  });
  refreshQueue = [];
}

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Skip refresh for the refresh endpoint itself to avoid infinite loop
    if (originalRequest.url?.includes('/mobile/v1/auth/refresh')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Queue this request until the ongoing refresh resolves
      return new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axiosInstance(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    const { refreshToken, setTokens, markSessionExpired } =
      useAuthStore.getState();

    try {
      const { data: newPair } = await axiosInstance.post<TokenPair>(
        '/mobile/v1/auth/refresh',
        { refreshToken },
      );
      setTokens(newPair);
      processQueue(null, newPair.accessToken);
      originalRequest.headers.Authorization = `Bearer ${newPair.accessToken}`;
      return axiosInstance(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      markSessionExpired();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest src/features/auth/api/axios.instance.spec.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 6: Create `src/features/auth/api/auth.api.ts`**

```typescript
import { axiosInstance } from './axios.instance';
import { LoginCredentials, TokenPair } from '../types/auth.types';

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<TokenPair> => {
    const { data } = await axiosInstance.post<TokenPair>(
      '/mobile/v1/auth/login',
      credentials,
    );
    return data;
  },

  refresh: async (refreshToken: string): Promise<TokenPair> => {
    const { data } = await axiosInstance.post<TokenPair>(
      '/mobile/v1/auth/refresh',
      { refreshToken },
    );
    return data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await axiosInstance.post('/mobile/v1/auth/logout', { refreshToken });
  },
};
```

- [ ] **Step 7: Commit**

```bash
git add src/features/auth/api/
git commit -m "feat(auth): add Axios instance with JWT attach and 401 refresh interceptor"
```

---

### Task 5: PasswordInput component

**Files:**
- Create: `src/features/auth/components/password-input.tsx`
- Create: `src/features/auth/components/password-input.spec.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/features/auth/components/password-input.spec.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('renders with secureTextEntry enabled by default', () => {
    const { getByTestId } = render(
      <PasswordInput testID="pw" value="" onChangeText={() => {}} />,
    );
    const input = getByTestId('pw');
    expect(input.props.secureTextEntry).toBe(true);
  });

  it('toggles secureTextEntry when eye icon is pressed', () => {
    const { getByTestId } = render(
      <PasswordInput testID="pw" value="" onChangeText={() => {}} />,
    );
    const toggle = getByTestId('pw-toggle');
    fireEvent.press(toggle);
    const input = getByTestId('pw');
    expect(input.props.secureTextEntry).toBe(false);
  });

  it('calls onChangeText when user types', () => {
    const onChangeText = jest.fn();
    const { getByTestId } = render(
      <PasswordInput testID="pw" value="" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByTestId('pw'), 'newpassword');
    expect(onChangeText).toHaveBeenCalledWith('newpassword');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/features/auth/components/password-input.spec.tsx
```

Expected: FAIL — `PasswordInput` is not defined.

- [ ] **Step 3: Create `src/features/auth/components/password-input.tsx`**

```typescript
import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  TextInputProps,
} from 'react-native';

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  testID?: string;
}

export function PasswordInput({ testID, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View className="flex-row items-center bg-white border border-slate-200 rounded-xl px-4">
      <TextInput
        {...props}
        testID={testID}
        secureTextEntry={!isVisible}
        className="flex-1 py-4 text-foreground text-base"
        placeholderTextColor="#94A3B8"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        testID={testID ? `${testID}-toggle` : undefined}
        onPress={() => setIsVisible((v) => !v)}
        accessibilityLabel={isVisible ? 'Hide password' : 'Show password'}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text className="text-slate-400 text-sm">
          {isVisible ? '🙈' : '👁'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/features/auth/components/password-input.spec.tsx
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/components/password-input.tsx src/features/auth/components/password-input.spec.tsx
git commit -m "feat(auth): add PasswordInput component with secureTextEntry toggle"
```

---

### Task 6: SessionExpiredModal component

**Files:**
- Create: `src/features/auth/components/session-expired-modal.tsx`
- Create: `src/features/auth/components/session-expired-modal.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/auth/components/session-expired-modal.spec.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SessionExpiredModal } from './session-expired-modal';

describe('SessionExpiredModal', () => {
  it('renders nothing when visible=false', () => {
    const { queryByText } = render(
      <SessionExpiredModal visible={false} onSignInAgain={() => {}} />,
    );
    expect(queryByText('Session Expired')).toBeNull();
  });

  it('renders title and message when visible=true', () => {
    const { getByText } = render(
      <SessionExpiredModal visible={true} onSignInAgain={() => {}} />,
    );
    expect(getByText('Session Expired')).toBeTruthy();
    expect(getByText(/session has expired/i)).toBeTruthy();
  });

  it('calls onSignInAgain when CTA is pressed', () => {
    const onSignInAgain = jest.fn();
    const { getByText } = render(
      <SessionExpiredModal visible={true} onSignInAgain={onSignInAgain} />,
    );
    fireEvent.press(getByText('Sign In Again'));
    expect(onSignInAgain).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/features/auth/components/session-expired-modal.spec.tsx
```

Expected: FAIL — `SessionExpiredModal` is not defined.

- [ ] **Step 3: Create `src/features/auth/components/session-expired-modal.tsx`**

```typescript
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from 'react-native';

interface SessionExpiredModalProps {
  visible: boolean;
  onSignInAgain: () => void;
}

export function SessionExpiredModal({
  visible,
  onSignInAgain,
}: SessionExpiredModalProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Intentionally non-dismissible — user must press CTA
      }}
    >
      <StatusBar backgroundColor="rgba(0,0,0,0.6)" />
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
          <Text className="text-destructive text-lg font-bold mb-2">
            Session Expired
          </Text>
          <Text className="text-slate-600 text-sm leading-relaxed mb-6">
            Your session has expired. Please sign in again to continue.
          </Text>
          <TouchableOpacity
            onPress={onSignInAgain}
            className="bg-destructive rounded-xl py-3 items-center"
            accessibilityRole="button"
          >
            <Text className="text-white font-semibold text-base">
              Sign In Again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/features/auth/components/session-expired-modal.spec.tsx
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/components/session-expired-modal.tsx src/features/auth/components/session-expired-modal.spec.tsx
git commit -m "feat(auth): add non-dismissible SessionExpiredModal component"
```

---

### Task 7: Login Screen

**Files:**
- Create: `src/features/auth/screens/login.screen.tsx`
- Create: `src/features/auth/screens/login.screen.spec.tsx`

- [ ] **Step 1: Write the failing Login screen tests**

Create `src/features/auth/screens/login.screen.spec.tsx`:

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LoginScreen } from './login.screen';
import { useAuthStore } from '../store/auth.store';

jest.mock('../store/auth.store');

const mockLogin = jest.fn();
const mockClearError = jest.fn();

(useAuthStore as unknown as jest.Mock).mockReturnValue({
  login: mockLogin,
  clearError: mockClearError,
  isLoading: false,
  error: null,
});

describe('LoginScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders username and password fields', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);
    expect(getByPlaceholderText('Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
  });

  it('submit button is enabled when form is empty (validate on submit)', () => {
    const { getByText } = render(<LoginScreen />);
    const button = getByText('Sign In');
    expect(button).toBeTruthy();
    // Button is touchable — validation happens on submit, not on render
  });

  it('calls login() with username and password on submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Username'), 'john.doe');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret');
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        username: 'john.doe',
        password: 'secret',
      });
    });
  });

  it('shows required error messages when submitting empty form', async () => {
    const { getByText } = render(<LoginScreen />);
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => {
      expect(getByText('Username is required')).toBeTruthy();
      expect(getByText('Password is required')).toBeTruthy();
    });
  });

  it('shows API error message from store', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      clearError: mockClearError,
      isLoading: false,
      error: 'Invalid username or password',
    });

    const { getByText } = render(<LoginScreen />);
    expect(getByText('Invalid username or password')).toBeTruthy();
  });

  it('disables Sign In button while isLoading=true', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      clearError: mockClearError,
      isLoading: true,
      error: null,
    });

    const { getByTestId } = render(<LoginScreen />);
    const button = getByTestId('login-submit');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/features/auth/screens/login.screen.spec.tsx
```

Expected: FAIL — `LoginScreen` is not defined.

- [ ] **Step 3: Create `src/features/auth/screens/login.screen.tsx`**

```typescript
import React, { useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LinearGradient } from 'expo-linear-gradient';
import { loginSchema, LoginFormData } from '../validators/login.schema';
import { PasswordInput } from '../components/password-input';
import { useAuthStore } from '../store/auth.store';

export function LoginScreen() {
  const { login, isLoading, error, clearError } = useAuthStore();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
  });

  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  const onSubmit = async (data: LoginFormData) => {
    clearError();
    await login(data);
  };

  return (
    <LinearGradient
      colors={['#0F766E', '#0F172A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.3, y: 1 }}
      className="flex-1"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 items-center justify-center px-6 py-12">
            {/* Floating card */}
            <View className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              {/* Brand */}
              <View className="items-center mb-6">
                <View className="w-12 h-12 bg-primary rounded-xl items-center justify-center mb-3">
                  <Text className="text-white text-xl font-bold">S</Text>
                </View>
                <Text className="text-foreground text-lg font-bold">
                  SageHive
                </Text>
                <Text className="text-slate-500 text-xs mt-0.5">
                  Director Console
                </Text>
              </View>

              {/* Username field */}
              <View className="mb-4">
                <Controller
                  control={control}
                  name="username"
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      placeholder="Username"
                      value={value}
                      onChangeText={onChange}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      returnKeyType="next"
                      className="bg-background border border-slate-200 rounded-xl px-4 py-4 text-foreground text-base"
                      placeholderTextColor="#94A3B8"
                      editable={!isLoading}
                    />
                  )}
                />
                {errors.username && (
                  <Text className="text-destructive text-xs mt-1 ml-1">
                    {errors.username.message}
                  </Text>
                )}
              </View>

              {/* Password field */}
              <View className="mb-4">
                <Controller
                  control={control}
                  name="password"
                  render={({ field: { onChange, value } }) => (
                    <PasswordInput
                      placeholder="Password"
                      value={value}
                      onChangeText={onChange}
                      autoComplete="password"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit(onSubmit)}
                      editable={!isLoading}
                      testID="login-password"
                    />
                  )}
                />
                {errors.password && (
                  <Text className="text-destructive text-xs mt-1 ml-1">
                    {errors.password.message}
                  </Text>
                )}
              </View>

              {/* API error */}
              {error && (
                <View className="bg-red-50 border border-destructive/20 rounded-lg p-3 mb-4">
                  <Text className="text-destructive text-sm">{error}</Text>
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                testID="login-submit"
                onPress={handleSubmit(onSubmit)}
                disabled={isLoading}
                accessibilityState={{ disabled: isLoading }}
                className={`rounded-xl py-4 items-center ${
                  isLoading ? 'bg-primary/60' : 'bg-primary'
                }`}
              >
                {isLoading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-white font-semibold text-base">
                    Sign In
                  </Text>
                )}
              </TouchableOpacity>

              {/* Security note */}
              <Text className="text-slate-400 text-xs text-center mt-4">
                🔒 Secured connection
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
```

- [ ] **Step 4: Install `expo-linear-gradient`**

```bash
npx expo install expo-linear-gradient
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest src/features/auth/screens/login.screen.spec.tsx
```

Expected: PASS — 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/screens/ package.json package-lock.json
git commit -m "feat(auth): add LoginScreen with gradient card layout, RHF+Zod validation"
```

---

### Task 8: `use-auth` hook

**Files:**
- Create: `src/features/auth/hooks/use-auth.ts`

No separate test — this is a thin selector wrapper; the store tests cover the underlying logic.

- [ ] **Step 1: Create `src/features/auth/hooks/use-auth.ts`**

```typescript
import { useAuthStore } from '../store/auth.store';

/**
 * Convenience hook — returns the auth state and actions from the Zustand store.
 * Use this in screens and components instead of importing useAuthStore directly.
 */
export function useAuth() {
  return useAuthStore();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/auth/hooks/
git commit -m "feat(auth): add useAuth convenience hook"
```

---

### Task 9: expo-router restructure

Restructure the app's routing to use `(auth)/` and `(app)/` route groups. The existing `src/app/index.tsx` (home tab) moves into `(app)/`.

**Files:**
- Modify: `src/app/_layout.tsx`
- Create: `src/app/(auth)/_layout.tsx`
- Create: `src/app/(auth)/login.tsx`
- Create: `src/app/(app)/_layout.tsx`
- Create: `src/app/(app)/index.tsx`
- Delete: `src/app/index.tsx` (old home — replaced by `(app)/index.tsx`)
- Delete: `src/app/explore.tsx` (starter placeholder — not part of this sprint)

- [ ] **Step 1: Create `src/app/(auth)/_layout.tsx`**

```typescript
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
```

- [ ] **Step 2: Create `src/app/(auth)/login.tsx`**

```typescript
import { LoginScreen } from '@/features/auth/screens/login.screen';

export default LoginScreen;
```

- [ ] **Step 3: Create `src/app/(app)/_layout.tsx`**

```typescript
import { Redirect, Tabs } from 'expo-router';
import { useAuthStore } from '@/features/auth/store/auth.store';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
    </Tabs>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/index.tsx`**

```typescript
import { View, Text } from 'react-native';

/**
 * Home screen placeholder — replaced in the next sprint.
 */
export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground text-xl font-semibold">
        Welcome to Director Console
      </Text>
    </View>
  );
}
```

- [ ] **Step 5: Rewrite `src/app/_layout.tsx`**

```typescript
import { useEffect } from 'react';
import { router, Slot, SplashScreen } from 'expo-router';
import { AppState, AppStateStatus } from 'react-native';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { SessionExpiredModal } from '@/features/auth/components/session-expired-modal';
import '@/global.css';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const {
    isLoading,
    isAuthenticated,
    sessionExpired,
    markSessionExpired: _markSessionExpired,
    initialize,
    logout,
    accessToken,
  } = useAuthStore();

  // Bootstrap on cold start
  useEffect(() => {
    initialize().then(() => {
      SplashScreen.hideAsync();
    });
  }, [initialize]);

  // Handle auth routing once loading is resolved
  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace('/(app)/');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isLoading, isAuthenticated]);

  // Re-check token validity when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextState: AppStateStatus) => {
        if (nextState === 'active' && accessToken) {
          // Re-run initialize to check if token has since expired
          await initialize();
        }
      },
    );
    return () => subscription.remove();
  }, [accessToken, initialize]);

  const handleSignInAgain = () => {
    logout();
    router.replace('/(auth)/login');
  };

  return (
    <>
      <Slot />
      <SessionExpiredModal
        visible={sessionExpired}
        onSignInAgain={handleSignInAgain}
      />
    </>
  );
}
```

- [ ] **Step 6: Delete old placeholder files**

```bash
# Delete old home + explore tabs (replaced by (app)/ route group)
Remove-Item src/app/index.tsx
Remove-Item src/app/explore.tsx
```

- [ ] **Step 7: Run the full test suite**

```bash
npx jest src/features/auth/
```

Expected: All feature/auth tests pass.

- [ ] **Step 8: Start the app and verify routing**

```bash
npx expo start --clear
```

Verify:
- Pressing `i` (iOS) or `a` (Android) opens the app
- App routes to Login screen (no stored tokens on first run)
- Login screen renders: gradient background, white card, SageHive logo, username + password fields, Sign In button
- Entering wrong credentials shows "Invalid username or password" (once backend is live)

- [ ] **Step 9: Commit**

```bash
git add src/app/
git commit -m "feat(auth): restructure expo-router with (auth)/ and (app)/ groups, add root layout bootstrap"
```

---

## Mobile Plan Complete

All 9 tasks produce a fully functional authentication feature for the Director App. Run `npx jest src/features/auth/` from `director-app/` to verify the test suite.

Full auth lifecycle is covered:
- Cold start → Splash bootstrap → route to Home or Login
- Login → Fineract credentials → JWT + refresh token persisted
- 401 during session → silent refresh → request replayed
- Refresh expired → SessionExpiredModal → Sign In Again
- Manual logout → Redis key deleted → Login screen
