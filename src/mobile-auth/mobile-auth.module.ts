import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { Redis } from 'ioredis';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { MobileJwtStrategy } from './strategies/mobile-jwt.strategy';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [MobileAuthController],
  providers: [
    MobileAuthService,
    MobileJwtStrategy,
    MobileJwtGuard,
    {
      provide: 'MOBILE_AUTH_REDIS',
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('redis.host') ?? 'localhost',
          port: config.get<number>('redis.port') ?? 6379,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [MobileJwtGuard, MobileJwtStrategy],
})
export class MobileAuthModule {}
