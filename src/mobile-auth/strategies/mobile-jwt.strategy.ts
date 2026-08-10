import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';

export interface MobileJwtPayload {
  sub: number;
  username: string;
  role: UserRole;
  clientId: number | null;
  iat: number;
  exp: number;
}

@Injectable()
export class MobileJwtStrategy extends PassportStrategy(
  Strategy,
  'mobile-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('jwt.accessSecret') ??
        'dev-jwt-secret-change-in-prod',
      clockTolerance: 30,
    } as unknown as ConstructorParameters<typeof Strategy>[0]);
  }

  validate(payload: MobileJwtPayload): MobileJwtPayload {
    return payload;
  }
}
