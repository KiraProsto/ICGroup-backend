import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto, AuthTokensResponseDto } from './dto/auth-response.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { Role } from '@generated/prisma/enums.js';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Cookie options shared across set/clear operations. */
function refreshCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;

  constructor(private readonly authService: AuthService) {
    this.isProd = process.env['NODE_ENV'] === 'production';
  }

  // ─── POST /auth/login ────────────────────────────────────────────────────

  @Public()
  @Throttle({ login: {} })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Logged in successfully', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto);

    res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, refreshCookieOptions(this.isProd));

    return {
      accessToken: result.accessToken,
      user: { id: result.user.id, email: result.user.email, role: result.user.role as Role },
    };
  }

  // ─── POST /auth/refresh ───────────────────────────────────────────────────

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiResponse({ status: 200, description: 'Tokens rotated', type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token cookie is missing');
    }

    const tokens = await this.authService.refresh(refreshToken);

    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, refreshCookieOptions(this.isProd));

    return { accessToken: tokens.accessToken };
  }

  // ─── POST /auth/logout ────────────────────────────────────────────────────

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Revoke refresh token and clear session cookie' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    // Clear the cookie regardless of whether the token was valid.
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.isProd,
      path: '/api/v1/auth',
    });
  }

  // ─── GET /auth/me ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user);
  }
}
