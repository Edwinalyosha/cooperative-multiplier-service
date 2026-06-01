import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddGuarantorDto {
  @IsInt()
  @Min(1)
  guarantorClientId: number;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
