import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordContributionDto {
  @IsInt()
  @Min(1)
  clientId: number;

  @IsBoolean()
  onTime: boolean;

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
