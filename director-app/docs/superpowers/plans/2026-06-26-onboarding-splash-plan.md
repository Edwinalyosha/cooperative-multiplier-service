# Onboarding Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 3-page first-run onboarding wizard with Reanimated animations, dot pagination, and a "once ever" flag stored in SecureStore; also tighten username validation with trim + character restriction.

**Architecture:** A new `/(onboarding)` Expo Router group renders a single `OnboardingScreen` component backed by a horizontal `FlatList` pager. The root `_layout.tsx` reads a `onboarding_complete` SecureStore key after `initialize()` resolves and routes accordingly. The onboarding feature lives entirely inside `src/features/onboarding/` with no coupling to the auth store.

**Tech Stack:** Expo Router v3, React Native FlatList, `react-native-reanimated` v4, `react-native-safe-area-context`, `expo-secure-store`, `expo-linear-gradient`, `jwt-decode`, Zod v4, NativeWind v4.

---

## Task 1: Username validation — trim + character restriction

**Files:**
- Modify: `director-app/src/features/auth/validators/login.schema.ts`

- [ ] **Step 1: Update the Zod schema**

Replace the entire file content with:

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .transform((v) => v.trim())
    .min(1, 'Username cannot be blank')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username may only contain letters, numbers, '-' or '_'",
    ),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormData = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: Verify types still satisfy the login call**

`LoginFormData.username` is now a `string` (Zod transform preserves the type). `authApi.login()` accepts `{ username: string; password: string }` — no change needed downstream.

- [ ] **Step 3: Commit**

```bash
git add director-app/src/features/auth/validators/login.schema.ts
git commit -m "feat(auth): trim username whitespace and restrict to alphanumeric/-/_"
```

---

## Task 2: Animated pagination dot component

**Files:**
- Create: `director-app/src/features/onboarding/components/onboarding-dot.tsx`

- [ ] **Step 1: Create the component**

```typescript
import React from 'react';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

interface OnboardingDotProps {
  active: boolean;
  lightBackground?: boolean;
}

export function OnboardingDot({ active, lightBackground = false }: OnboardingDotProps) {
  const animStyle = useAnimatedStyle(() => ({
    width: withTiming(active ? 24 : 8, { duration: 250 }),
    opacity: withTiming(active ? 1 : 0.4, { duration: 250 }),
  }));

  const baseColor = lightBackground ? '#0F766E' : '#FFFFFF';

  return (
    <Animated.View
      style={[
        {
          height: 8,
          borderRadius: 4,
          backgroundColor: baseColor,
          marginHorizontal: 3,
        },
        animStyle,
      ]}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add director-app/src/features/onboarding/components/onboarding-dot.tsx
git commit -m "feat(onboarding): animated pagination dot component"
```

---

## Task 3: OnboardingScreen — FlatList pager with 3 pages

**Files:**
- Create: `director-app/src/features/onboarding/screens/onboarding.screen.tsx`

This is the main screen. It uses a horizontal `FlatList` for swiping, Reanimated for per-page fade+slide-up animations, and `LinearGradient` for Pages 1 and 3.

- [ ] **Step 1: Create the screen**

