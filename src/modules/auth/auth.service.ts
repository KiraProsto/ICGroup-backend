import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { AuthenticatedUser } from './decorators/current-user.decorator.js';
import type { Role } from '../../generated/prisma/enums.js';

export interface LoginResult extends IssuedTokens {
  user: { id: string; email: string; role: Role };
}

/**
 * AuthService orchestrates login, token refresh, and logout flows.
 *
 * Responsibility split:
 *  - AuthService  → business logic (user lookup, password check, DB access)
 *  - TokenService → JWT signing, Redis allowlist & family rotation
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  // ─── Login ───────────────────────────────────────────────────────────────

  /**
   * Validates credentials and issues a new token pair.
   * Security: uses a constant-time comparison (Argon2 verify) to prevent
   * timing attacks; returns the same error regardless of failure reason
   * to avoid user-enumeration.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        role: true,
        passwordHash: true,
        isActive: true,
        deletedAt: true,
      },
    });

    // Use constant-time path: always verify hash, even for missing users,
    // to prevent timing-based user enumeration.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvaluedummyhashvaluedummy';
    const hashToVerify = user?.passwordHash ?? dummyHash;

    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hashToVerify, dto.password);
    } catch {
      // Argon2 throws on malformed hash — treat as invalid.
      passwordValid = false;
    }

    if (!user || !passwordValid || !user.isActive || user.deletedAt !== null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.tokenService.issueTokens(user.id, user.role);

    this.logger.log(`User logged in: id=${user.id}, role=${user.role}`);

    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────

  /**
   * Validates the refresh token, performs family rotation, and issues a new
   * token pair. The old refresh token is atomically consumed.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const payload = await this.tokenService.validateRefreshToken(refreshToken);

    // Load current user to embed up-to-date role in the new access token.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt !== null) {
      // User was deactivated since the token was issued — revoke their family.
      await this.tokenService.revokeFamily(payload.familyId);
      throw new UnauthorizedException('User account is inactive or deleted');
    }

    return this.tokenService.rotateRefreshToken(payload.jti, user.id, user.role, payload.familyId);
  }

  // ─── Logout ──────────────────────────────────────────────────────────────

  /**
   * Revokes the refresh token that was stored in the HttpOnly cookie.
   * The access token will naturally expire (15 min) — we do not maintain
   * an access-token blocklist.
   */
  async logout(refreshToken: string): Promise<void> {
    let payload;
    try {
      payload = await this.tokenService.validateRefreshToken(refreshToken);
    } catch {
      // If the token is already invalid/expired, logout is a no-op.
      // We log but do not surface the error to avoid leaking information.
      this.logger.debug('Logout called with invalid/expired refresh token — treating as no-op');
      return;
    }

    await this.tokenService.revokeRefreshToken(payload.jti, payload.familyId);
    this.logger.log(`User logged out: id=${payload.sub}`);
  }

  // ─── Helpers (for other modules, e.g., AuditModule) ─────────────────────

  /**
   * Returns basic profile data for the authenticated user.
   * Used by the controller to return user info without extra DB call.
   */
  async getProfile(user: AuthenticatedUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    if (!record) {
      throw new NotFoundException('User not found');
    }

    return record;
  }
}
