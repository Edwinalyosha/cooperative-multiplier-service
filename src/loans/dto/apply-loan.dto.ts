import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ApplyLoanDto {
  @ApiProperty({ example: 500000, description: 'Requested principal in UGX' })
  @IsInt()
  @IsPositive()
  requestedAmount: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
