import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as Minio from 'minio';
import { StorageService } from './storage.service.js';

// ── MinIO Client mock ─────────────────────────────────────────────────────────

const mockPutObject = jest.fn().mockResolvedValue({ etag: 'mock-etag' });
const mockRemoveObject = jest.fn().mockResolvedValue(undefined);
const mockBucketExists = jest.fn().mockResolvedValue(true);
const mockMakeBucket = jest.fn().mockResolvedValue(undefined);
const mockSetBucketPolicy = jest.fn().mockResolvedValue(undefined);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    removeObject: mockRemoveObject,
    bucketExists: mockBucketExists,
    makeBucket: mockMakeBucket,
    setBucketPolicy: mockSetBucketPolicy,
  })),
}));

// ── Test config ───────────────────────────────────────────────────────────────

const TEST_CONFIG: Record<string, unknown> = {
  'storage.endpoint': 'localhost',
  'storage.port': 9000,
  'storage.useSsl': false,
  'storage.accessKey': 'minioadmin',
  'storage.secretKey': 'changeme',
  'storage.bucketContent': 'content-images',
  'storage.publicUrl': 'http://localhost:9000',
};

function buildMockConfigService(): Partial<ConfigService> {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (!(key in TEST_CONFIG)) throw new Error(`Config key not found: ${key}`);
      return TEST_CONFIG[key];
    }) as jest.Mock,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JPEG magic bytes header. */
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]);
/** PNG magic bytes header. */
const pngBuffer = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(10).fill(0),
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBucketExists.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageService, { provide: ConfigService, useValue: buildMockConfigService() }],
    }).compile();

    service = module.get<StorageService>(StorageService);
    await service.onModuleInit();
  });

  // ── onModuleInit ────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('checks if the content bucket exists', async () => {
      expect(mockBucketExists).toHaveBeenCalledWith('content-images');
    });

    it('does not create the bucket when it already exists', async () => {
      expect(mockMakeBucket).not.toHaveBeenCalled();
    });

    it('creates the bucket when it does not exist', async () => {
      mockBucketExists.mockResolvedValueOnce(false);

      // Re-init with a fresh module
      const module: TestingModule = await Test.createTestingModule({
        providers: [StorageService, { provide: ConfigService, useValue: buildMockConfigService() }],
      }).compile();
      const svc = module.get<StorageService>(StorageService);
      await svc.onModuleInit();

      expect(mockMakeBucket).toHaveBeenCalledWith('content-images');
    });

    it('applies public-read policy after bucket is ready', async () => {
      expect(mockSetBucketPolicy).toHaveBeenCalledWith(
        'content-images',
        expect.stringContaining('"s3:GetObject"'),
      );
    });

    it('logs an error but does not throw when bucket setup fails', async () => {
      mockBucketExists.mockRejectedValueOnce(new Error('MinIO unavailable'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [StorageService, { provide: ConfigService, useValue: buildMockConfigService() }],
      }).compile();
      const svc = module.get<StorageService>(StorageService);

      await expect(svc.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── upload ──────────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('returns a url, key, and bucket for a valid JPEG upload', async () => {
      const result = await service.upload({
        buffer: jpegBuffer,
        mimeType: 'image/jpeg',
        originalName: 'photo.jpg',
      });

      expect(result.url).toMatch(/^http:\/\/localhost:9000\/content-images\//);
      expect(result.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/);
      expect(result.bucket).toBe('content-images');
    });

    it('calls putObject with correct bucket and metadata', async () => {
      await service.upload({
        buffer: pngBuffer,
        mimeType: 'image/png',
        originalName: 'image.png',
      });

      expect(mockPutObject).toHaveBeenCalledWith(
        'content-images',
        expect.stringMatching(/^\d{4}\/\d{2}\//),
        expect.anything(), // Readable stream
        pngBuffer.length,
        { 'Content-Type': 'image/png' },
      );
    });

    it('uses the extension derived from the MIME type, not the original filename', async () => {
      const result = await service.upload({
        buffer: jpegBuffer,
        mimeType: 'image/jpeg',
        originalName: 'dangerous-../../file.php', // path traversal attempt
      });

      expect(result.key).toMatch(/\.jpg$/);
      expect(result.key).not.toContain('.php');
      expect(result.key).not.toContain('..');
    });

    it('applies a PDF extension for application/pdf', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4' + '\0'.repeat(20));
      const result = await service.upload({
        buffer: pdfBuffer,
        mimeType: 'application/pdf',
        originalName: 'document.pdf',
      });

      expect(result.key).toMatch(/\.pdf$/);
    });

    it('uses the custom bucket when provided', async () => {
      const result = await service.upload({
        buffer: jpegBuffer,
        mimeType: 'image/jpeg',
        originalName: 'img.jpg',
        bucket: 'custom-bucket',
      });

      expect(result.bucket).toBe('custom-bucket');
      expect(mockPutObject).toHaveBeenCalledWith(
        'custom-bucket',
        expect.any(String),
        expect.anything(),
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('rejects with a timeout error when putObject hangs', async () => {
      jest.useFakeTimers();
      try {
        mockPutObject.mockImplementationOnce(() => new Promise(() => {})); // never resolves

        const uploadPromise = service.upload({
          buffer: jpegBuffer,
          mimeType: 'image/jpeg',
          originalName: 'timeout-test.jpg',
        });

        // Attach the rejection handler BEFORE advancing timers so the rejection
        // is never unhandled during the microtask flush inside advanceTimersByTimeAsync.
        const assertion = expect(uploadPromise).rejects.toThrow(/timeout/i);

        // Advance timers beyond OPERATION_TIMEOUT_MS (30 s) so the race rejects
        await jest.advanceTimersByTimeAsync(31_000);

        await assertion;
        expect(mockPutObject).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('calls removeObject with the correct bucket and key', async () => {
      await service.delete('2026/03/some-uuid.jpg');

      expect(mockRemoveObject).toHaveBeenCalledWith('content-images', '2026/03/some-uuid.jpg');
    });

    it('uses the custom bucket when provided', async () => {
      await service.delete('2026/03/some-uuid.jpg', 'other-bucket');

      expect(mockRemoveObject).toHaveBeenCalledWith('other-bucket', '2026/03/some-uuid.jpg');
    });
  });

  // ── MinIO client wiring ─────────────────────────────────────────────────────

  describe('client initialisation', () => {
    it('constructs the MinIO client with config values', () => {
      expect(Minio.Client).toHaveBeenCalledWith({
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'minioadmin',
        secretKey: 'changeme',
      });
    });
  });
});