```typescript
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  TouchableOpacity,
  Text,
  View,
  useWindowDimensions,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { jwtDecode } from 'jwt-decode';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { OnboardingDot } from '../components/onboarding-dot';

const ONBOARDING_KEY = 'onboarding_complete';
const ACCESS_TOKEN_KEY = 'auth_access_token';

interface PageConfig {
  id: string;
  title: string;
  subtitle: string;
  dark: boolean; // true = teal gradient, false = slate light
}

const PAGES: PageConfig[] = [
  {
    id: 'security',
    title: 'Institutional Security',
    subtitle:
      'Welcome to Sagehive. Connected to your secure SACCO core engine via Apache Fineract.',
    dark: true,
  },
  {
    id: 'monitoring',
    title: 'Real-Time Oversight',
    subtitle:
      'Monitor member shares, approve credit lines, and audit asset pools directly from your mobile dashboard.',
    dark: false,
  },
  {
    id: 'access',
    title: 'Ready to Administer',
    subtitle:
      'Accounts are provisioned securely by your system administrator. Tap below to authenticate with your institutional credentials.',
    dark: true,
  },
];

// Animated content wrapper: fades in + slides up when visible
function PageContent({
  children,
  visible,
}: {
  children: React.ReactNode;
  visible: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  React.useEffect(() => {
    if (visible) {
      opacity.value = withDelay(80, withTiming(1, { duration: 400 }));
      translateY.value = withDelay(80, withTiming(0, { duration: 400 }));
    } else {
      opacity.value = 0;
      translateY.value = 24;
    }
  }, [visible, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[{ flex: 1 }, animStyle]}>{children}</Animated.View>;
}

// Mockup card shown on Page 2
function MonitoringMockup() {
  const bars = [
    { label: 'Member Share Growth', pct: 72, color: '#0F766E' },
    { label: 'Loan Disbursal Overview', pct: 55, color: '#14B8A6' },
  ];

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 4,
        width: '100%',
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 16,
        }}
      >
        Director Overview
      </Text>
      {bars.map((bar) => (
        <View key={bar.label} style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <Text style={{ fontSize: 13, color: '#0F172A', fontWeight: '500' }}>
              {bar.label}
            </Text>
            <Text style={{ fontSize: 13, color: bar.color, fontWeight: '600' }}>
              {bar.pct}%
            </Text>
          </View>
          <View
            style={{
              height: 8,
              backgroundColor: '#F1F5F9',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: 8,
                width: `${bar.pct}%`,
                backgroundColor: bar.color,
                borderRadius: 4,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<PageConfig>>(null);

  // Page 1: check existing JWT locally; if valid skip to app immediately
  React.useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        if (token) {
          const { exp } = jwtDecode<{ exp: number }>(token);
          if (exp > Date.now() / 1000 + 60) {
            router.replace('/(app)');
          }
        }
      } catch {
        // No valid token — stay on onboarding
      }
    })();
  }, []);

  const handleNext = useCallback(() => {
    if (activeIndex < PAGES.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    }
  }, [activeIndex]);

  const handleProceed = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
    router.replace('/(auth)/login');
  }, []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems[0]?.index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = { viewAreaCoveragePercentThreshold: 50 };

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<PageConfig>) => {
      const isActive = index === activeIndex;
      const isLast = index === PAGES.length - 1;

      const content = (
        <SafeAreaView
          style={{ flex: 1, width }}
          edges={['top', 'bottom', 'left', 'right']}
        >
          <PageContent visible={isActive}>
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 28,
                paddingBottom: 120,
              }}
            >
              {/* Brand block — Page 1 only */}
              {index === 0 && (
                <View style={{ alignItems: 'center', marginBottom: 32 }}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: '#FFFFFF',
                        fontSize: 28,
                        fontWeight: '800',
                      }}
                    >
                      S
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 16,
                      fontWeight: '600',
                      letterSpacing: 1,
                    }}
                  >
                    SAGEHIVE
                  </Text>
                </View>
              )}

              {/* Mockup card — Page 2 only */}
              {index === 1 && (
                <View style={{ width: '100%', marginBottom: 32 }}>
                  <MonitoringMockup />
                </View>
              )}

              <Text
                style={{
                  fontSize: 26,
                  fontWeight: '800',
                  color: item.dark ? '#FFFFFF' : '#0F172A',
                  textAlign: 'center',
                  marginBottom: 12,
                }}
              >
                {item.title}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 22,
                  color: item.dark ? 'rgba(255,255,255,0.75)' : '#64748B',
                  textAlign: 'center',
                  maxWidth: 300,
                }}
              >
                {item.subtitle}
              </Text>
            </View>

            {/* Bottom controls */}
            <View
              style={{
                position: 'absolute',
                bottom: 40,
                left: 0,
                right: 0,
                alignItems: 'center',
                paddingHorizontal: 28,
              }}
            >
              {/* Dot pagination */}
              <View
                style={{
                  flexDirection: 'row',
                  marginBottom: 24,
                  alignItems: 'center',
                }}
              >
                {PAGES.map((_, i) => (
                  <OnboardingDot
                    key={i}
                    active={i === activeIndex}
                    lightBackground={!item.dark}
                  />
                ))}
              </View>

              {/* CTA */}
              {isLast ? (
                <TouchableOpacity
                  onPress={handleProceed}
                  accessibilityRole="button"
                  accessibilityLabel="Proceed to Secure Login"
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 14,
                    height: 52,
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#0F766E',
                      fontWeight: '700',
                      fontSize: 16,
                    }}
                  >
                    Proceed to Secure Login
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleNext}
                  accessibilityRole="button"
                  accessibilityLabel="Next"
                  style={{
                    alignSelf: 'flex-end',
                    backgroundColor:
                      item.dark ? '#14B8A6' : '#0F766E',
                    borderRadius: 14,
                    height: 48,
                    paddingHorizontal: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontWeight: '700',
                      fontSize: 15,
                    }}
                  >
                    Next →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </PageContent>
        </SafeAreaView>
      );

      if (item.dark) {
        return (
          <LinearGradient
            colors={['#0F766E', '#0F172A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.3, y: 1 }}
            style={{ width, flex: 1 }}
          >
            {content}
          </LinearGradient>
        );
      }

      return (
        <View style={{ width, flex: 1, backgroundColor: '#F8FAFC' }}>
          {content}
        </View>
      );
    },
    [activeIndex, width, handleNext, handleProceed],
  );

  return (
    <FlatList
      ref={listRef}
      data={PAGES}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add director-app/src/features/onboarding/screens/onboarding.screen.tsx
git add director-app/src/features/onboarding/components/onboarding-dot.tsx
git commit -m "feat(onboarding): OnboardingScreen with FlatList pager and Reanimated animations"
```

