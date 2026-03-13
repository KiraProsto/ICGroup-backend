import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';

export interface UploadParams {
  /** Raw file buffer from multer. */
  buffer: Buffer;
  /** MIME type of the file (e.g. 'image/jpeg'). Already validated by the pipe. */
  mimeType: string;
  /** Original filename — used only to extract the extension safely. */
  originalName: string;
  /** Target bucket; defaults to storage.bucketContent when omitted. */
  bucket?: string;
}

export interface UploadResult {
  /** Storage key (object name) inside the bucket. */
  key: string;
  /** Publicly accessible URL that clients can use directly. */
  url: string;
  /** Content bucket where the object was stored. */
  bucket: string;
}

/** Maximum milliseconds to wait for a single MinIO operation. */
const OPERATION_TIMEOUT_MS = 30_000;

/**
 * Thin wrapper around the MinIO client.
 *
 * - Works with any S3-compatible store (MinIO in dev, AWS S3 in prod).
 * - On startup ensures the configured content bucket exists and carries
 *   a public-read policy so returned URLs work without signed tokens.
 * - Object keys use `{yyyy}/{MM}/{uuid}{ext}` — no original filename is
 *   stored in the path, preventing path-traversal and filename collisions.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Minio.Client;
  private readonly contentBucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Minio.Client({
      endPoint: config.getOrThrow<string>('storage.endpoint'),
      port: config.getOrThrow<number>('storage.port'),
      useSSL: config.getOrThrow<boolean>('storage.useSsl'),
      accessKey: config.getOrThrow<string>('storage.accessKey'),
      secretKey: config.getOrThrow<string>('storage.secretKey'),
    });

    this.contentBucket = config.getOrThrow<string>('storage.bucketContent');
    this.publicUrl = config.getOrThrow<string>('storage.publicUrl');
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.ensureBucketWithPublicPolicy(this.contentBucket);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Uploads a file buffer to the content bucket and returns its public URL.
   *
   * The object key is collision-resistant and path-traversal-safe:
   * `{yyyy}/{MM}/{uuid}{ext}` — the sanitised extension comes from the
   * validated MIME type mapping, NOT the client-supplied filename.
   */
  async upload(params: UploadParams): Promise<UploadResult> {
    const bucket = params.bucket ?? this.contentBucket;
    const ext = this.safeExtension(params.mimeType, params.originalName);
    const key = this.buildKey(ext);

    const stream = Readable.from(params.buffer);

    await this.withTimeout(
      this.client.putObject(bucket, key, stream, params.buffer.length, {
        'Content-Type': params.mimeType,
      }),
      OPERATION_TIMEOUT_MS,
      `putObject timeout: ${bucket}/${key}`,
    );

    const url = `${this.publicUrl}/${bucket}/${key}`;
    this.logger.log(`Uploaded ${key} (${params.buffer.length} bytes) → ${url}`);
    return { key, url, bucket };
  }

  /**
   * Deletes an object from the specified bucket (or the default content bucket).
   * Non-fatal: logs a warning if the object does not exist.
   */
  async delete(key: string, bucket?: string): Promise<void> {
    const targetBucket = bucket ?? this.contentBucket;
    await this.withTimeout(
      this.client.removeObject(targetBucket, key),
      OPERATION_TIMEOUT_MS,
      `removeObject timeout: ${targetBucket}/${key}`,
    );
    this.logger.log(`Deleted ${targetBucket}/${key}`);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Ensures the bucket exists and carries a public-read policy.
   * Called once on module initialisation; safe to call multiple times.
   */
  private async ensureBucketWithPublicPolicy(bucket: string): Promise<void> {
    try {
      const exists = await this.client.bucketExists(bucket);
      if (!exists) {
        await this.client.makeBucket(bucket);
        this.logger.log(`Created bucket: ${bucket}`);
      }
      await this.applyPublicReadPolicy(bucket);
    } catch (err) {
      // Non-fatal during startup — log the error and continue.
      // The healthcheck endpoint will surface storage connectivity issues.
      this.logger.error(`Failed to initialise bucket "${bucket}"`, err);
    }
  }

  /** Applies an S3-compatible public-read policy to the bucket. */
  private async applyPublicReadPolicy(bucket: string): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    };
    await this.client.setBucketPolicy(bucket, JSON.stringify(policy));
  }

  /**
   * Builds a safe storage key: `{yyyy}/{MM}/{uuid}{ext}`.
   * Uses current UTC date for simple time-based sharding.
   */
  private buildKey(ext: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}/${mm}/${uuidv4()}${ext}`;
  }

  /**
   * Returns a dot-prefixed, allowlisted extension derived from the MIME type.
   * Falls back to the original filename extension only when the MIME type
   * is not in the allowlist — and strips any path components to prevent
   * path-traversal attacks.
   */
  private safeExtension(mimeType: string, originalName: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/avif': '.avif',
      'application/pdf': '.pdf',
    };

    if (mimeToExt[mimeType]) {
      return mimeToExt[mimeType];
    }

    // Fallback: strip directory components and retrieve the extension only.
    const rawExt = extname(originalName.replace(/.*[/\\]/, ''));
    // Only allow safe single extensions: letters, max 6 chars.
    return /^\.[a-zA-Z]{1,6}$/.test(rawExt) ? rawExt.toLowerCase() : '';
  }

  /** Wraps a promise with a timeout to avoid hanging indefinitely on storage calls. */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
    ]);
  }
}
