import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LoansService } from './loans.service';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { DirectorDecisionDto } from './dto/director-decision.dto';
import { FinanceDecisionDto } from './dto/finance-decision.dto';
import { MobileJwtGuard } from '../mobile-auth/guards/mobile-jwt.guard';
import { RolesGuard } from '../mobile-auth/guards/roles.guard';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { MobileJwtPayload } from '../mobile-auth/strategies/mobile-jwt.strategy';

@ApiTags('loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post('apply')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.DIRECTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Director applies for a loan. clientId comes from the authenticated token, not the request body.',
  })
  applyForLoan(
    @Body() dto: ApplyLoanDto,
    @Req() req: { user: MobileJwtPayload },
  ) {
    if (!req.user.clientId) {
      throw new BadRequestException(
        'This account has no linked clientId — cannot apply for a loan.',
      );
    }
    return this.loansService.applyForLoan(req.user.clientId, dto);
  }

  @Get('applications/mine')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.DIRECTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated director's own loan applications" })
  listMyApplications(@Req() req: { user: MobileJwtPayload }) {
    if (!req.user.clientId) {
      throw new BadRequestException('This account has no linked clientId.');
    }
    return this.loansService.listLoanApplicationsForClient(req.user.clientId);
  }

  @Get('applications/pending-my-decision')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.DIRECTOR, UserRole.FINANCE_MANAGER)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Applications currently awaiting the caller\'s decision. Directors see PENDING_DIRECTOR_APPROVAL applications they have not yet voted on (excluding their own). Finance managers see all PENDING_FINANCE_APPROVAL applications. Ordered oldest-first.',
  })
  listPendingMyDecision(@Req() req: { user: MobileJwtPayload }) {
    return this.loansService.listPendingMyDecision(
      req.user.role,
      req.user.clientId,
    );
  }

  @Get('applications/:id')
  @UseGuards(MobileJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a loan application by id' })
  getLoanApplication(@Param('id', ParseIntPipe) id: number) {
    return this.loansService.getLoanApplication(id);
  }

  @Post('applications/:id/director-decision')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.DIRECTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Director approves or rejects a pending loan application. Voting director's clientId comes from the token, not the body. Applicant cannot vote on their own request; rejections are logged but never block or count toward the 2-approval quorum; the first approval registers that director as the loan's guarantor in Fineract (no fund hold).",
  })
  directorDecision(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DirectorDecisionDto,
    @Req() req: { user: MobileJwtPayload },
  ) {
    if (!req.user.clientId) {
      throw new BadRequestException('This account has no linked clientId.');
    }
    return this.loansService.directorDecision(id, req.user.clientId, dto);
  }

  @Post('applications/:id/finance-decision')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.FINANCE_MANAGER)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Finance manager's final decision on an application that has already cleared the director quorum. Approve triggers real Fineract approve + disburse (money moves); reject triggers Fineract's native reject. Unilateral — only reachable once status is PENDING_FINANCE_APPROVAL.",
  })
  financeDecision(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinanceDecisionDto,
    @Req() req: { user: MobileJwtPayload },
  ) {
    return this.loansService.financeDecision(id, req.user.sub, dto);
  }

  @Post('applications/:id/withdraw')
  @UseGuards(MobileJwtGuard, RolesGuard)
  @Roles(UserRole.DIRECTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Borrower withdraws their own pending application. Only the applicant (clientId from the token) can do this, and only while still PENDING_DIRECTOR_APPROVAL or PENDING_FINANCE_APPROVAL.",
  })
  withdrawApplication(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: MobileJwtPayload },
  ) {
    if (!req.user.clientId) {
      throw new BadRequestException('This account has no linked clientId.');
    }
    return this.loansService.withdrawApplication(id, req.user.clientId);
  }

  @Post('repayment/record')
  @Roles(UserRole.FINANCE_MANAGER)
  @ApiOperation({
    summary: 'Record repayment event (on-time, late, or early payoff)',
  })
  @ApiQuery({ name: 'async', required: false, type: Boolean })
  recordRepayment(
    @Body() dto: RecordRepaymentDto,
    @Query('async') async?: boolean,
  ) {
    return this.loansService.recordRepayment(dto, async);
  }

  @Get('repayment-summary/:clientId')
  @ApiOperation({ summary: 'Repayment streak + active Fineract loans' })
  repaymentSummary(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.loansService.getRepaymentSummary(clientId);
  }

}
