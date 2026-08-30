import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A contribution handed over by a director and recorded by the finance
 * manager. Creates a real deposit in Fineract on the member's CONTRIBUTIONS
 * account.
 */
export class RecordDepositDto {
  @ApiProperty({ example: 20000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  /**
   * Mandatory in Fineract — a deposit with no payment type is refused. It is
   * also what makes the record auditable later: "how did this money arrive"
   * is a real question at reconciliation.
   */
  @ApiProperty({ example: 1, description: 'From GET /contributions/payment-types' })
  @IsInt()
  paymentTypeId!: number;

  @ApiPropertyOptional({
    example: '2026-08-30',
    description: 'Defaults to today. Use the date the money was received.',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ example: 'Week of 24 Aug, paid in cash' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
