import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminApiKeyGuard } from './guards/api-key.guard';
import { Public } from './decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public() // this IS the login
  @Post('login')
  @ApiOperation({ summary: 'Obtain API access token (env-based until OAuth)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public() // validates a token; cannot require one
  @Get('validate')
  @ApiOperation({ summary: 'Validate Bearer token' })
  validate(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const valid = this.authService.validateToken(token);
    return { valid };
  }

  @Public() // opts out of JWT; AdminApiKeyGuard below is its auth
  @Post('users')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin-only: create a director/finance-manager login for the loan-approval workflow',
  })
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Public() // opts out of JWT; AdminApiKeyGuard below is its auth
  @Get('users')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin-only: list workflow logins' })
  listUsers() {
    return this.authService.listUsers();
  }
}
