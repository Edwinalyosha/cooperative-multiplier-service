import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class EligibilityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  contributionBalance?: number;

  /** Force Fineract fetch and DB cache update */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  refresh?: boolean;
}
