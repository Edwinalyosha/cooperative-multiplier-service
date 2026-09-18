import { IsInt, IsNumber, IsOptional, IsISO8601, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Money a member has handed over against a loan.
 *
 * Distinct from RecordRepaymentDto, which records a multiplier EVENT and
 * moves nothing. This one moves money, and timeliness is not stated here:
 * the sweep reads it from Fineract's schedule. An `onTime` flag supplied by
 * whoever takes the cash is exactly the unverified input that left half the
 * incentive system inert (MLTD-P009).
 */
export class RecordLoanRepaymentDto {
  @ApiProperty({ example: 56488.15 })
  @IsNumber()
  @Min(1)
  amount!: number;

  /** How the money arrived. Mandatory in Fineract, so mandatory here —
   * discovering that at the API boundary rather than in a 400 is the point of
   * fetching the payment types into the form. */
  @ApiProperty({ example: 1, description: 'From GET /contributions/payment-types' })
  @IsInt()
  @Min(1)
  paymentTypeId!: number;

  /** Defaults to today. Fineract rejects a date before disbursement, and the
   * operator is UTC-4 while Fineract validates in UTC — so an explicit date
   * is sometimes the only way through (MLTD-P011). */
  @ApiPropertyOptional({ example: '2026-09-17' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ example: 'Cash collected at the Thursday meeting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
