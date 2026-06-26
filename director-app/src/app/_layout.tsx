import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, Slot, SplashScreen } from 'expo-router';
import { AppState, AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { SessionExpiredModal } from '@/features/auth/components/session-expired-modal';
import { STORAGE_KEYS } from '@/constants/storage-keys';
import '@/global.css';

SplashScreen.preventAutoHideAsync();

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
      SecureStore.getItemAsync(STORAGE_KEYS.ONBOARDING_COMPLETE)
        .then((val) => {
          setOnboardingSeen(val === '1');
        })
        .catch(() => {
          // SecureStore unavailable — treat as first run
          setOnboardingSeen(false);
        })
        .finally(() => {
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
      router.replace('/(app)/home');
    } else if (onboardingSeen) {
      router.replace('/(auth)/login');
    } else {
      router.replace('/(onboarding)/welcome');
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

  const showBootstrapSpinner = isLoading || !onboardingChecked;

  return (
    <>
      <Slot />
      {showBootstrapSpinner && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#0F766E',
          }}
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
      <SessionExpiredModal
        visible={sessionExpired}
        onSignInAgain={handleSignInAgain}
      />
    </>
  );
}