---

## Task 4: Expo Router — `(onboarding)` route group

**Files:**
- Create: `director-app/src/app/(onboarding)/_layout.tsx`
- Create: `director-app/src/app/(onboarding)/index.tsx`

- [ ] **Step 1: Create the layout**

`director-app/src/app/(onboarding)/_layout.tsx`:

```typescript
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 2: Create the route entry**

`director-app/src/app/(onboarding)/index.tsx`:

```typescript
import { OnboardingScreen } from '@/features/onboarding/screens/onboarding.screen';

export default OnboardingScreen;
```

- [ ] **Step 3: Commit**

```bash
git add director-app/src/app/(onboarding)/_layout.tsx
git add director-app/src/app/(onboarding)/index.tsx
git commit -m "feat(onboarding): add (onboarding) route group"
```

---

## Task 5: Root layout — wire `onboarding_complete` routing

**Files:**
- Modify: `director-app/src/app/_layout.tsx`

The current routing effect in `_layout.tsx` routes to either `/(app)` or `/(auth)/login` after `initialize()`. Add a check for `onboarding_complete` before routing to login.

- [ ] **Step 1: Update `_layout.tsx`**

Replace the entire file with:

```typescript
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, Slot, SplashScreen } from 'expo-router';
import { AppState, AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { SessionExpiredModal } from '@/features/auth/components/session-expired-modal';
import '@/global.css';

SplashScreen.preventAutoHideAsync();

const ONBOARDING_KEY = 'onboarding_complete';

export default function RootLayout() {
  const {
    isLoading,
    isAuthenticated,
    sessionExpired,
    initialize,
    logout,
    accessToken,
  } = useAuthStore();

  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);

  // Bootstrap: run auth init + read onboarding flag in parallel
  useEffect(() => {
    Promise.all([
      initialize(),
      SecureStore.getItemAsync(ONBOARDING_KEY).then((val) => {
        setOnboardingSeen(val === '1');
        setOnboardingChecked(true);
      }),
    ]).then(() => {
      SplashScreen.hideAsync();
    });
  }, [initialize]);

  // Route once both checks are resolved
  useEffect(() => {
    if (isLoading || !onboardingChecked) return;

    if (isAuthenticated) {
      router.replace('/(app)');
    } else if (onboardingSeen) {
      router.replace('/(auth)/login');
    } else {
      router.replace('/(onboarding)');
    }
  }, [isLoading, isAuthenticated, onboardingChecked, onboardingSeen]);

  // Re-check token validity when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextState: AppStateStatus) => {
        if (nextState === 'active' && accessToken) {
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
      {isLoading || !onboardingChecked ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#0F766E',
          }}
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : (
        <Slot />
      )}
      <SessionExpiredModal
        visible={sessionExpired}
        onSignInAgain={handleSignInAgain}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add director-app/src/app/_layout.tsx
git commit -m "feat(onboarding): wire onboarding_complete flag into root routing"
```

---

## Task 6: Manual QA checklist

- [ ] **Fresh install path (onboarding_complete not set)**
  1. Run `npx expo start -c`
  2. Open on device/web — should show Page 1 (teal gradient, "Institutional Security")
  3. Swipe left or tap "Next →" — Page 2 loads ("Real-Time Oversight", light background, mockup card visible)
  4. Swipe left or tap "Next →" — Page 3 loads ("Ready to Administer", teal gradient)
  5. Tap "Proceed to Secure Login" — navigates to login screen
  6. Kill app and reopen — should go straight to login (not onboarding)

- [ ] **Returning user with valid JWT**
  1. Log in successfully (JWT stored)
  2. Kill app, reopen — should skip both onboarding and login, land on home

- [ ] **Animations**
  - Each page's title/subtitle fades in and slides up ~24dp on page focus
  - Active dot widens from 8 → 24dp smoothly

- [ ] **Username validation**
  1. Enter `"  fa_admin  "` (spaces) → spaces trimmed, login proceeds
  2. Enter `"fa admin"` (space inside) → error: "Username may only contain letters, numbers, '-' or '_'"
  3. Enter `"fa@admin"` → same error
  4. Enter `"fa-admin_1"` → valid, login proceeds

- [ ] **Commit final**

```bash
git add .
git commit -m "feat(onboarding): complete onboarding wizard and username validation"
```
