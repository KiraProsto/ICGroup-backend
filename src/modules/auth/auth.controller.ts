import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import {
  AuthTokensResponseDto,
  CurrentUserProfileDto,
  LoginResponseDto,
} from './dto/auth-response.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator.js';
import { Role } from '../../generated/prisma/enums.js';
import { ConfigService } from '@nestjs/config';
import { ApiErrorResponseDto, ApiResponseDto } from '../../common/dto/api-response.dto.js';

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

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.isProd = this.configService.get<string>('app.nodeEnv') === 'production';
  }

  // ─── POST /auth/login ────────────────────────────────────────────────────

  @Public()
  @Throttle({ login: {} })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Logged in successfully',
    type: ApiResponseDto(LoginResponseDto),
  })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto, description: 'Too many login attempts' })
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
  @Throttle({ login: {} })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiResponse({
    status: 200,
    description: 'Tokens rotated',
    type: ApiResponseDto(AuthTokensResponseDto),
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
    type: ApiErrorResponseDto,
  })
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
  @SkipThrottle({ login: true })
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

  // No @Public() — protected by the global JwtAuthGuard (APP_GUARD).
  // Do NOT add @UseGuards(JwtAuthGuard) here: the guard is already global and
  // adding it again would cause a double DB query per request.
  @SkipThrottle({ login: true })
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({
    status: 200,
    description: 'Current user profile',
    type: ApiResponseDto(CurrentUserProfileDto),
  })
  @ApiResponse({ status: 401, description: 'Not authenticated', type: ApiErrorResponseDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserProfileDto> {
    return this.authService.getProfile(user);
  }
}
