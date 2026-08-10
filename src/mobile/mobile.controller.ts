import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MobileJwtGuard } from '../mobile-auth/guards/mobile-jwt.guard';
import { MobileService } from './mobile.service';
import { MobileHistoryQueryDto } from './dto/mobile-history-query.dto';
import { MobileEligibilityQueryDto } from './dto/mobile-eligibility-query.dto';

@ApiTags('mobile')
@Controller('mobile/v1')
@UseGuards(MobileJwtGuard)
@ApiBearerAuth()
export class MobileController {
  constructor(private readonly mobileService: MobileService) {}

  @Get('dashboard/:clientId')
  @ApiOperation({
    summary: 'Mobile home screen — profile, eligibility, history, tips',
  })
  dashboard(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getDashboard(clientId);
  }

  @Get('profile/:clientId')
  @ApiOperation({ summary: 'Director multiplier profile' })
  profile(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getProfile(clientId);
  }

  @Get('eligibility/:clientId')
  @ApiOperation({ summary: 'Loan eligibility for mobile' })
  eligibility(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileEligibilityQueryDto,
  ) {
    return this.mobileService.getEligibility(clientId, query.refresh);
  }

  @Get('history/:clientId')
  @ApiOperation({ summary: 'Recent multiplier events' })
  history(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileHistoryQueryDto,
  ) {
    return this.mobileService.getHistory(clientId, query.limit);
  }

  @Get('report/:clientId')
  @ApiOperation({ summary: 'Full client audit report (mobile-friendly)' })
  report(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getClientReport(clientId);
  }
}

