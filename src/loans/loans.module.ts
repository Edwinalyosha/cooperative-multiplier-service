import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { MultiplierModule } from '../multiplier/multiplier.module';
import { QueueModule } from '../queue/queue.module';
import { FineractModule } from '../fineract/fineract.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module';

@Module({
  imports: [
    MultiplierModule,
    QueueModule,
    FineractModule,
    PrismaModule,
    MobileAuthModule,
  ],
  providers: [LoansService],
  controllers: [LoansController],
})
export class LoansModule {}
