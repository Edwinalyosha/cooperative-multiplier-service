import { authClient } from './auth.client';
import { LoginCredentials, TokenPair } from '../types/auth.types';

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<TokenPair> => {
    const { data } = await authClient.post<TokenPair>(
      '/mobile/v1/auth/login',
      credentials,
    );
    return data;
  },

  refresh: async (refreshToken: string): Promise<TokenPair> => {
    const { data } = await authClient.post<TokenPair>(
      '/mobile/v1/auth/refresh',
      { refreshToken },
    );
    return data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await authClient.post('/mobile/v1/auth/logout', { refreshToken });
  },
};
