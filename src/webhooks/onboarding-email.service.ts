import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Sends the member's "your portal access is ready" email, at the only moment
 * that sentence is true: after their login mapping actually exists.
 *
 * It used to be sent by n8n when the Fineract user was created — before any
 * mapping existed — so a member could be told to log in and then be rejected
 * (MLTD problem P005). The mapping is created here in the backend, so this is
 * where the fact is known.
 *
 * NOT related to the custom Java email plugin inside the Fineract container
 * (see AGENT_HANDOFF.md). That one overrides Fineract's own account and
 * password-reset emails and has a documented crash-loop history. This is a
 * plain HTTPS call to Resend from the NestJS process and touches none of it.
 * The two are complementary: Fineract sends the credentials, this says where
 * to use them.
 */
@Injectable()
export class OnboardingEmailService {
  private readonly logger = new Logger(OnboardingEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /**
   * Never throws. The caller has just created a login mapping — a failed
   * email must not undo that, and must not turn a successful onboarding into
   * an error page for the admin who clicked confirm. Failures are logged for
   * follow-up; the worst case is a member who needs telling by hand.
   *
   * This is the same lesson as P005 itself, where an email failure aborted
   * the onboarding capture entirely.
   */
  async sendPortalReady(params: {
    email: string | null;
    firstname: string | null;
    username: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('email.resendApiKey');
    const from = this.config.get<string>('email.from');
    const portalUrl = this.config.get<string>('email.portalUrl');

    if (!params.email) {
      this.logger.log(
        `No email on record for ${params.username}; portal-ready email skipped.`,
      );
      return;
    }

    if (!apiKey || !from) {
      this.logger.warn(
        `Portal-ready email not sent to ${params.username}: email is not ` +
          'configured (needs RESEND_API_KEY and ONBOARDING_EMAIL_FROM). ' +
          'Tell the member directly that they can log in.',
      );
      return;
    }

    try {
      await firstValueFrom(
        this.http.post(
          'https://api.resend.com/emails',
          {
            from,
            to: params.email,
            subject: 'Your Multiplier Director Portal access is ready',
            html: this.body(params.firstname, params.username, portalUrl),
          },
          { headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );
      this.logger.log(`Portal-ready email sent for ${params.username}.`);
    } catch (error) {
      // Deliberately swallowed — see the method doc.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      this.logger.error(
        `Portal-ready email FAILED for ${params.username}` +
          (status ? ` (status ${status})` : '') +
          '. The mapping was created successfully — tell the member manually.',
      );
    }
  }

  private body(
    firstname: string | null,
    username: string,
    portalUrl: string | undefined,
  ): string {
    const url = portalUrl ?? 'https://director.8teventures.com/login';
    const greeting = firstname ? `Hi ${firstname},` : 'Hello,';

    return (
      '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;' +
      'max-width:32rem;margin:0 auto;color:#1a1a1a">' +
      '<h1 style="font-size:20px;margin-bottom:4px">Your portal access is ready</h1>' +
      `<p style="color:#555;line-height:1.5">${greeting} you can now sign in to the ` +
      'Multiplier Director Portal.</p>' +
      `<p style="line-height:1.5"><strong>Username:</strong> ${username}<br/>` +
      '<strong>Password:</strong> the same one you use for Fineract — there is no ' +
      'separate portal password.</p>' +
      `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;` +
      'background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 20px;' +
      'border-radius:6px;font-weight:600">Open the Director Portal</a></p>' +
      '<p style="color:#888;font-size:13px;line-height:1.5">If you weren\'t ' +
      'expecting this, you can ignore this email.</p></div>'
    );
  }
}
