import { Injectable } from '@nestjs/common';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { FineractWebhookDto } from './dto/fineract-event.dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
  ) {}

  private async dispatch(
    dto: FineractWebhookDto,
    eventType: MultiplierEventType,
    defaultNote: string,
  ) {
    const notes =
      dto.notes ??
      `${defaultNote} (external: ${dto.externalId ?? 'n/a'})`;

    if (this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        'fineract-webhook',
        notes,
      );
    }

    return this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      'fineract-webhook',
      notes,
    );
  }

  handleContributionOnTime(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'Contribution on time',
    );
  }

  handleContributionLate(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.LATE_CONTRIBUTION,
      'Contribution late',
    );
  }

  handleRepaymentOnTime(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.ON_TIME_REPAYMENT,
      'Repayment on time',
    );
  }

  handleRepaymentLate(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.LATE_REPAYMENT,
      'Repayment late',
    );
  }

  handleEarlyPayoff(dto: FineractWebhookDto) {
    return this.dispatch(
      dto,
      MultiplierEventType.EARLY_FULL_PAYOFF,
      'Early payoff',
    );
  }
}
