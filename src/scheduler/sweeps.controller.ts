import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../mobile-auth/decorators/roles.decorator';
import { ContributionSweepService } from '../contributions/contribution-sweep.service';
import { RepaymentAssessmentService } from '../loans/repayment-assessment.service';
import { SavingsHoldReleaseScheduler } from './savings-hold-release.scheduler';

/**
 * Running the scheduled sweeps on demand.
 *
 * Every sweep here is idempotent by construction — each obligation is
 * assessed exactly once, enforced by a unique constraint or a stamped field
 * rather than by the schedule firing once. That is what makes exposing them
 * safe, and it is not incidental: the guarantee was designed for restarts and
 * re-runs, and a manual trigger is just another re-run.
 *
 * Two reasons this exists:
 *
 *  - OPERATIONS. If Fineract was unreachable on Sunday night, the
 *    contribution sweep records everyone as `failed` and nobody is assessed.
 *    Without this the only options are waiting a week or editing rows by hand.
 *  - TESTING. The contribution sweep fires weekly and the repayment sweep
 *    needs an installment that is actually due, so neither can be exercised
 *    before real members depend on them.
 *
 * Finance manager only. These move real multipliers.
 */
@ApiTags('sweeps')
@ApiBearerAuth()
@Controller('sweeps')
export class SweepsController {
  constructor(
    private readonly contributions: ContributionSweepService,
    private readonly repayments: RepaymentAssessmentService,
    private readonly holds: SavingsHoldReleaseScheduler,
  ) {}

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('contributions')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Assess the most recently COMPLETED contribution week. Always looks ' +
      'backwards, so it never judges a week members still have time left in. ' +
      'Safe to repeat: a week already assessed is reported as skipped, not ' +
      'penalised again.',
  })
  runContributionSweep() {
    return this.contributions.sweep();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('repayments')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Assess every loan installment that has fallen due. Safe to repeat: ' +
      'each installment is assessed once, enforced by a unique constraint.',
  })
  runRepaymentSweep() {
    return this.repayments.sweep();
  }

  @Roles(UserRole.FINANCE_MANAGER)
  @Post('savings-holds')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Release collateral holds whose loans are settled. Errs towards keeping ' +
      'money frozen: a hold is released only on positive evidence the loan is ' +
      'no longer outstanding.',
  })
  async runHoldRelease() {
    await this.holds.handleReleaseSweep();
    return { ok: true };
  }
}
