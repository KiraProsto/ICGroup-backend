import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { StorageService } from '../storage/storage.service.js';

/**
 * Verifies MinIO / S3 connectivity by checking that the content bucket is
 * reachable and exists.  Uses `StorageService.ping()` which applies a short
 * timeout so a degraded storage layer doesn't hold up the health endpoint.
 */
@Injectable()
export class StorageHealthIndicator {
  private readonly logger = new Logger(StorageHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly storage: StorageService,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const exists = await this.storage.ping();
      if (!exists) {
        return indicator.down({ message: 'Content bucket does not exist' });
      }
      return indicator.up();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Storage health check failed: ${msg}`);
      return indicator.down({ message: 'Storage unreachable' });
    }
  }
}
