import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { AddGuarantorDto } from './dto/add-guarantor.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';

export interface GuarantorRecord {
  id: number;
  loanId: number;
  guarantorClientId: number;
  relationship: string | null;
  notes: string | null;
  createdAt: Date;
}

@Injectable()
export class LoansService {
  private readonly guarantors = new Map<number, GuarantorRecord[]>();
  private nextId = 1;

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
    private readonly fineract: FineractService,
  ) {}

  listGuarantors(loanId: number): GuarantorRecord[] {
    return [...(this.guarantors.get(loanId) ?? [])];
  }

  addGuarantor(loanId: number, dto: AddGuarantorDto): GuarantorRecord {
    const record: GuarantorRecord = {
      id: this.nextId++,
      loanId,
      guarantorClientId: dto.guarantorClientId,
      relationship: dto.relationship ?? null,
      notes: dto.notes ?? null,
      createdAt: new Date(),
    };

    const existing = this.guarantors.get(loanId) ?? [];
    existing.push(record);
    this.guarantors.set(loanId, existing);
    return record;
  }

  removeGuarantor(loanId: number, guarantorId: number): void {
    const list = this.guarantors.get(loanId);
    if (!list) {
      throw new NotFoundException(`Loan ${loanId} has no guarantors`);
    }

    const index = list.findIndex((g) => g.id === guarantorId);
    if (index === -1) {
      throw new NotFoundException(
        `Guarantor ${guarantorId} not found on loan ${loanId}`,
      );
    }

    list.splice(index, 1);
    this.guarantors.set(loanId, list);
  }

  async recordRepayment(dto: RecordRepaymentDto, async = false) {
    let eventType: MultiplierEventType;
    if (dto.earlyPayoff) {
      eventType = MultiplierEventType.EARLY_FULL_PAYOFF;
    } else if (dto.onTime) {
      eventType = MultiplierEventType.ON_TIME_REPAYMENT;
    } else {
      eventType = MultiplierEventType.LATE_REPAYMENT;
    }

    const notes =
      dto.notes ??
      (dto.earlyPayoff
        ? 'Early full payoff'
        : dto.onTime
          ? 'Repayment on time'
          : 'Repayment late');

    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        dto.triggeredBy ?? 'loans-api',
        notes,
      );
    }

    const result = await this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      dto.triggeredBy ?? 'loans-api',
      notes,
    );

    const activeLoans = await this.fineract.getActiveLoanIds(dto.clientId);

    return {
      ...result,
      activeLoanAccountIds: activeLoans,
    };
  }

  async getRepaymentSummary(clientId: number) {
    const profile = await this.multiplierService.getProfile(clientId);
    const activeLoans = await this.fineract.getActiveLoanIds(clientId);

    return {
      clientId,
      multiplier: profile.multiplier,
      consecutiveOnTimeRepayments: profile.consecutiveOnTimeRepayments,
      lastRepaymentStatus: profile.lastRepaymentStatus,
      activeLoanAccountIds: activeLoans,
      cachedMaxLoanAmount: profile.maxLoanAmount,
      isEligible: profile.isEligible,
    };
  }
}
