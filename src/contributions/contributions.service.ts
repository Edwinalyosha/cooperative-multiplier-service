import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MultiplierService } from '../multiplier/multiplier.service';
import { MultiplierQueueService } from '../queue/multiplier-queue.service';
import { FineractService } from '../fineract/fineract.service';
import { MultiplierEventType } from '../multiplier/multiplier-event.enum';
import { RecordContributionDto } from './dto/record-contribution.dto';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ContributionsService {
  private readonly logger = new Logger(ContributionsService.name);

  constructor(
    private readonly multiplierService: MultiplierService,
    private readonly queue: MultiplierQueueService,
    private readonly fineract: FineractService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Records money a director has handed over for their weekly contribution.
   *
   * The deposit goes into Fineract, which stays authoritative for money. The
   * ledger is NOT written here: the member's "this week" view reads deposits
   * live so they see it immediately, and the weekly sweep allocates it at
   * close. Pre-crediting the ledger would double-count, because the sweep
   * re-reads the same deposits.
   *
   * Targets the CONTRIBUTIONS account, never savings. Money in the wrong
   * account earns no multiplier, is not leveraged into the borrowing limit,
   * and does not count toward the profit split — so a missing contributions
   * account is refused rather than quietly redirected.
   */
  async recordDeposit(clientId: number, dto: RecordDepositDto) {
    const accountId = await this.fineract.getContributionsAccountId(clientId);
    if (accountId == null) {
      throw new BadRequestException(
        `Client ${clientId} has no contributions account. Create one before ` +
          'recording contributions — money paid into their savings account ' +
          'does not count toward the weekly obligation.',
      );
    }

    const transactionId = await this.fineract.depositToSavings({
      savingsAccountId: accountId,
      amount: dto.amount,
      paymentTypeId: dto.paymentTypeId,
      date: dto.date ? new Date(dto.date) : undefined,
      note: dto.note,
    });

    this.logger.log(
      `Recorded a ${dto.amount} contribution for client ${clientId} ` +
        `(Fineract transaction ${transactionId}).`,
    );

    return {
      transactionId,
      clientId,
      amount: dto.amount,
      contributionBalance: await this.fineract.getContributionBalance(clientId),
    };
  }

  /** Reverses a deposit recorded in error — a mistyped amount is inevitable
   * eventually, and it must not be permanent. */
  async undoDeposit(clientId: number, transactionId: number): Promise<void> {
    const accountId = await this.fineract.getContributionsAccountId(clientId);
    if (accountId == null) {
      throw new BadRequestException(
        `Client ${clientId} has no contributions account.`,
      );
    }

    await this.fineract.undoSavingsTransaction({
      savingsAccountId: accountId,
      transactionId,
    });

    this.logger.warn(
      `Reversed Fineract transaction ${transactionId} on client ${clientId}'s ` +
        'contributions account.',
    );
  }

  /** How money may be recorded as arriving — cash, mobile money, transfer. */
  getPaymentTypes() {
    return this.fineract.getPaymentTypes();
  }

  /**
   * Creates the member's contributions account, if they do not already have
   * one. Idempotent: returns the existing account rather than making a second,
   * because two contributions accounts would split a member's balance and
   * quietly halve their borrowing limit.
   */
  async ensureContributionsAccount(
    clientId: number,
  ): Promise<{ accountId: number; created: boolean }> {
    const existing = await this.fineract.getContributionsAccountId(clientId);
    if (existing != null) return { accountId: existing, created: false };

    // A DirectorMultiplier row can outlive — or precede — its Fineract client.
    // Three such orphans were found on 2026-08-29, pointing at clients that
    // had never existed. Creating an account against one fails deep inside
    // Fineract with an unhelpful error, so say plainly what is wrong.
    const client = await this.fineract.getClient(clientId);
    if (client == null) {
      throw new BadRequestException(
        `There is no Fineract client ${clientId}, so no account can be ` +
          'created for it. This member record points at a client that does ' +
          'not exist and should be removed.',
      );
    }

    const productId = this.config.get<number>(
      'fineract.contributionsProductId',
    );
    if (productId == null) {
      throw new BadRequestException(
        'FINERACT_CONTRIBUTIONS_PRODUCT_ID is not configured, so there is no ' +
          'product to create the account against.',
      );
    }

    const accountId = await this.fineract.createSavingsAccount({
      clientId,
      productId,
    });

    return { accountId, created: true };
  }

  /**
   * What is set up and what is missing, per member.
   *
   * Tonight's onboarding pain was accounts that were half-built and looked
   * fine: a login with no authorisation row, an authorisation row pointing at
   * a client that did not exist, a member with savings but no contributions
   * account. Each was invisible until someone tried to use it. This puts all
   * of it on one screen.
   */
  async memberSetup() {
    const directors = await this.prisma.directorMultiplier.findMany({
      select: { clientId: true },
      orderBy: { clientId: 'asc' },
    });

    const users = await this.prisma.user.findMany({
      select: { clientId: true, username: true, role: true },
    });

    return Promise.all(
      directors.map(async (director) => {
        const user = users.find((u) => u.clientId === director.clientId);

        // Read failures are reported as "unknown" rather than "missing" — a
        // Fineract outage must not read as a member who needs setting up, or
        // someone presses "create account" on a member who already has one.
        let contributionsAccountId: number | null | 'unknown' = 'unknown';
        let savingsAccountId: number | null | 'unknown' = 'unknown';
        // Whether the Fineract CLIENT exists at all — a different question
        // from whether they have an account, and one this view got wrong
        // until 2026-08-30: an orphaned member record showed "no
        // contributions account" and offered a Create button that could only
        // ever fail.
        let existsInFineract: boolean | 'unknown' = 'unknown';

        try {
          existsInFineract =
            (await this.fineract.getClient(director.clientId)) != null;
          if (existsInFineract) {
            contributionsAccountId =
              await this.fineract.getContributionsAccountId(director.clientId);
            savingsAccountId = await this.fineract.getSavingsAccountId(
              director.clientId,
            );
          } else {
            contributionsAccountId = null;
            savingsAccountId = null;
          }
        } catch {
          /* leave as unknown */
        }

        return {
          clientId: director.clientId,
          username: user?.username ?? null,
          role: user?.role ?? null,
          hasLogin: user != null,
          existsInFineract,
          contributionsAccountId,
          savingsAccountId,
          ready:
            user != null &&
            existsInFineract === true &&
            typeof contributionsAccountId === 'number',
        };
      }),
    );
  }

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
