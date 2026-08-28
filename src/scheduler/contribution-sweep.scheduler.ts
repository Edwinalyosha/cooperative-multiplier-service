import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContributionSweepService } from '../contributions/contribution-sweep.service';

/**
 * Runs the weekly contribution sweep just after the period closes.
 *
 * Default schedule is Sunday 22:00 UTC = Monday 01:00 in Kampala, an hour
 * after the cooperative's week ends at Sunday midnight local. The container
 * runs TZ=UTC so the cron expression is in UTC, while the PERIOD itself is
 * anchored to Kampala — see contribution-period.util.ts for why that
 * distinction matters.
 *
 * The sweep always assesses the most recently COMPLETED week, so running it
 * late (after a restart, say) still assesses the right period rather than
 * skipping it. Running it twice is harmless: it is idempotent per member per
 * period.
 */
@Injectable()
export class ContributionSweepScheduler {
  private readonly logger = new Logger(ContributionSweepScheduler.name);

  constructor(private readonly sweep: ContributionSweepService) {}

  @Cron(process.env.CRON_CONTRIBUTION_SWEEP ?? '0 22 * * 0')
  async handleWeeklySweep() {
    this.logger.log('Starting weekly contribution sweep');
    const result = await this.sweep.sweep();
    this.logger.log(
      `Contribution sweep ${result.period.startDate}..${result.period.endDate}: ` +
        `${result.onTime} on time, ${result.late} late, ` +
        `${result.skippedAlreadyProcessed} already processed, ` +
        `${result.skippedTooNew} too new, ${result.failed} failed`,
    );
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} member(s) could not be assessed and were NOT marked ` +
          'late. They will be picked up only if the sweep is re-run before ' +
          'the next period closes.',
      );
    }
  }
}
