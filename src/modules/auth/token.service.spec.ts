import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';

// ─── Redis mock ──────────────────────────────────────────────────────────────

const mockPipeline = {
  del: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  sadd: jest.fn().mockReturnThis(),
  srem: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  pipeline: jest.fn().mockReturnValue(mockPipeline),
  get: jest.fn(),
  getdel: jest.fn(),
  smembers: jest.fn(),
  del: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verifyAsync: jest.fn(),
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      'auth.accessSecret': 'test-access-secret-minimum-32-chars!!!',
      'auth.refreshSecret': 'test-refresh-secret-minimum-32-chars!!',
    };
    return cfg[key] ?? null;
  }),
  get: jest.fn((key: string, def: string) => {
    const cfg: Record<string, string> = {
      'auth.accessExpiresIn': '15m',
      'auth.refreshExpiresIn': '7d',
    };
    return cfg[key] ?? def;
  }),
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jest.clearAllMocks();
    mockRedis.pipeline.mockReturnValue(mockPipeline);
    mockPipeline.exec.mockResolvedValue([]);
  });

  // ─── issueTokens ─────────────────────────────────────────────────────────

  describe('issueTokens', () => {
    it('stores allowlist entry and returns token pair', async () => {
      mockJwtService.sign.mockReturnValue('signed.token');

      const result = await service.issueTokens('user-1', 'SUPER_ADMIN');

      expect(result.accessToken).toBe('signed.token');
      expect(result.refreshToken).toBe('signed.token');
      expect(result.refreshJti).toBeDefined();
      expect(result.familyId).toBeDefined();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringMatching(/^rt:/),
        expect.stringContaining('user-1'),
        'EX',
        604800,
      );
      expect(mockPipeline.sadd).toHaveBeenCalledWith(
        expect.stringMatching(/^rt-family-active:/),
        expect.any(String),
      );
    });
  });

  // ─── validateRefreshToken ─────────────────────────────────────────────────

  describe('validateRefreshToken', () => {
    const payload = {
      sub: 'user-1',
      jti: 'jti-abc',
      familyId: 'fam-abc',
    };

    it('returns decoded payload for a valid JWT', async () => {
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      const result = await service.validateRefreshToken('valid.token');

      expect(result.sub).toBe('user-1');
      expect(result.jti).toBe('jti-abc');
      // No Redis calls — only JWT verification
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.getdel).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for expired JWT', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.validateRefreshToken('expired.token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── rotateRefreshToken ───────────────────────────────────────────────────

  describe('rotateRefreshToken', () => {
    it('atomically consumes old token via GETDEL and issues new pair', async () => {
      mockJwtService.sign.mockReturnValue('new.signed.token');
      mockRedis.getdel.mockResolvedValue('user-1:fam-1');

      const result = await service.rotateRefreshToken('old-jti', 'user-1', 'SUPER_ADMIN', 'fam-1');

      expect(mockRedis.getdel).toHaveBeenCalledWith('rt:old-jti');
      expect(result.accessToken).toBe('new.signed.token');
      expect(result.refreshJti).not.toBe('old-jti');
      expect(mockPipeline.set).toHaveBeenCalledWith('rt-family:fam-1:old-jti', '1', 'EX', 604800);
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringMatching(/^rt:/),
        'user-1:fam-1',
        'EX',
        604800,
      );
    });

    it('throws when GETDEL returns null and no consumed marker (race lost / expired)', async () => {
      mockRedis.getdel.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(null); // no consumed marker

      await expect(
        service.rotateRefreshToken('old-jti', 'user-1', 'SUPER_ADMIN', 'fam-1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRedis.smembers).not.toHaveBeenCalled();
    });

    it('revokes family and throws when GETDEL returns null and consumed marker exists (reuse)', async () => {
      mockRedis.getdel.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('1'); // consumed marker present
      mockRedis.smembers.mockResolvedValue(['other-jti']);

      await expect(
        service.rotateRefreshToken('old-jti', 'user-1', 'SUPER_ADMIN', 'fam-1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRedis.smembers).toHaveBeenCalledWith('rt-family-active:fam-1');
    });

    it('throws when allowlist entry userId does not match token sub', async () => {
      mockRedis.getdel.mockResolvedValue('different-user:fam-1');

      await expect(
        service.rotateRefreshToken('old-jti', 'user-1', 'SUPER_ADMIN', 'fam-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── revokeRefreshToken ───────────────────────────────────────────────────

  describe('revokeRefreshToken', () => {
    it('deletes allowlist entry and removes from family set', async () => {
      await service.revokeRefreshToken('some-jti', 'fam-1');

      expect(mockPipeline.del).toHaveBeenCalledWith('rt:some-jti');
      expect(mockPipeline.srem).toHaveBeenCalledWith('rt-family-active:fam-1', 'some-jti');
    });
  });

  // ─── revokeFamily ─────────────────────────────────────────────────────────

  describe('revokeFamily', () => {
    it('deletes all active jtis in the family', async () => {
      mockRedis.smembers.mockResolvedValue(['jti-1', 'jti-2']);

      await service.revokeFamily('fam-to-revoke');

      expect(mockPipeline.del).toHaveBeenCalledWith('rt:jti-1');
      expect(mockPipeline.del).toHaveBeenCalledWith('rt:jti-2');
      expect(mockPipeline.del).toHaveBeenCalledWith('rt-family-active:fam-to-revoke');
    });

    it('handles empty family gracefully', async () => {
      mockRedis.smembers.mockResolvedValue([]);
      mockRedis.del.mockResolvedValue(0);

      await expect(service.revokeFamily('empty-family')).resolves.toBeUndefined();
    });
  });
});
