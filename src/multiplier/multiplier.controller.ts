import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { MultiplierService } from './multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { MultiplierEventType } from './multiplier-event.enum';
import { ProcessEventDto } from './dto/process-event.dto';
import { ClientEventDto } from './dto/client-event.dto';
import { EligibilityQueryDto } from './dto/eligibility-query.dto';

@ApiTags('multiplier')
@Controller('multiplier')
export class MultiplierController {
  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
  ) {}

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('process')
  @ApiOperation({ summary: 'Process any multiplier event (generic)' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  async process(
    @Body() dto: ProcessEventDto,
    @Query('async') async?: boolean,
  ) {
    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        dto.eventType,
        dto.triggeredBy,
        dto.notes,
      );
    }
    return this.multiplierService.processFromDto(dto);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('contribution/on-time')
  @ApiOperation({ summary: 'Reward on-time contribution' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  contributionOnTime(
    @Body() dto: ClientEventDto,
    @Query('async') async?: boolean,
  ) {
    return this.dispatchEvent(
      dto,
      MultiplierEventType.ON_TIME_CONTRIBUTION,
      'On-time contribution',
      async,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('contribution/late')
  @ApiOperation({ summary: 'Penalize late contribution' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  contributionLate(
    @Body() dto: ClientEventDto,
    @Query('async') async?: boolean,
  ) {
    return this.dispatchEvent(
      dto,
      MultiplierEventType.LATE_CONTRIBUTION,
      'Late contribution',
      async,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('repayment/on-time')
  @ApiOperation({ summary: 'Record on-time loan repayment' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  repaymentOnTime(
    @Body() dto: ClientEventDto,
    @Query('async') async?: boolean,
  ) {
    return this.dispatchEvent(
      dto,
      MultiplierEventType.ON_TIME_REPAYMENT,
      'On-time repayment',
      async,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('repayment/late')
  @ApiOperation({ summary: 'Penalize late loan repayment' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  repaymentLate(
    @Body() dto: ClientEventDto,
    @Query('async') async?: boolean,
  ) {
    return this.dispatchEvent(
      dto,
      MultiplierEventType.LATE_REPAYMENT,
      'Late repayment',
      async,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('loan/early-payoff')
  @ApiOperation({ summary: 'Strong reward for early full loan payoff' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  loanEarlyPayoff(
    @Body() dto: ClientEventDto,
    @Query('async') async?: boolean,
  ) {
    return this.dispatchEvent(
      dto,
      MultiplierEventType.EARLY_FULL_PAYOFF,
      'Early full payoff',
      async,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('profile/:clientId')
  @ApiOperation({ summary: 'Current multiplier profile for a client' })
  profile(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.multiplierService.getProfile(clientId);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('history/:clientId')
  @ApiOperation({ summary: 'Multiplier change history for a client' })
  history(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.multiplierService.getHistory(clientId);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('eligibility/:clientId')
  @ApiOperation({
    summary:
      'Loan eligibility (cached, Fineract, or override). Use ?refresh=true to force Fineract fetch.',
  })
  eligibility(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: EligibilityQueryDto,
  ) {
    return this.multiplierService.getEligibility(
      clientId,
      query.contributionBalance,
      query.refresh,
    );
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('eligibility/:clientId/refresh')
  @ApiOperation({ summary: 'Force eligibility refresh from Fineract and cache' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  async refreshEligibility(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query('async') async?: boolean,
  ) {
    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueRefreshEligibility(clientId);
    }
    return this.multiplierService.refreshEligibility(clientId);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('eligibility/refresh-all')
  @ApiOperation({ summary: 'Refresh eligibility for all directors (admin/cron)' })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  async refreshAllEligibility(@Query('async') async?: boolean) {
    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueBatchRefreshEligibility();
    }
    return this.multiplierService.refreshAllEligibility();
  }

  private dispatchEvent(
    dto: ClientEventDto,
    eventType: MultiplierEventType,
    defaultNote: string,
    async?: boolean,
  ) {
    if (async && this.queue.isAsyncEnabled()) {
      return this.queue.enqueueProcessEvent(
        dto.clientId,
        eventType,
        dto.triggeredBy ?? 'api',
        dto.notes ?? defaultNote,
      );
    }
    return this.multiplierService.processEvent(
      dto.clientId,
      eventType,
      dto.triggeredBy ?? 'api',
      dto.notes ?? defaultNote,
    );
  }
}
