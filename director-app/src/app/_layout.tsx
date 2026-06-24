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
