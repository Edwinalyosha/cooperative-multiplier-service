import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class MobileJwtGuard extends AuthGuard('mobile-jwt') {}
