# Onboarding Splash Screen — Design Spec

**Date:** 2026-06-26  
**Feature:** First-run onboarding wizard (3 pages) + username input validation  
**Branch:** `feature/auth-module`

---

## 1. Goals

- Show a 3-page onboarding wizard to first-time users only.
- On subsequent opens, skip onboarding entirely — go straight to login (unauthenticated) or home (authenticated).
- Add light animations to each page using the already-installed `react-native-reanimated` v4.
- Tighten username validation: trim whitespace, restrict to alphanumeric + `-` + `_`.

---

## 2. Routing Logic

The root `_layout.tsx` reads two values from `expo-secure-store` at cold start:

1. **`auth_access_token`** — existing JWT (already read by `initialize()`).
2. **`onboarding_complete`** — flag written when user taps "Proceed to Secure Login".

Decision tree:

```
initialize() resolves
  ├─ isAuthenticated = true          → router.replace('/(app)')
  └─ isAuthenticated = false
       ├─ onboarding_complete = "1"  → router.replace('/(auth)/login')
       └─ onboarding_complete unset  → router.replace('/(onboarding)')
```

`onboarding_complete` is written once (on Page 3 CTA tap) and never deleted. Logout does **not** reset it — returning users always land on login, not onboarding.

---

## 3. File Structure

```
src/
  app/
    (onboarding)/
      _layout.tsx          ← Stack, headerShown: false
      index.tsx            ← renders OnboardingScreen
  features/
    onboarding/
      screens/
        onboarding.screen.tsx    ← FlatList pager, 3 page configs
      components/
        onboarding-dot.tsx       ← animated pagination dot
```

Existing files modified:
- `src/app/_layout.tsx` — add `onboarding_complete` check in routing effect
- `src/features/auth/validators/login.schema.ts` — add `.trim()` + `.regex()`

---

## 4. OnboardingScreen — Implementation Detail

### Pager mechanism
`FlatList` with `pagingEnabled={true}`, `horizontal={true}`, `showsHorizontalScrollIndicator={false}`.  
`onViewableItemsChanged` tracks the current page index.  
Screen width via `useWindowDimensions()` sets each item's width.

### Animations (react-native-reanimated v4)
Each page renders its content inside a Reanimated `Animated.View`. On page focus, a shared value animates from `0 → 1` driving:
- **Opacity** — fade in over 400 ms
- **translateY** — slide up 24dp over 400 ms (spring or timing, `useNativeDriver` implicit in Reanimated v4)

The active pagination dot uses `useAnimatedStyle` to interpolate width from `8 → 24dp`.

### Navigation controls
- **"Next" button** — bottom-right, 48dp minimum height, advances `FlatList` via `scrollToIndex`.
- **Back swipe** — native horizontal swipe on `FlatList` handles this.
- No "Skip" button — design is minimal and pages are short.

---

## 5. Page Specs

### Page 1 — Institutional Security

| Property | Value |
|---|---|
| Background | `LinearGradient` `#0F766E → #0F172A`, top-to-bottom |
| Layout | Centered vertically; top 15% for brand block |
| Brand block | Square `#0F766E` badge (48×48dp, rounded-xl) with white `S`, `SageHive` text below |
| Title | "Institutional Security" (white, `text-2xl font-bold`) |
| Subtitle | "Welcome to Sagehive. Connected to your secure SACCO core engine via Apache Fineract." (white/70, `text-sm`, centered, max-width 280dp) |
| JWT check | On mount, reads `auth_access_token` from `SecureStore` and calls `jwtDecode` to verify `exp`. If valid → `router.replace('/(app)')` immediately, no tap required. This is a local decode only (no network). |
| CTA | "Next →" button, white text on `#14B8A6` background, bottom-right |

### Page 2 — Real-Time Oversight

| Property | Value |
|---|---|
| Background | `#F8FAFC` (Slate Light) |
| Layout | Rounded card (16dp radius, `shadow-md`) centered, 80% screen width |
| Card content | Static visual mockup: two KPI rows built from `View` rectangles (colored bars, label text) simulating "Member Share Growth" and "Loan Disbursal Overview" |
| KPI bar colors | `#0F766E` (primary) and `#14B8A6` (secondary) |
| Title | "Real-Time Oversight" (`#0F172A`, `text-2xl font-bold`) |
| Subtitle | "Monitor member shares, approve credit lines, and audit asset pools directly from your mobile dashboard." (`#64748B`, `text-sm`) |
| CTA | "Next →" button, white on `#0F766E`, bottom-right |

### Page 3 — Ready to Administer

| Property | Value |
|---|---|
| Background | `LinearGradient` `#0F766E → #0F172A` (mirrors Page 1) |
| Layout | Centered, high-contrast |
| Title | "Ready to Administer" (white, `text-2xl font-bold`) |
| Subtitle | "Accounts are provisioned securely by your system administrator. Tap below to authenticate with your institutional credentials." (white/70, `text-sm`) |
| CTA | Full-width "Proceed to Secure Login" button (white background, `#0F766E` text, 48dp height, `rounded-xl`) |
| On CTA tap | `await SecureStore.setItemAsync('onboarding_complete', '1')` → `router.replace('/(auth)/login')` |

---

## 6. Pagination Dots

Three dots, bottom-center of screen, above CTA.  
Inactive dot: 8×8dp circle, `#FFFFFF40`.  
Active dot: animates width to 24dp, `#FFFFFF` (or `#0F766E` on Page 2).  
Uses `useAnimatedStyle` + `withTiming(24, { duration: 250 })`.

---

## 7. Username Validation Update

`src/features/auth/validators/login.schema.ts`:

```typescript
username: z
  .string()
  .min(1, 'Username is required')
  .transform((v) => v.trim())
  .min(1, 'Username cannot be blank')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Username may only contain letters, numbers, '-' or '_'"
  ),
```

The `.transform().min()` chain ensures a string of only spaces also fails the blank check after trimming.

---

## 8. Safe Area & Touch Targets

- Wrap each page's outer `View` in `<SafeAreaView>` (from `react-native-safe-area-context`) to respect notches and home indicator bars.
- All CTA buttons: minimum `height: 48`, `paddingHorizontal: 24`.

---

## 9. Out of Scope

- No "Skip" button — spec is three concise pages.
- No back button on Page 1 (first page, nothing to go back to).
- No network call on Page 1 — JWT validity checked locally via `jwtDecode` to avoid latency.
- No tests in this spec (onboarding is pure presentational; covered by visual QA).
