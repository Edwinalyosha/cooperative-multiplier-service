import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Post('fineract/user/create')
  @ApiOperation({
    summary:
      'Fineract hook (via n8n): User created. Payload shape unconfirmed as of ' +
      '2026-08-19 — captured into PendingOnboarding for discovery, not yet ' +
      'auto-resolved to a mapping row. See ONBOARDING-AND-AUTH-PLAN.md.',
  })
  fineractUserCreate(@Body() rawPayload: Record<string, unknown>) {
    return this.webhooksService.captureFineractUserCreate(rawPayload);
  }

  @Get('fineract/pending-onboarding')
  @ApiOperation({
    summary:
      'List pending onboarding entries captured from Fineract User-create ' +
      'events. Discovery/debugging endpoint — NOT yet admin-gated, do not ' +
      'expose beyond this dev/testing phase.',
  })
  listPendingOnboarding() {
    return this.webhooksService.listPendingOnboarding();
  }

  @Get('fineract/onboarding/confirm')
  @ApiOperation({
    summary:
      'One-click confirm link (emailed via n8n/Resend): creates the real ' +
      'User mapping row for the suggested clientId match. Single-use, ' +
      '72h-expiring token. Renders a plain HTML result page, not JSON — ' +
      'this is meant to be opened directly from an email client.',
  })
  async confirmOnboarding(@Query('token') token: string, @Res() res: Response) {
    const page = (title: string, body: string, statusCode = 200) =>
      res
        .status(statusCode)
        .type('html')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
            `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}</style>` +
            `</head><body><h1>${title}</h1><p>${body}</p></body></html>`,
        );

    if (!token) {
      return page('Missing token', 'No confirmation token was provided.', 400);
    }

    const result = await this.webhooksService.confirmOnboarding(token);

    switch (result.outcome) {
      case 'confirmed':
        return page(
          'Confirmed',
          `Login mapping created for <strong>${result.username}</strong> → Fineract Client ${result.clientId}. ` +
            `Note: this account can't log in yet — the hybrid Fineract-based auth switch isn't built yet ` +
            `(ONBOARDING-AND-AUTH-PLAN.md step 3). It'll start working once that ships.`,
        );
      case 'not_found':
        return page('Link not valid', 'This confirmation link is invalid.', 404);
      case 'expired':
        return page(
          'Link expired',
          'This confirmation link has expired (72h limit). The entry is still in the pending-onboarding queue for manual handling.',
          410,
        );
      case 'already_resolved':
        return page('Already confirmed', 'This entry has already been resolved — no action needed.', 200);
      case 'already_mapped':
        return page(
          'Client already mapped',
          `Fineract Client ${result.clientId} already has a login (<strong>${result.existingUsername}</strong>). ` +
            `Can't create a second one for the same client — this entry needs manual review, not this link.`,
          409,
        );
    }
  }
}
