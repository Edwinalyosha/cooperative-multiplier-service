import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MultiplierService } from '../multiplier/multiplier.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { ReportRangeDto } from './dto/report-range.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly multiplierService: MultiplierService,
  ) {}

  private buildDateRange(range?: ReportRangeDto): Prisma.DateTimeFilter | undefined {
    if (!range?.from && !range?.to) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (range.from) filter.gte = new Date(range.from);
    if (range.to) filter.lte = new Date(range.to);
    return filter;
  }

  async getDashboard(range?: ReportRangeDto) {
    const createdAt = this.buildDateRange(range);
    const historyWhere: Prisma.MultiplierHistoryWhereInput = createdAt
      ? { createdAt }
      : {};

    const [
      totalDirectors,
      eligibleCount,
      historyInRange,
      upgrades,
      downgrades,
      neutrals,
      directors,
    ] = await Promise.all([
      this.prisma.directorMultiplier.count(),
      this.prisma.directorMultiplier.count({ where: { isEligible: true } }),
      this.prisma.multiplierHistory.count({ where: historyWhere }),
      this.prisma.multiplierHistory.count({
        where: { ...historyWhere, direction: 'UPGRADE' },
      }),
      this.prisma.multiplierHistory.count({
        where: { ...historyWhere, direction: 'DOWNGRADE' },
      }),
      this.prisma.multiplierHistory.count({
        where: { ...historyWhere, direction: 'NEUTRAL' },
      }),
      this.prisma.directorMultiplier.findMany({
        select: {
          currentMultiplier: true,
          maxLoanAmount: true,
        },
      }),
    ]);

    const multipliers = directors.map((d) => Number(d.currentMultiplier));
    const avgMultiplier =
      multipliers.length > 0
        ? Number(
            (
              multipliers.reduce((a, b) => a + b, 0) / multipliers.length
            ).toFixed(3),
          )
        : 0;

    const totalMaxLoan = directors.reduce(
      (sum, d) => sum + (d.maxLoanAmount ? Number(d.maxLoanAmount) : 0),
      0,
    );

    return {
      generatedAt: new Date().toISOString(),
      period: range ?? null,
      directors: {
        total: totalDirectors,
        eligible: eligibleCount,
        ineligible: totalDirectors - eligibleCount,
        avgMultiplier,
        totalMaxLoanExposure: totalMaxLoan,
      },
      events: {
        total: historyInRange,
        upgrades,
        downgrades,
        neutrals,
      },
    };
  }

  async getAuditTrail(query: AuditQueryDto) {
    const where: Prisma.MultiplierHistoryWhereInput = {};

    if (query.clientId) where.clientId = query.clientId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.direction) where.direction = query.direction;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [total, items] = await Promise.all([
      this.prisma.multiplierHistory.count({ where }),
      this.prisma.multiplierHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 100,
        skip: query.offset ?? 0,
      }),
    ]);

    return {
      total,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
      items: items.map((entry) => ({
        id: entry.id,
        clientId: entry.clientId,
        eventType: entry.eventType,
        oldMultiplier: entry.oldMultiplier
          ? Number(entry.oldMultiplier)
          : null,
        newMultiplier: entry.newMultiplier
          ? Number(entry.newMultiplier)
          : null,
        stepAmount: entry.stepAmount ? Number(entry.stepAmount) : null,
        direction: entry.direction,
        triggeredBy: entry.triggeredBy,
        notes: entry.notes,
        createdAt: entry.createdAt,
      })),
    };
  }

  async listClients() {
    const directors = await this.prisma.directorMultiplier.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return directors.map((d) => ({
      clientId: d.clientId,
      multiplier: Number(d.currentMultiplier),
      loanMultiple: Number(d.loanMultiple),
      contributionBalance: d.contributionBalance
        ? Number(d.contributionBalance)
        : null,
      maxLoanAmount: d.maxLoanAmount ? Number(d.maxLoanAmount) : null,
      isEligible: d.isEligible ?? false,
      consecutiveOnTimeContributions: d.consecutiveOnTimeContributions ?? 0,
      consecutiveOnTimeRepayments: d.consecutiveOnTimeRepayments ?? 0,
      lastContributionStatus: d.lastContributionStatus,
      lastRepaymentStatus: d.lastRepaymentStatus,
      eligibilityCheckedAt: d.eligibilityCheckedAt,
      updatedAt: d.updatedAt,
    }));
  }

  async getClientReport(clientId: number) {
    const director = await this.prisma.directorMultiplier.findUnique({
      where: { clientId },
    });

    if (!director) {
      throw new NotFoundException(`No director profile for client ${clientId}`);
    }

    const [profile, history, eventBreakdown] = await Promise.all([
      this.multiplierService.getProfile(clientId),
      this.multiplierService.getHistory(clientId, 20),
      this.prisma.multiplierHistory.groupBy({
        by: ['eventType'],
        where: { clientId },
        _count: { eventType: true },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      profile,
      recentHistory: history,
      eventBreakdown: eventBreakdown.map((row) => ({
        eventType: row.eventType,
        count: row._count.eventType,
      })),
    };
  }

  async getEligibilityReport() {
    const eligible = await this.prisma.directorMultiplier.findMany({
      where: { isEligible: true },
      orderBy: { maxLoanAmount: 'desc' },
    });

    const ineligible = await this.prisma.directorMultiplier.count({
      where: { OR: [{ isEligible: false }, { isEligible: null }] },
    });

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        eligible: eligible.length,
        ineligible,
      },
      clients: eligible.map((d) => ({
        clientId: d.clientId,
        multiplier: Number(d.currentMultiplier),
        loanMultiple: Number(d.loanMultiple),
        contributionBalance: d.contributionBalance
          ? Number(d.contributionBalance)
          : null,
        maxLoanAmount: d.maxLoanAmount ? Number(d.maxLoanAmount) : null,
        eligibilityCheckedAt: d.eligibilityCheckedAt,
      })),
    };
  }

  async getEventSummary(range?: ReportRangeDto) {
    const createdAt = this.buildDateRange(range);
    const where: Prisma.MultiplierHistoryWhereInput = createdAt
      ? { createdAt }
      : {};

    const [byEvent, byDirection, byTrigger] = await Promise.all([
      this.prisma.multiplierHistory.groupBy({
        by: ['eventType'],
        where,
        _count: { eventType: true },
        orderBy: { _count: { eventType: 'desc' } },
      }),
      this.prisma.multiplierHistory.groupBy({
        by: ['direction'],
        where,
        _count: { direction: true },
      }),
      this.prisma.multiplierHistory.groupBy({
        by: ['triggeredBy'],
        where,
        _count: { triggeredBy: true },
        orderBy: { _count: { triggeredBy: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      period: range ?? null,
      byEventType: byEvent.map((r) => ({
        eventType: r.eventType,
        count: r._count.eventType,
      })),
      byDirection: byDirection.map((r) => ({
        direction: r.direction ?? 'UNKNOWN',
        count: r._count.direction,
      })),
      topTriggeredBy: byTrigger.map((r) => ({
        triggeredBy: r.triggeredBy ?? 'unknown',
        count: r._count.triggeredBy,
      })),
    };
  }
}
