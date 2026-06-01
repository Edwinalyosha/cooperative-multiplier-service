import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordRepaymentDto {
  @IsInt()
  @Min(1)
  clientId: number;

  @IsBoolean()
  onTime: boolean;

  @IsOptional()
  @IsBoolean()
  earlyPayoff?: boolean;

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
