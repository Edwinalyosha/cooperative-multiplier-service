import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { AddGuarantorDto } from './dto/add-guarantor.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ApplyLoanDto } from './dto/apply-loan.dto';
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

  @Get('applications/:id')
  @UseGuards(MobileJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a loan application by id' })
  getLoanApplication(@Param('id', ParseIntPipe) id: number) {
    return this.loansService.getLoanApplication(id);
  }

  @Post('repayment/record')
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

  @Get(':loanId/guarantors')
  @ApiOperation({ summary: 'List guarantors for a loan' })
  listGuarantors(@Param('loanId', ParseIntPipe) loanId: number) {
    return this.loansService.listGuarantors(loanId);
  }

  @Post(':loanId/guarantors')
  @ApiOperation({ summary: 'Add a guarantor to a loan' })
  addGuarantor(
    @Param('loanId', ParseIntPipe) loanId: number,
    @Body() dto: AddGuarantorDto,
  ) {
    return this.loansService.addGuarantor(loanId, dto);
  }

  @Delete(':loanId/guarantors/:guarantorId')
  @ApiOperation({ summary: 'Remove a guarantor from a loan' })
  removeGuarantor(
    @Param('loanId', ParseIntPipe) loanId: number,
    @Param('guarantorId', ParseIntPipe) guarantorId: number,
  ) {
    this.loansService.removeGuarantor(loanId, guarantorId);
    return { deleted: true, loanId, guarantorId };
  }
}
