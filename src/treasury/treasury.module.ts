import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
// FineractService is the only dependency. Omitting this import fails at BOOT
// rather than at first request — see MLTD-P013.
import { FineractModule } from '../fineract/fineract.module';

@Module({
  imports: [FineractModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
