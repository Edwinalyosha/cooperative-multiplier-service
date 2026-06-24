import { LoginCredentials, TokenPair } from '../types/auth.types';

export const authApi = {
  login: async (_c: LoginCredentials): Promise<TokenPair> => {
    throw new Error('not implemented');
  },
  refresh: async (_t: string): Promise<TokenPair> => {
    throw new Error('not implemented');
  },
  logout: async (_t: string): Promise<void> => {},
};
