import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { MultiplierController } from './multiplier.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { FineractModule } from '../fineract/fineract.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    PrismaModule,
    FineractModule,
    ConfigModule,
    forwardRef(() => QueueModule),
  ],
  providers: [MultiplierService],
  controllers: [MultiplierController],
  exports: [MultiplierService],
})
export class MultiplierModule {}
