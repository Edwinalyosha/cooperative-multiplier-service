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
    const secret = config.get<string>('jwt.accessSecret');

    // Fatal at boot, deliberately. This previously fell back to
    // 'dev-jwt-secret-change-in-prod' — a literal committed to this
    // repository — which would have let anyone who read the source forge a
    // token for any user, role, and clientId, walking through every guard in
    // the application. Note the same default also lived in configuration.ts:
    // removing it there alone would have left this copy silently in effect.
    //
    // Unlike the API-key guards, which fail closed per-request to avoid a
    // crash loop under `restart: unless-stopped`, there is no safe degraded
    // mode for a service that cannot verify its own tokens. Refuse to start.
    if (!secret) {
      throw new Error(
        'JWT_ACCESS_SECRET is not set. Refusing to start: without it the ' +
          'service cannot verify tokens, and any fallback value would be ' +
          'known to anyone who has read this source. Generate one with ' +
          '`openssl rand -hex 32`.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      clockTolerance: 30,
    } as unknown as ConstructorParameters<typeof Strategy>[0]);
  }

  validate(payload: MobileJwtPayload): MobileJwtPayload {
    return payload;
  }
}
