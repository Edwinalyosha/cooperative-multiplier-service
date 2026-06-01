import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { LoginDto } from '../auth/dto/login.dto';
import { MobileService } from './mobile.service';
import { MobileHistoryQueryDto } from './dto/mobile-history-query.dto';
import { MobileEligibilityQueryDto } from './dto/mobile-eligibility-query.dto';

@ApiTags('mobile')
@Controller('mobile/v1')
@UseGuards(ApiKeyGuard)
export class MobileController {
  constructor(private readonly mobileService: MobileService) {}

  @Public()
  @Post('auth/login')
  @ApiOperation({ summary: 'Mobile login — returns Bearer token' })
  login(@Body() dto: LoginDto) {
    return this.mobileService.login(dto);
  }

  @ApiBearerAuth()
  @Get('dashboard/:clientId')
  @ApiOperation({
    summary: 'Mobile home screen — profile, eligibility, history, tips',
  })
  dashboard(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getDashboard(clientId);
  }

  @ApiBearerAuth()
  @Get('profile/:clientId')
  @ApiOperation({ summary: 'Director multiplier profile' })
  profile(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getProfile(clientId);
  }

  @ApiBearerAuth()
  @Get('eligibility/:clientId')
  @ApiOperation({ summary: 'Loan eligibility for mobile' })
  eligibility(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileEligibilityQueryDto,
  ) {
    return this.mobileService.getEligibility(clientId, query.refresh);
  }

  @ApiBearerAuth()
  @Get('history/:clientId')
  @ApiOperation({ summary: 'Recent multiplier events' })
  history(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: MobileHistoryQueryDto,
  ) {
    return this.mobileService.getHistory(clientId, query.limit);
  }

  @ApiBearerAuth()
  @Get('report/:clientId')
  @ApiOperation({ summary: 'Full client audit report (mobile-friendly)' })
  report(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.mobileService.getClientReport(clientId);
  }
}
