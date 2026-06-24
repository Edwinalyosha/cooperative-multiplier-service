export interface FineractUser {
  id: number;
  username: string;
  displayName: string;
  officeId: number;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: FineractUser;
}
