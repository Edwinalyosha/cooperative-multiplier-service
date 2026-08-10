import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'director.jane' })
  @IsString()
  @MinLength(3)
  username: string;

  @ApiProperty({ example: 'a-strong-temporary-password' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({
    required: false,
    description:
      "Fineract clientId this user corresponds to, if they're a director. Omit for a finance manager with no client record of their own.",
  })
  @IsOptional()
  @IsInt()
  clientId?: number;
}
