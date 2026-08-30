import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Forgiving a penalty requires a reason, and a short one will not do.
 *
 * The reason is the whole audit trail: it appears in the member's history and
 * is what answers "why was this member treated differently" a year later. A
 * waiver with no explanation is indistinguishable from a mistake.
 */
export class WaivePenaltyDto {
  @ApiProperty({
    example: 'Hospitalised for the week; agreed at the 3 Sept directors meeting',
  })
  @IsString()
  @MinLength(10, {
    message:
      'Give a real reason for the waiver — it is shown to the member and is ' +
      'the only record of why they were treated differently.',
  })
  @MaxLength(500)
  reason!: string;
}
