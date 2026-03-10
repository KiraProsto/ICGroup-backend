import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

/**
 * AuthModule wires together login/refresh/logout endpoints, the Passport JWT
 * strategy, and the global JwtAuthGuard.
 *
 * The guard is registered as an APP_GUARD provider here (not in AppModule) so
 * that it has access to JwtAuthGuard's dependency on Reflector, which needs
 * to be scoped within a module that has Reflector available.
 *
 * JwtModule is registered without a default secret because each sign/verify
 * call supplies its own secret (access vs. refresh have different secrets).
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // No default secret — TokenService and JwtStrategy each supply the correct
    // secret per operation (access vs. refresh).
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    // ThrottlerGuard is listed first so rate-limiting runs before the JWT guard
    // on every request — blocking flooding before any auth/DB work begins.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Apply JwtAuthGuard globally — all routes require a valid access token
    // unless decorated with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}
