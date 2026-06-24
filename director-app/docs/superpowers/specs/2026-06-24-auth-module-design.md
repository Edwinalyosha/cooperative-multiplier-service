# Authentication Module Design — Director Mobile App

**Date:** 2026-06-24  
**Scope:** Full-stack authentication for the Director Mobile App (`director-app`) backed by the `cooperative-multiplier-service` NestJS API.  
**Status:** Approved — ready for implementation planning.

---

## 1. Overview

The Director App requires an authentication module that:

- Allows administratively-provisioned Fineract users to log in with their existing credentials
- Issues short-lived JWT access tokens and Redis-backed rotating refresh tokens
- Provides a Splash Screen that silently restores sessions on cold start
- Shows a non-dismissible Session Expired Modal when refresh tokens are exhausted
- Leaves all existing `cooperative-multiplier-service` auth infrastructure untouched

No public sign-up. No password reset. All user provisioning is done inside Apache Fineract by an administrator.

---

## 2. Architecture Decision

**Approach: Dedicated `mobile-auth` NestJS Module (isolated)**

A new `src/mobile-auth/` module is created with zero coupling to the existing `src/auth/` module. The existing `ApiKeyGuard` and `/auth/login` endpoint remain byte-for-byte identical for all server-to-server routes. Mobile routes at `/mobile/v1/*` are migrated from `ApiKeyGuard` to `MobileJwtGuard`.

---

## 3. Directory Layout

### Backend — `cooperative-multiplier-service/src/`

```
src/
  auth/                             ← UNTOUCHED (server-to-server API_KEY auth)
  mobile-auth/                      ← NEW
    mobile-auth.module.ts
    mobile-auth.controller.ts       ← POST /mobile/v1/auth/login|refresh|logout
    mobile-auth.service.ts          ← Fineract proxy + JWT issuance + Redis store
    strategies/
      mobile-jwt.strategy.ts        ← Passport JWT strategy for mobile Bearer tokens
    guards/
      mobile-jwt.guard.ts           ← AuthGuard('mobile-jwt') wrapper
    dto/
      mobile-login.dto.ts           ← { username: string, password: string }
      token-response.dto.ts         ← { accessToken, refreshToken, expiresIn, user }
  mobile/
    mobile.controller.ts            ← MODIFIED: ApiKeyGuard → MobileJwtGuard
```

### Mobile App — `director-app/`

```
director-app/
  tailwind.config.js                ← NEW (NativeWind wiring)
  babel.config.js                   ← NEW
  metro.config.js                   ← NEW
  nativewind-env.d.ts               ← NEW
  src/
    app/
      _layout.tsx                   ← REWRITTEN (auth bootstrap + SessionExpiredModal)
      (auth)/
        _layout.tsx                 ← NEW (full-screen Stack, no tab bar)
        login.tsx                   ← NEW (renders LoginScreen)
      (app)/
        _layout.tsx                 ← NEW (tab bar, auth guard redirect)
        index.tsx                   ← NEW (Home placeholder)
    features/
      auth/                         ← NEW
        api/
          auth.api.ts               ← login(), refresh(), logout() API calls
          axios.instance.ts         ← Axios instance with request/response interceptors
        components/
          session-expired-modal.tsx ← Non-dismissible overlay modal
          password-input.tsx        ← TextInput with secureTextEntry toggle
        screens/
          login.screen.tsx          ← Login UI (Layout B)
        store/
          auth.store.ts             ← Zustand store
        hooks/
          use-auth.ts               ← Convenience hook
        types/
          auth.types.ts             ← LoginCredentials, TokenPair, FineractUser
        validators/
          login.schema.ts           ← Zod schema
    global.css                      ← MODIFIED (add @tailwind directives)
```

---

## 4. Backend: `mobile-auth` Module

### 4.1 API Endpoints

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `POST` | `/mobile/v1/auth/login` | `@Public()` | Proxy to Fineract, issue JWT pair |
| `POST` | `/mobile/v1/auth/refresh` | `@Public()` | Rotate refresh token, issue new pair |
| `POST` | `/mobile/v1/auth/logout` | `MobileJwtGuard` | Delete refresh token from Redis |

### 4.2 Login Flow

1. Receive `{ username, password }` from mobile app.
2. POST to `{FINERACT_BASE_URL}/fineract-provider/api/v1/authentication` with header `Fineract-Platform-TenantId: {FINERACT_TENANT_ID}`. Timeout: **10 seconds**.
3. On Fineract success: extract `userId`, `username`, `displayName`, `officeId`, `roles`. Roles are stored in Redis alongside `userId` for future role-based guard use; they are intentionally excluded from the JWT payload in this sprint (YAGNI).
4. Mint **JWT access token** signed with `JWT_ACCESS_SECRET`, TTL `JWT_ACCESS_EXPIRES_IN` (default `15m`). Payload:
   ```json
   { "sub": "<userId>", "username": "...", "displayName": "...", "officeId": 1 }
   ```
