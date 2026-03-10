import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Prevent Jest from loading the real Prisma generated client (uses ESM
// `@prisma/client/runtime/client` which is not available in Jest's CJS env).
jest.mock('../../generated/prisma/client.js', () => ({ PrismaClient: jest.fn() }));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// argon2 is a native binding — jest.spyOn cannot intercept it; mock the module.
jest.mock('argon2', () => ({ verify: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('argon2') as { verify: jest.Mock };

const mockUser = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  role: 'SUPER_ADMIN' as const,
  passwordHash: 'hash',
  isActive: true,
  deletedAt: null,
};

const mockTokens = {
  accessToken: 'access.jwt.token',
  refreshToken: 'refresh.jwt.token',
  refreshJti: 'jti-uuid',
  familyId: 'family-uuid',
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
  },
};

const mockTokenService = {
  issueTokens: jest.fn(),
  validateRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeFamily: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ─── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns tokens and user on valid credentials', async () => {
      argon2.verify.mockResolvedValue(true);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockTokenService.issueTokens.mockResolvedValue(mockTokens);

      const result = await service.login({
        email: mockUser.email,
        password: 'password123',
      });

      expect(result.accessToken).toBe(mockTokens.accessToken);
      expect(result.user.email).toBe(mockUser.email);
      expect(mockTokenService.issueTokens).toHaveBeenCalledWith(mockUser.id, mockUser.role);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      argon2.verify.mockResolvedValue(false);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.com', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      argon2.verify.mockResolvedValue(false);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: mockUser.email, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for inactive user', async () => {
      argon2.verify.mockResolvedValue(true);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login({ email: mockUser.email, password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for soft-deleted user', async () => {
      argon2.verify.mockResolvedValue(true);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      await expect(
        service.login({ email: mockUser.email, password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── refresh ─────────────────────────────────────────────────────────────

  describe('refresh', () => {
    const refreshPayload = {
      sub: mockUser.id,
      jti: 'old-jti',
      familyId: 'fam-uuid',
    };

    it('rotates tokens on valid refresh token', async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue(refreshPayload);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        role: mockUser.role,
        isActive: true,
        deletedAt: null,
      });
      mockTokenService.rotateRefreshToken.mockResolvedValue(mockTokens);

      const result = await service.refresh('valid.refresh.token');

      expect(result.accessToken).toBe(mockTokens.accessToken);
      expect(mockTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        refreshPayload.jti,
        mockUser.id,
        mockUser.role,
        refreshPayload.familyId,
      );
    });

    it('throws UnauthorizedException for invalid refresh token', async () => {
      mockTokenService.validateRefreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      await expect(service.refresh('bad.token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes family and throws when user is deactivated', async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue(refreshPayload);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        role: mockUser.role,
        isActive: false,
        deletedAt: null,
      });

      await expect(service.refresh('valid.refresh.token')).rejects.toThrow(UnauthorizedException);
      expect(mockTokenService.revokeFamily).toHaveBeenCalledWith(refreshPayload.familyId);
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes refresh token on valid logout', async () => {
      const payload = { sub: mockUser.id, jti: 'some-jti', familyId: 'fam-uuid' };
      mockTokenService.validateRefreshToken.mockResolvedValue(payload);

      await service.logout('valid.refresh.token');

      expect(mockTokenService.revokeRefreshToken).toHaveBeenCalledWith(
        payload.jti,
        payload.familyId,
      );
    });

    it('treats invalid token as no-op (does not throw)', async () => {
      mockTokenService.validateRefreshToken.mockRejectedValue(new UnauthorizedException('expired'));

      await expect(service.logout('invalid.token')).resolves.toBeUndefined();
      expect(mockTokenService.revokeRefreshToken).not.toHaveBeenCalled();
    });
  });
});
