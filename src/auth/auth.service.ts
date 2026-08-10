import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates credentials against env-configured service users.
   * This is the legacy admin/reports login (static API key) — left as-is.
   * Per-person login for the loan-approval workflow lives in
   * mobile-auth/mobile-auth.service.ts against the User table instead.
   */
  login(dto: LoginDto): AuthTokenResponse {
    const expectedUser = process.env.API_USERNAME ?? 'admin';
    const expectedPass = process.env.API_PASSWORD ?? 'changeme';

    if (dto.username !== expectedUser || dto.password !== expectedPass) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const secret = process.env.API_KEY ?? 'dev-api-key';
    return {
      accessToken: secret,
      tokenType: 'Bearer',
      expiresIn: 86400,
    };
  }

  validateToken(token: string): boolean {
    const apiKey = process.env.API_KEY ?? 'dev-api-key';
    return token === apiKey;
  }

  /**
   * Admin-only (see auth.controller.ts — guarded by the same ApiKeyGuard as
   * /reports/*). Creates one of the fixed set of director/finance-manager
   * logins for the loan-approval workflow. Not public self-registration.
   */
  async createUser(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException(`Username '${dto.username}' already exists`);
    }

    if (dto.clientId !== undefined && dto.clientId !== null) {
      const existingClientLink = await this.prisma.user.findUnique({
        where: { clientId: dto.clientId },
      });
      if (existingClientLink) {
        throw new ConflictException(
          `clientId ${dto.clientId} is already linked to user '${existingClientLink.username}'`,
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: dto.role,
        clientId: dto.clientId ?? null,
      },
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
      createdAt: user.createdAt,
    };
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      clientId: u.clientId,
      createdAt: u.createdAt,
    }));
  }
}
