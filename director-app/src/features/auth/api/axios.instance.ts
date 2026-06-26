import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { authClient } from './auth.client';
import { API_BASE_URL } from './api.config';
import { useAuthStore } from '../store/auth.store';
import { TokenPair } from '../types/auth.types';

export const axiosInstance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// --- Request interceptor: attach access token ---
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// --- Response interceptor: handle 401 with refresh + mutex ---
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null): void {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token!);
    }
  });
  refreshQueue = [];
}

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Skip refresh for the refresh endpoint itself to avoid infinite loop
    if (originalRequest.url?.includes('/mobile/v1/auth/refresh')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Queue this request until the ongoing refresh resolves
      return new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axiosInstance(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    const { refreshToken, setTokens, markSessionExpired } =
      useAuthStore.getState();

    try {
      const { data: newPair } = await authClient.post<TokenPair>(
        '/mobile/v1/auth/refresh',
        { refreshToken },
      );
      setTokens(newPair);
      processQueue(null, newPair.accessToken);
      originalRequest.headers.Authorization = `Bearer ${newPair.accessToken}`;
      return axiosInstance(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      markSessionExpired();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
