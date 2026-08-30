import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpeningArrearsWeekDto {
  @ApiProperty({
    example: '2026-07-06',
    description: 'Monday of the week, YYYY-MM-DD, in Africa/Kampala.',
  })
  @IsISO8601()
  periodStart!: string;

  @ApiProperty({ example: '2026-07-12', description: 'Sunday of the week.' })
  @IsISO8601()
  periodEnd!: string;

  /** The amount that applied to THAT week, not today's. The weekly figure
   * changes over time and each week keeps its own. */
  @ApiProperty({ example: 20000 })
  @IsNumber()
  @Min(0)
  amountDue!: number;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Part-payment already made against this week. Defaults to 0.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;
}

export class SeedOpeningArrearsDto {
  @ApiProperty({ type: [OpeningArrearsWeekDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningArrearsWeekDto)
  weeks!: OpeningArrearsWeekDto[];
}
