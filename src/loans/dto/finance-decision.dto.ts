import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalDecision } from '@prisma/client';

export class FinanceDecisionDto {
  @ApiProperty({ enum: ApprovalDecision })
  @IsEnum(ApprovalDecision)
  decision: ApprovalDecision;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
