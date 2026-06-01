import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { FineractModule } from '../fineract/fineract.module';

@Module({
  imports: [MultiplierModule, QueueModule, FineractModule],
  providers: [LoansService],
  controllers: [LoansController],
})
export class LoansModule {}
