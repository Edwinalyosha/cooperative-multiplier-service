import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { AddGuarantorDto } from './dto/add-guarantor.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';

@ApiTags('loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

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
