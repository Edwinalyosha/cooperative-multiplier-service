import { useAuthStore } from '../store/auth.store';

/**
 * Convenience hook — returns the auth state and actions from the Zustand store.
 * Use this in screens and components instead of importing useAuthStore directly.
 */
export function useAuth() {
  return useAuthStore();
}
