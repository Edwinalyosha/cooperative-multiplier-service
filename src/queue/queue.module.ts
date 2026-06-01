import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MULTIPLIER_QUEUE } from './queue.constants';
import { MultiplierQueueService } from './multiplier-queue.service';
import { MultiplierProcessor } from './multiplier.processor';
import { MultiplierModule } from '../multiplier/multiplier.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: MULTIPLIER_QUEUE }),
    forwardRef(() => MultiplierModule),
  ],
  providers: [MultiplierQueueService, MultiplierProcessor],
  exports: [MultiplierQueueService, BullModule],
})
export class QueueModule {}
