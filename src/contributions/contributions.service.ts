import { Injectable } from '@nestjs/common';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { RecordContributionDto } from './dto/record-contribution.dto';

@Injectable()
export class ContributionsService {
  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
    private readonly fineract: FineractService,
  ) {}

  async recordContribution(dto: RecordContributionDto, async = false) {
    const eventType = dto.onTime
      ? MultiplierEventType.ON_TIME_CONTRIBUTION
      : MultiplierEventType.LATE_CONTRIBUTION;

    const notes =
      dto.notes ??
      (dto.onTime ? 'Contribution recorded on time' : 'Contribution recorded late');

    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        dto.triggeredBy ?? 'contributions-api',
        notes,
      );
    }

    const result = await this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      dto.triggeredBy ?? 'contributions-api',
      notes,
    );

    const balance = await this.fineract.getContributionBalance(dto.clientId);

    return {
      ...result,
      fineractBalance: balance,
    };
  }

  async getContributionSummary(clientId: number) {
    const profile = await this.multiplierService.getProfile(clientId);
    const balance = await this.fineract.getContributionBalance(clientId);

    return {
      clientId,
      multiplier: profile.multiplier,
      consecutiveOnTimeContributions: profile.consecutiveOnTimeContributions,
      lastContributionStatus: profile.lastContributionStatus,
      fineractContributionBalance: balance,
      cachedMaxLoanAmount: profile.maxLoanAmount,
      isEligible: profile.isEligible,
    };
  }
}
