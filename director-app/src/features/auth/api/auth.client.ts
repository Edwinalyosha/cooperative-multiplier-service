import axios from 'axios';
import { API_BASE_URL } from './api.config';

/**
 * Plain HTTP client for auth endpoints only — no interceptors, no store dependency.
 */
export const authClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});
