import { ApiProperty } from '@nestjs/swagger';

export class FineractUserDto {
  @ApiProperty() id: number;
  @ApiProperty() username: string;
  @ApiProperty() displayName: string;
  @ApiProperty() officeId: number;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'UUID refresh token (7 days, stored in Redis)' })
  refreshToken: string;

  @ApiProperty({ description: 'Access token TTL in seconds', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: FineractUserDto })
  user: FineractUserDto;
}