5. Generate **UUID v4 refresh token**. Write Redis key `mobile_refresh:<uuid>` → `{ userId, username }` with TTL `JWT_REFRESH_TTL_SECONDS` (default `604800` = 7 days).
6. Return `{ accessToken, refreshToken, expiresIn: 900, user: { id, username, displayName, officeId } }`.

### 4.3 Refresh Flow

1. Receive `{ refreshToken }` (UUID string).
2. `GET mobile_refresh:<uuid>` from Redis. If missing: return `401 REFRESH_EXPIRED`.
3. **Token rotation**: `DEL mobile_refresh:<uuid>` (atomic). Mint new JWT access token + new UUID refresh token. Write new Redis key.
4. Return new `{ accessToken, refreshToken, expiresIn }`.

### 4.4 Logout Flow

Request body: `{ refreshToken: string }` (the UUID string, not a JWT).

1. Extract `sub` (userId) from validated JWT in Authorization header.
2. Read `refreshToken` UUID from request body.
3. `DEL mobile_refresh:<refreshToken>` from Redis.
4. Return `204 No Content`.

### 4.5 JWT Strategy

- **Extractor:** `ExtractJwt.fromAuthHeaderAsBearerToken()`
- **Secret:** `JWT_ACCESS_SECRET`
- **Clock tolerance:** 30 seconds (handles minor device clock skew)

### 4.6 New Environment Variables

```dotenv
JWT_ACCESS_SECRET=<random 64-char hex>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_TTL_SECONDS=604800
```

---

## 5. Mobile App

### 5.1 NativeWind Configuration

NativeWind 4.x is installed but not wired. Four config files are required before any styled components can be written:

- `tailwind.config.js` — sets `content` paths, extends theme with brand color tokens
- `babel.config.js` — adds `nativewind/babel` preset
- `metro.config.js` — adds `nativewind/metro` preset
- `nativewind-env.d.ts` — TypeScript declaration reference

**Brand color tokens** (added to `theme.extend.colors`):

| Token | Value | Tailwind class prefix |
|-------|-------|-----------------------|
| Primary | `#0F766E` | `primary` |
| Secondary | `#14B8A6` | `secondary` |
| Accent | `#F59E0B` | `accent` |
| Background | `#F8FAFC` | `background` |
| Text | `#0F172A` | `foreground` |
| Success | `#16A34A` | `success` |
| Destructive | `#DC2626` | `destructive` |

### 5.2 expo-router Navigation

```
_layout.tsx (root)
  └── isLoading=true  → blank view (native splash held by SplashScreen.preventAutoHideAsync)
  └── isAuthenticated → router.replace('/(app)/')
  └── !isAuthenticated → router.replace('/(auth)/login')
  └── <SessionExpiredModal /> always mounted (controlled by sessionExpired flag)

(auth)/_layout.tsx   → Stack, no headers, no tab bar
(app)/_layout.tsx    → Tab navigator; redirects to login if !isAuthenticated
```

`router.replace()` is used throughout (never `push`) so neither login nor splash appear in the navigation back stack.

### 5.3 Zustand Auth Store

**State:**

| Field | Type | Description |
|-------|------|-------------|
| `user` | `FineractUser \| null` | Decoded user profile |
| `accessToken` | `string \| null` | Current JWT access token |
| `refreshToken` | `string \| null` | Current UUID refresh token |
| `isAuthenticated` | `boolean` | True when valid session exists |
| `isLoading` | `boolean` | True during `initialize()` |
| `sessionExpired` | `boolean` | Triggers SessionExpiredModal |
| `error` | `string \| null` | Login-specific error message |

**Actions:**

| Action | Behaviour |
|--------|-----------|
| `initialize()` | Reads SecureStore, decodes JWT `exp` locally, silent refresh if expired, sets `isAuthenticated` |
| `login(creds)` | Calls auth API, persists to SecureStore, sets user + tokens |
| `logout()` | Calls logout API (fire-and-forget), clears SecureStore + store |
| `setTokens(pair)` | Called by Axios interceptor post-refresh; persists to SecureStore |
| `markSessionExpired()` | Sets `sessionExpired=true`, clears tokens |
| `clearError()` | Resets `error` field before new login attempt |

**SecureStore keys:** `auth_access_token`, `auth_refresh_token`, `auth_user`

### 5.4 Axios Instance

