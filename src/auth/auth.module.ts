import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminApiKeyGuard, ReportsApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AdminApiKeyGuard, ReportsApiKeyGuard],
  exports: [AuthService, AdminApiKeyGuard, ReportsApiKeyGuard],
})
export class AuthModule {}
