import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, MultiplierModule, AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
