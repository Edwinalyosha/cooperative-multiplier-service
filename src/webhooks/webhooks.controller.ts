import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { WebhooksService } from './webhooks.service';
import { FineractWebhookDto } from './dto/fineract-event.dto';
import { AdminApiKeyGuard } from '../auth/guards/api-key.guard';
import { Public } from '../auth/decorators/public.decorator';
import { WebhookSecretGuard } from './guards/webhook-secret.guard';

/** Shared HTML page renderer for both the preview (GET) and result (POST)
 * steps of the onboarding confirm flow — kept as one small helper so both
 * render identically styled pages. */
function renderHtmlPage(
  res: Response,
  title: string,
  body: string,
  statusCode = 200,
) {
  return res
    .status(statusCode)
    .type('html')
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
        `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}` +
        `button{font:inherit;padding:.6rem 1.2rem;background:#1a1a1a;color:#fff;border:none;border-radius:6px;cursor:pointer}` +
        `</style></head><body><h1>${title}</h1>${body}</body></html>`,
    );
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Every receiver below mutates a member's multiplier, which sets both their
  // interest rate and their borrowing limit. They were unauthenticated until
  // 2026-08-24 — anyone on the internet could move any member's standing in
  // either direction. Verified against m_hook_registered_events that only
  // USER/CREATE is registered in Fineract, so nothing legitimate was calling
  // the other five.
  @Post('fineract/contribution/on-time')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({ summary: 'Fineract callback: on-time contribution' })
  contributionOnTime(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleContributionOnTime(dto);
  }

  @Post('fineract/contribution/late')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({ summary: 'Fineract callback: late contribution' })
  contributionLate(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleContributionLate(dto);
  }

  @Post('fineract/repayment/on-time')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({ summary: 'Fineract callback: on-time repayment' })
  repaymentOnTime(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleRepaymentOnTime(dto);
  }

  @Post('fineract/repayment/late')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({ summary: 'Fineract callback: late repayment' })
  repaymentLate(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleRepaymentLate(dto);
  }

  @Post('fineract/loan/early-payoff')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({ summary: 'Fineract callback: early loan payoff' })
  earlyPayoff(@Body() dto: FineractWebhookDto) {
    return this.webhooksService.handleEarlyPayoff(dto);
  }

  /**
   * P0-0. This returns a single-use confirm token in its response body, and
   * that token maps a caller-supplied username onto any not-yet-onboarded
   * member's clientId. Unauthenticated, it was an identity-hijack primitive:
   * POST with your own Fineract username and a colleague's email address,
   * follow the returned link, and your login now owns their clientId — their
   * savings balance, their borrowing limit, their loan applications.
   *
   * Only unmapped clientIds were exploitable (`already_mapped` blocks the
   * rest), which is exactly every member during a bulk onboarding.
   *
   * Restricted to n8n by shared secret. Returning the token to a caller who
   * has proven it is n8n is fine — n8n is what needs it to send the email.
   */
  @Post('fineract/user/create')
  @Public() // opts out of JWT; WebhookSecretGuard below is its auth
  @UseGuards(WebhookSecretGuard)
  @ApiOperation({
    summary:
      'Fineract hook (via n8n): User created. Captured into PendingOnboarding ' +
      'and, on an exact single email match against Fineract Clients, issued a ' +
      'single-use 72h confirm token. Requires the webhook shared secret.',
  })
  fineractUserCreate(@Body() rawPayload: Record<string, unknown>) {
    return this.webhooksService.captureFineractUserCreate(rawPayload);
  }

  @Get('fineract/pending-onboarding')
  @Public() // opts out of JWT; AdminApiKeyGuard below is its auth
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin-only: list pending onboarding entries captured from Fineract ' +
      'User-create events, for the onboarding tool.',
  })
  listPendingOnboarding() {
    return this.webhooksService.listPendingOnboarding();
  }

  @Public() // clicked from an email; authorised by the token in the query
  @Get('fineract/onboarding/confirm')
  @ApiOperation({
    summary:
      'Preview step for the emailed confirm link — READ-ONLY, creates ' +
      'nothing. Shows what would happen and a button that POSTs to ' +
      'actually confirm. Split from POST deliberately: email clients and ' +
      'corporate link-scanners auto-fetch GET links to check for malware, ' +
      'which would otherwise silently consume a one-click GET action ' +
      'before a human ever saw it.',
  })
  async previewOnboarding(@Query('token') token: string, @Res() res: Response) {
    if (!token) {
      return renderHtmlPage(res, 'Missing token', '<p>No confirmation token was provided.</p>', 400);
    }

    const result = await this.webhooksService.previewOnboarding(token);

    switch (result.outcome) {
      case 'ok':
        return renderHtmlPage(
          res,
          'Confirm this mapping?',
          `<ul><li><strong>Username:</strong> ${result.username}</li>` +
            `<li><strong>Name:</strong> ${result.firstname ?? ''} ${result.lastname ?? ''}</li>` +
            `<li><strong>Fineract Client ID:</strong> ${result.clientId}</li></ul>` +
            `<form method="POST" action="/webhooks/fineract/onboarding/confirm?token=${encodeURIComponent(token)}">` +
            `<button type="submit">Confirm this mapping</button></form>` +
            `<p>Nothing is created until you click the button above.</p>`,
        );
      case 'not_found':
        return renderHtmlPage(res, 'Link not valid', '<p>This confirmation link is invalid.</p>', 404);
      case 'expired':
        return renderHtmlPage(
          res,
          'Link expired',
          '<p>This confirmation link has expired (72h limit). The entry is still in the pending-onboarding queue for manual handling.</p>',
          410,
        );
      case 'already_resolved':
        return renderHtmlPage(res, 'Already confirmed', '<p>This entry has already been resolved — no action needed.</p>');
    }
  }

  @Public() // submitted from the preview page; token in the query
  @Post('fineract/onboarding/confirm')
  @ApiOperation({
    summary:
      'Actually creates the User mapping row — only reached by submitting ' +
      'the preview page\'s button (POST), never by a bare link click. ' +
      'Single-use, 72h-expiring token.',
  })
  async confirmOnboarding(@Query('token') token: string, @Res() res: Response) {
    if (!token) {
      return renderHtmlPage(res, 'Missing token', '<p>No confirmation token was provided.</p>', 400);
    }

    const result = await this.webhooksService.confirmOnboarding(token);

    switch (result.outcome) {
      case 'confirmed':
        return renderHtmlPage(
          res,
          'Confirmed',
          `<p>Login mapping created for <strong>${result.username}</strong> → Fineract Client ${result.clientId}. ` +
            `They can log in to director-webapp now using their Fineract username and password.</p>`,
        );
      case 'not_found':
        return renderHtmlPage(res, 'Link not valid', '<p>This confirmation link is invalid.</p>', 404);
      case 'expired':
        return renderHtmlPage(
          res,
          'Link expired',
          '<p>This confirmation link has expired (72h limit). The entry is still in the pending-onboarding queue for manual handling.</p>',
          410,
        );
      case 'already_resolved':
        return renderHtmlPage(res, 'Already confirmed', '<p>This entry has already been resolved — no action needed.</p>');
      case 'already_mapped':
        return renderHtmlPage(
          res,
          'Client already mapped',
          `<p>Fineract Client ${result.clientId} already has a login (<strong>${result.existingUsername}</strong>). ` +
            `Can't create a second one for the same client — this entry needs manual review, not this link.</p>`,
          409,
        );
    }
  }

  @Post('fineract/pending-onboarding/:id/resolve')
  @Public() // opts out of JWT; AdminApiKeyGuard below is its auth
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin-only: manually resolve a PendingOnboarding entry by picking ' +
      'the clientId and role by hand. For zero/multiple-Fineract-email-' +
      'match cases (no auto-suggested confirm link), and for any ' +
      'Finance Manager onboarding — the auto-confirm email path is ' +
      'scoped to Director only, so Finance Manager always comes through ' +
      'here.',
  })
  manualResolve(
    @Param('id', ParseIntPipe) id: number,
    @Body('clientId', ParseIntPipe) clientId: number,
    @Body('role') role: string,
  ) {
    if (!Object.values(UserRole).includes(role as UserRole)) {
      throw new BadRequestException(
        `role must be one of: ${Object.values(UserRole).join(', ')}`,
      );
    }
    return this.webhooksService.manualResolveOnboarding(
      id,
      clientId,
      role as UserRole,
    );
  }
}
