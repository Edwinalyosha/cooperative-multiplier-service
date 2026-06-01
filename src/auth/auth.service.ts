import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class AuthService {
  /**
   * Validates credentials against env-configured service users.
   * Replace with Fineract/OAuth when production auth is ready.
   */
  login(dto: LoginDto): AuthTokenResponse {
    const expectedUser = process.env.API_USERNAME ?? 'admin';
    const expectedPass = process.env.API_PASSWORD ?? 'changeme';

    if (dto.username !== expectedUser || dto.password !== expectedPass) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const secret = process.env.API_KEY ?? 'dev-api-key';
    return {
      accessToken: secret,
      tokenType: 'Bearer',
      expiresIn: 86400,
    };
  }

  validateToken(token: string): boolean {
    const apiKey = process.env.API_KEY ?? 'dev-api-key';
    return token === apiKey;
  }
}
