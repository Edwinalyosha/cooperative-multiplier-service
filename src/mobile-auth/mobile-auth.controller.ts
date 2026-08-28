import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MobileAuthService } from './mobile-auth.service';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { MobileJwtGuard } from './guards/mobile-jwt.guard';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('mobile-auth')
@Controller('mobile/v1/auth')
export class MobileAuthController {
  constructor(private readonly mobileAuthService: MobileAuthService) {}

  @Public() // this IS the login
  @Post('login')
  @ApiOperation({ summary: 'Mobile login — authenticate with Fineract credentials' })
  login(@Body() dto: MobileLoginDto): Promise<TokenResponseDto> {
    return this.mobileAuthService.loginMobile(dto);
  }

  @Public() // authorised by the refresh token in the body
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using a valid refresh token' })
  refresh(@Body('refreshToken') refreshToken: string): Promise<TokenResponseDto> {
    return this.mobileAuthService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(MobileJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@Body('refreshToken') refreshToken: string): Promise<void> {
    return this.mobileAuthService.logout(refreshToken);
  }
}
