import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ReportsService } from './reports.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { ReportRangeDto } from './dto/report-range.dto';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'System-wide dashboard metrics' })
  dashboard(@Query() range: ReportRangeDto) {
    return this.reportsService.getDashboard(range);
  }

  @Get('audit')
  @ApiOperation({ summary: 'Paginated audit trail with filters' })
  audit(@Query() query: AuditQueryDto) {
    return this.reportsService.getAuditTrail(query);
  }

  @Get('clients')
  @ApiOperation({ summary: 'All director profiles summary' })
  clients() {
    return this.reportsService.listClients();
  }

  @Get('clients/:clientId')
  @ApiOperation({ summary: 'Detailed report for one client' })
  clientReport(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.reportsService.getClientReport(clientId);
  }

  @Get('eligibility')
  @ApiOperation({ summary: 'Eligible clients ranked by max loan' })
  eligibility() {
    return this.reportsService.getEligibilityReport();
  }

  @Get('events/summary')
  @ApiOperation({ summary: 'Event breakdown by type, direction, and source' })
  eventSummary(@Query() range: ReportRangeDto) {
    return this.reportsService.getEventSummary(range);
  }
}
