import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { FineractModule } from '../fineract/fineract.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [MobileAuthModule, MultiplierModule, FineractModule, ReportsModule],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
