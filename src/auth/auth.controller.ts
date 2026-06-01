import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Obtain API access token (env-based until OAuth)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('validate')
  @ApiOperation({ summary: 'Validate Bearer token' })
  validate(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const valid = this.authService.validateToken(token);
    return { valid };
  }
}
