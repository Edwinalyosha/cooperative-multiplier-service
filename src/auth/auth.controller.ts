import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiKeyGuard } from './guards/api-key.guard';

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

  @Post('users')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin-only: create a director/finance-manager login for the loan-approval workflow',
  })
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Get('users')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin-only: list workflow logins' })
  listUsers() {
    return this.authService.listUsers();
  }
}
