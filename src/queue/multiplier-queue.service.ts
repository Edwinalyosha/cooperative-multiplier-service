import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  MULTIPLIER_QUEUE,
  MultiplierJobName,
  ProcessEventJobPayload,
  RefreshEligibilityJobPayload,
} from './queue.constants';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';

@Injectable()
export class MultiplierQueueService {
  private readonly logger = new Logger(MultiplierQueueService.name);

  constructor(
    @InjectQueue(MULTIPLIER_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  isAsyncEnabled(): boolean {
    return this.config.get<boolean>('queue.asyncEnabled') ?? true;
  }

  async enqueueProcessEvent(
    clientId: number,
    eventType: MultiplierEventType,
    triggeredBy?: string,
    notes?: string,
  ) {
    const payload: ProcessEventJobPayload = {
      clientId,
      eventType,
      triggeredBy,
      notes,
    };
    const job = await this.queue.add(MultiplierJobName.PROCESS_EVENT, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    this.logger.log(`Enqueued ${MultiplierJobName.PROCESS_EVENT} job ${job.id}`);
    return { jobId: job.id, status: 'queued' as const };
  }

  async enqueueRefreshEligibility(clientId: number) {
    const payload: RefreshEligibilityJobPayload = { clientId };
    const job = await this.queue.add(
      MultiplierJobName.REFRESH_ELIGIBILITY,
      payload,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    return { jobId: job.id, status: 'queued' as const };
  }

  async enqueueBatchRefreshEligibility() {
    const job = await this.queue.add(
      MultiplierJobName.BATCH_REFRESH_ELIGIBILITY,
      {},
      { attempts: 1 },
    );
    return { jobId: job.id, status: 'queued' as const };
  }
}
