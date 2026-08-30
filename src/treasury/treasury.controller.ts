import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { TreasuryService } from './treasury.service';
import { RecordMovementDto, ReverseMovementDto } from './dto/record-movement.dto';

/**
 * The cooperative's own money — investments, returns, expenses.
 *
 * Finance manager only, throughout. These endpoints post directly to the
 * general ledger, and an entry cannot be deleted once made, only offset.
 */
@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('movements')
  @ApiOperation({
    summary:
      'The kinds of movement that can be recorded, each with the plain ' +
      'meaning of its double entry. The finance director picks one of these ' +
      'rather than choosing accounts.',
  })
  movements() {
    return this.treasury.listMovements();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('entries')
  @ApiOperation({
    summary:
      'Recent postings, newest first, with both sides named. Fineract stores ' +
      'each side as its own row; these are grouped so one investment reads ' +
      'as one event.',
  })
  entries(@Query('limit') limit?: string) {
    return this.treasury.recentEntries(limit ? Number(limit) : undefined);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('balances')
  @ApiOperation({
    summary:
      'Balance per account, signed the way a reader expects — assets and ' +
      'expenses debit-normal, everything else credit-normal.',
  })
  balances() {
    return this.treasury.balances();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('record')
  @ApiOperation({
    summary:
      'Record a movement. Posts a two-sided journal entry; Fineract rejects ' +
      'one whose debits and credits differ, so double entry is enforced by ' +
      'the ledger rather than trusted to this service.',
  })
  record(@Body() dto: RecordMovementDto) {
    return this.treasury.record({
      movementKey: dto.movement,
      amount: dto.amount,
      description: dto.description,
      date: dto.date,
    });
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('entries/:transactionId/reverse')
  @ApiOperation({
    summary:
      'Reverse an entry recorded in error. Posts an OFFSETTING entry — the ' +
      'original stays visible, because an accounting record that could be ' +
      'erased would be worth nothing.',
  })
  reverse(
    @Param('transactionId') transactionId: string,
    @Body() dto: ReverseMovementDto,
  ) {
    return this.treasury.reverse(transactionId, dto.reason);
  }
}
