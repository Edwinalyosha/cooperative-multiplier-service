import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { FineractWebhookDto } from './dto/fineract-event.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('fineract/contribution/on-time')
  @ApiOperation({ summary: 'Fineract callback: on-time contribution' })
  contributionOnTime(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleContributionOnTime(dto);
  }

  @Post('fineract/contribution/late')
  @ApiOperation({ summary: 'Fineract callback: late contribution' })
  contributionLate(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleContributionLate(dto);
  }

  @Post('fineract/repayment/on-time')
  @ApiOperation({ summary: 'Fineract callback: on-time repayment' })
  repaymentOnTime(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleRepaymentOnTime(dto);
  }

  @Post('fineract/repayment/late')
  @ApiOperation({ summary: 'Fineract callback: late repayment' })
  repaymentLate(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleRepaymentLate(dto);
  }

  @Post('fineract/loan/early-payoff')
  @ApiOperation({ summary: 'Fineract callback: early loan payoff' })
  earlyPayoff(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleEarlyPayoff(dto);
  }
}
