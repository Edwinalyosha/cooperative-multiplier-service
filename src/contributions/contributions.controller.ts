import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ContributionsService } from './contributions.service';
import { RecordContributionDto } from './dto/record-contribution.dto';

@ApiTags('contributions')
@Controller('contributions')
export class ContributionsController {
  constructor(private readonly contributionsService: ContributionsService) {}

  @Post('record')
  @ApiOperation({
    summary: 'Record a contribution event (on-time or late) and update multiplier',
  })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  record(
    @Body() dto: RecordContributionDto,
    @Query('async') async?: boolean,
  ) {
    return this.contributionsService.recordContribution(dto, async);
  }

  @Get(':clientId/summary')
  @ApiOperation({ summary: 'Contribution + multiplier summary from Fineract' })
  summary(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.contributionsService.getContributionSummary(clientId);
  }
}
