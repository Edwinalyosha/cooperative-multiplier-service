import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class MobileEligibilityQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  refresh?: boolean;
}
