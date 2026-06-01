import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';

@Injectable()
export class EligibilityScheduler {
  private readonly logger = new Logger(EligibilityScheduler.name);

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
  ) {}

  @Cron(process.env.CRON_ELIGIBILITY_REFRESH ?? '0 2 * * *')
  async handleDailyEligibilityRefresh() {
    this.logger.log('Starting daily eligibility refresh');

    if (this.queue.isAsyncEnabled()) {
      await this.queue.enqueueBatchRefreshEligibility();
      this.logger.log('Batch eligibility refresh enqueued');
      return;
    }

    const result = await this.multiplierService.refreshAllEligibility();
    this.logger.log(
      `Daily eligibility refresh complete: ${result.refreshed} clients`,
    );
  }
}