- **Base URL:** `https://api.sagehive.cloud`
- **Request interceptor:** Attaches `Authorization: Bearer <accessToken>` from Zustand store.
- **Response interceptor (401 handling):**
  1. Check `isRefreshing` mutex flag. If already refreshing, queue the request in a promise array.
  2. If not refreshing: set `isRefreshing=true`, call `/mobile/v1/auth/refresh`.
  3. On success: call `setTokens()`, replay all queued requests with new access token.
  4. On failure (refresh 401): call `markSessionExpired()`, reject all queued requests.
  5. Always reset `isRefreshing=false` in `finally`.

### 5.5 Login Screen (Layout B — Floating Card on Gradient)

- **Background:** Teal-to-slate-dark gradient (`#0F766E` → `#0F172A`) fills the full screen.
- **Card:** White rounded card centered on screen with `SageHive` icon + product name.
- **Fields:** `username` (autocomplete: `username`) and `password` (autocomplete: `password`, secureTextEntry toggle).
- **Submit button:** Disabled + `ActivityIndicator` while `isLoading`.
- **Error display:** Inline error message below password field in destructive red.
- **Keyboard:** Username `returnKeyType='next'` → focus password. Password `returnKeyType='done'` → submit form.
- **Validation:** `react-hook-form` with `zodResolver`. Mode: `onSubmit`.

**Zod schema:**
```ts
z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})
```

**Error message mapping:**

| API error code | User-facing message |
|----------------|---------------------|
| `INVALID_CREDENTIALS` | "Invalid username or password" |
| `FINERACT_UNAVAILABLE` | "Service temporarily unavailable. Try again shortly." |
| Network error | "No connection. Check your network." |

### 5.6 Session Expired Modal

- Rendered at root `_layout.tsx` level — visible above any screen.
- Not dismissible via back gesture or backdrop tap.
- Single CTA: **"Sign In Again"** — clears `sessionExpired` flag, clears store, `router.replace('/(auth)/login')`.
- Backdrop: semi-transparent dark overlay. Background screen remains mounted (not unmounted).

---

## 6. Edge Cases

### Backend

| Scenario | Response |
|----------|----------|
| Fineract returns 401 (bad credentials) | `401 INVALID_CREDENTIALS` |
| Fineract timeout > 10s | `503 FINERACT_UNAVAILABLE` |
| Fineract 5xx | `503 FINERACT_UNAVAILABLE` |
| Redis down at login | `503` — no partial token issuance |
| Redis down at refresh | `503` → mobile falls through to SessionExpiredModal |
| Refresh UUID not in Redis (expired) | `401 REFRESH_EXPIRED` |
| Concurrent refresh race (two requests same UUID) | First wins (atomic DEL); second gets `401` — prevented client-side by mutex |
| Tampered JWT / invalid signature | `401 INVALID_TOKEN` from `MobileJwtGuard` |
| `FINERACT_BASE_URL` missing from env | NestJS startup throws — fast fail, not silent |

### Mobile

| Scenario | Handling |
|----------|----------|
| Multiple simultaneous 401s (refresh storm) | `isRefreshing` mutex queues all; one refresh call fired |
| SecureStore read fails on cold start | Treat as no tokens → route to login |
| App force-closed mid-refresh | In-memory state discarded; `initialize()` runs fresh on next launch |
| Network offline during splash | Trust local JWT `exp` field; route to `(app)/`; server validates on next API call |
| `user` null but access token present | Re-derive `user` from decoded JWT payload in `initialize()` |
| Session expires while app is backgrounded | `AppState` `'active'` listener in root `_layout.tsx` triggers token validity check on foreground return; calls `initialize()` logic if access token has since expired |
| `router.replace()` before navigation ready | `SplashScreen.preventAutoHideAsync()` holds native splash until routing decision resolves |

---

## 7. Testing Boundaries

Each unit has a clear test surface:

| Unit | Test type | What to verify |
|------|-----------|----------------|
| `mobile-auth.service.ts` | Unit (mock Fineract + Redis) | Login success/fail, refresh rotation, logout |
| `mobile-jwt.strategy.ts` | Unit | Valid token passes, expired/tampered rejects |
| `mobile-auth.controller.ts` | Integration (supertest) | HTTP status codes, response shapes |
| `auth.store.ts` | Unit | State transitions for all actions |
| `axios.instance.ts` | Unit (mock server) | 401 queuing, mutex, replay, session-expired path |
| Login screen | Component (RNTL) | Submit disabled while loading, error display, keyboard chain |
| Root `_layout.tsx` | Component | Routing to (auth)/ vs (app)/ based on store state |

---

## 8. Out of Scope (this sprint)

- Multi-device session management (force logout all devices)
- Role-based route guards inside `(app)/` (next sprint)
- Biometric authentication
- Password change / reset
- Push notification token registration on login
