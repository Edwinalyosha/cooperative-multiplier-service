import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { FineractModule } from '../fineract/fineract.module';
import { ReportsModule } from '../reports/reports.module';
// Provides ContributionLedgerService for the "this week" and arrears views.
// ConfigModule is global (app.module.ts) so ConfigService needs no import;
// this one does, and omitting it fails at BOOT rather than at first request.
import { ContributionsModule } from '../contributions/contributions.module';

@Module({
  imports: [
    MobileAuthModule,
    MultiplierModule,
    FineractModule,
    ReportsModule,
    ContributionsModule,
  ],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
