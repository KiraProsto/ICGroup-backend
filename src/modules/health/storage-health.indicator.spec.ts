import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { StorageService } from '../storage/storage.service.js';
import { StorageHealthIndicator } from './storage-health.indicator.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUp = jest.fn().mockReturnValue({ storage: { status: 'up' } });
const mockDown = jest.fn().mockReturnValue({ storage: { status: 'down' } });
const mockCheck = jest.fn().mockReturnValue({ up: mockUp, down: mockDown });

const mockStorageService = {
  ping: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('StorageHealthIndicator', () => {
  let indicator: StorageHealthIndicator;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCheck.mockReturnValue({ up: mockUp, down: mockDown });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageHealthIndicator,
        { provide: HealthIndicatorService, useValue: { check: mockCheck } },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    indicator = module.get<StorageHealthIndicator>(StorageHealthIndicator);
  });

  describe('pingCheck', () => {
    it('returns up when the content bucket exists', async () => {
      mockStorageService.ping.mockResolvedValue(true);

      const result = await indicator.pingCheck('storage');

      expect(mockCheck).toHaveBeenCalledWith('storage');
      expect(mockStorageService.ping).toHaveBeenCalledTimes(1);
      expect(mockUp).toHaveBeenCalledTimes(1);
      expect(mockDown).not.toHaveBeenCalled();
      expect(result).toEqual({ storage: { status: 'up' } });
    });

    it('returns down when the content bucket does not exist', async () => {
      mockStorageService.ping.mockResolvedValue(false);

      const result = await indicator.pingCheck('storage');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Content bucket does not exist' });
      expect(mockUp).not.toHaveBeenCalled();
      expect(result).toEqual({ storage: { status: 'down' } });
    });

    it('returns down when ping throws (server unreachable)', async () => {
      mockStorageService.ping.mockRejectedValue(new Error('connection refused'));

      const result = await indicator.pingCheck('storage');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Storage unreachable' });
      expect(mockUp).not.toHaveBeenCalled();
      expect(result).toEqual({ storage: { status: 'down' } });
    });

    it('returns down when ping times out', async () => {
      mockStorageService.ping.mockRejectedValue(new Error('MinIO ping timeout'));

      const result = await indicator.pingCheck('storage');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Storage unreachable' });
      expect(result).toEqual({ storage: { status: 'down' } });
    });

    it('uses the provided key when building the indicator', async () => {
      mockStorageService.ping.mockResolvedValue(true);

      await indicator.pingCheck('minio');

      expect(mockCheck).toHaveBeenCalledWith('minio');
    });
  });
});
