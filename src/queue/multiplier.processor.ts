import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import {
  MULTIPLIER_QUEUE,
  MultiplierJobName,
  ProcessEventJobPayload,
  RefreshEligibilityJobPayload,
} from './queue.constants';

@Processor(MULTIPLIER_QUEUE)
export class MultiplierProcessor extends WorkerHost {
  private readonly logger = new Logger(MultiplierProcessor.name);

  constructor(private readonly multiplierService: MultiplierService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Processing job ${job.name} id=${job.id}`);

    switch (job.name) {
      case MultiplierJobName.PROCESS_EVENT:
        return this.handleProcessEvent(job.data as ProcessEventJobPayload);
      case MultiplierJobName.REFRESH_ELIGIBILITY:
        return this.handleRefreshEligibility(
          job.data as RefreshEligibilityJobPayload,
        );
      case MultiplierJobName.BATCH_REFRESH_ELIGIBILITY:
        return this.multiplierService.refreshAllEligibility();
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private handleProcessEvent(data: ProcessEventJobPayload) {
    return this.multiplierService.processEvent(
      data.clientId,
      data.eventType as MultiplierEventType,
      data.triggeredBy ?? 'queue',
      data.notes,
    );
  }

  private handleRefreshEligibility(data: RefreshEligibilityJobPayload) {
    return this.multiplierService.refreshEligibility(data.clientId);
  }
}
