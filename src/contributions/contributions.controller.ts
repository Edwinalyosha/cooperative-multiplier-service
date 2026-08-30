import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { ContributionsService } from './contributions.service';
import { RecordContributionDto } from './dto/record-contribution.dto';
import { SeedOpeningArrearsDto } from './dto/seed-opening-arrears.dto';
import { ContributionLedgerService } from './contribution-ledger.service';

@ApiTags('contributions')
@Controller('contributions')
export class ContributionsController {
  constructor(
    private readonly contributionsService: ContributionsService,
    private readonly ledger: ContributionLedgerService,
  ) {}

  @Roles(UserRole.FINANCE_MANAGER)
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

  @Roles(UserRole.FINANCE_MANAGER)
  @Post(':clientId/opening-arrears')
  @ApiOperation({
    summary:
      'Record weeks a director already owed before launch. The debt is real ' +
      'and still owed, but carries no multiplier penalty (those weeks were ' +
      'never measured) and earns no catch-up reward when cleared (there was ' +
      'no penalty to compensate). Refuses to overwrite an existing week.',
  })
  seedOpeningArrears(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: SeedOpeningArrearsDto,
  ) {
    return this.ledger.seedOpeningArrears(clientId, dto.weeks);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get(':clientId/arrears')
  @ApiOperation({ summary: 'Every unpaid week for a director, oldest first' })
  arrears(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.ledger.listArrears(clientId);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get(':clientId/summary')
  @ApiOperation({ summary: 'Contribution + multiplier summary from Fineract' })
  summary(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.contributionsService.getContributionSummary(clientId);
  }
}
