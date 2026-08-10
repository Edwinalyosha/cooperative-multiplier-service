import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Redis } from 'ioredis';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { MobileJwtStrategy } from './strategies/mobile-jwt.strategy';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [ConfigModule, PassportModule, JwtModule.register({}), PrismaModule],
  controllers: [MobileAuthController],
  providers: [
    MobileAuthService,
    MobileJwtStrategy,
    MobileJwtGuard,
    RolesGuard,
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
  exports: [MobileJwtGuard, MobileJwtStrategy, RolesGuard],
})
export class MobileAuthModule {}
