import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { ContributionsService } from './contributions.service';
import { RecordContributionDto } from './dto/record-contribution.dto';
import { SeedOpeningArrearsDto } from './dto/seed-opening-arrears.dto';
import { RecordDepositDto } from './dto/record-deposit.dto';
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
  @Get('payment-types')
  @ApiOperation({
    summary: 'How a contribution may be recorded as arriving (cash, transfer…)',
  })
  paymentTypes() {
    return this.contributionsService.getPaymentTypes();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('collection-sheet')
  @ApiOperation({
    summary:
      'Every director with what they owe, most in arrears first. Members ' +
      'who are paid up are included with zero, so "owes nothing" is ' +
      'distinguishable from "not listed".',
  })
  collectionSheet() {
    return this.ledger.collectionSheet();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Get('member-setup')
  @ApiOperation({
    summary:
      'What is set up and what is missing, per member: login, contributions ' +
      'account, savings account. A Fineract read failure reports "unknown" ' +
      'rather than "missing", so an outage does not look like a member who ' +
      'needs setting up.',
  })
  memberSetup() {
    return this.contributionsService.memberSetup();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post(':clientId/account')
  @ApiOperation({
    summary:
      "Create the member's contributions account and activate it. Three " +
      'Fineract steps in one call — submit, approve, activate — because an ' +
      'account left approved-but-not-activated looks normal everywhere and ' +
      'silently accepts no money. Idempotent: returns an existing account ' +
      'rather than creating a second, which would split their balance.',
  })
  createContributionsAccount(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.contributionsService.ensureContributionsAccount(clientId);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post(':clientId/deposit')
  @ApiOperation({
    summary:
      "Record a contribution into the director's CONTRIBUTIONS account. " +
      'Creates a real deposit in Fineract. The member sees it immediately ' +
      '(their week reads deposits live); the weekly sweep allocates it at ' +
      'close — current week first, then oldest arrears.',
  })
  recordDeposit(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: RecordDepositDto,
  ) {
    return this.contributionsService.recordDeposit(clientId, dto);
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post(':clientId/deposit/:transactionId/undo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reverse a contribution recorded in error' })
  undoDeposit(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.contributionsService.undoDeposit(clientId, transactionId);
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
