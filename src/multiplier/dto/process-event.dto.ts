import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MultiplierEventType } from '../multiplier-event.enum';

export class ProcessEventDto {
  @IsInt()
  @Min(1)
  clientId: number;

  @IsEnum(MultiplierEventType)
  eventType: MultiplierEventType;

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
