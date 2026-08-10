import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class AppUserDto {
  @ApiProperty() id: number;
  @ApiProperty() username: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ nullable: true, description: "Linked director's Fineract clientId, if any" })
  clientId: number | null;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'UUID refresh token (7 days, stored in Redis)' })
  refreshToken: string;

  @ApiProperty({ description: 'Access token TTL in seconds', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: AppUserDto })
  user: AppUserDto;
}
