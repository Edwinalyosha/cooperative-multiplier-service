import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';

const STREAK_MILESTONE = 3;

@Injectable()
export class StreakScheduler {
  private readonly logger = new Logger(StreakScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
  ) {}

  @Cron(process.env.CRON_STREAK_CHECK ?? '0 6 * * *')
  async handleStreakMilestones() {
    this.logger.log('Checking contribution streak milestones');

    const directors = await this.prisma.directorMultiplier.findMany({
      where: {
        consecutiveOnTimeContributions: { gte: STREAK_MILESTONE },
      },
    });

    let processed = 0;
    for (const director of directors) {
      const streak = director.consecutiveOnTimeContributions ?? 0;
      if (streak % STREAK_MILESTONE !== 0) continue;

      const recentStreakEvent = await this.prisma.multiplierHistory.findFirst({
        where: {
          clientId: director.clientId,
          eventType: MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (recentStreakEvent) {
        const hoursSince =
          (Date.now() - recentStreakEvent.createdAt.getTime()) / 3_600_000;
        if (hoursSince < 24) continue;
      }

      const notes = `Streak milestone: ${streak} consecutive on-time contributions`;
      if (this.queue.isAsyncEnabled()) {
        await this.queue.enqueueProcessEvent(
          director.clientId,
          MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
          'streak-cron',
          notes,
        );
      } else {
        await this.multiplierService.processEvent(
          director.clientId,
          MultiplierEventType.CONSECUTIVE_ON_TIME_CONTRIBUTIONS,
          'streak-cron',
          notes,
        );
      }
      processed++;
    }

    this.logger.log(`Streak check complete: ${processed} milestones queued`);
  }
}
