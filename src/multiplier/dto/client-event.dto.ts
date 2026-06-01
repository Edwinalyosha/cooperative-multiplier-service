import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Body for typed event routes (event type comes from the URL). */
export class ClientEventDto {
  @IsInt()
  @Min(1)
  clientId: number;

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
