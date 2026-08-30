import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RecordMovementDto {
  @ApiProperty({
    example: 'INVESTMENT_MADE',
    description: 'One of the keys from GET /treasury/movements.',
  })
  @IsString()
  movement!: string;

  @ApiProperty({ example: 2000000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  /**
   * Required, and not trivially. A ledger entry is permanent and its comment
   * is the only thing that will say what a figure was FOR when someone reads
   * the books a year from now.
   */
  @ApiProperty({ example: 'Stake in Kampala produce venture, agreed 12 Aug' })
  @IsString()
  @MinLength(10, {
    message:
      'Describe what this was for — the ledger entry is permanent and this ' +
      'is the only record of its purpose.',
  })
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({
    example: '2026-08-30',
    description: 'Defaults to today. Use the date the money actually moved.',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;
}

export class ReverseMovementDto {
  @ApiProperty({ example: 'Recorded twice by mistake' })
  @IsString()
  @MinLength(10, {
    message:
      'Give a reason — the reversal is itself a permanent entry in the books.',
  })
  @MaxLength(500)
  reason!: string;
}
