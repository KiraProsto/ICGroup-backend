import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/**
 * StorageModule provides the MinIO / S3 client as a reusable service.
 *
 * Export StorageService so feature modules (News, Pages, Media) can inject
 * it for object storage operations without duplicating client configuration.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
