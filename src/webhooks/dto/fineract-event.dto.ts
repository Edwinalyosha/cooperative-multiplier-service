import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class FineractWebhookDto {
  @IsInt()
  @Min(1)
  clientId: number;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
