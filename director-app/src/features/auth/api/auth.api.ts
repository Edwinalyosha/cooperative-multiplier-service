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
