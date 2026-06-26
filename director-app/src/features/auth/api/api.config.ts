/**
 * API base URL for the multiplier backend.
 * Set EXPO_PUBLIC_API_BASE_URL in director-app/.env for local dev (e.g. http://192.168.1.10:3000).
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.sagehive.cloud';
