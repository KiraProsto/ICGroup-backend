import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { MediaController } from './media.controller.js';

/**
 * MediaModule exposes the `POST /admin/content/media/upload` endpoint.
 *
 * Auth:    JwtAuthGuard (global, from AuthModule)
 * RBAC:    PoliciesGuard (global, from CaslModule) + @CheckPolicies per route
 * Storage: StorageModule (MinIO/S3 client)
 */
@Module({
  imports: [StorageModule],
  controllers: [MediaController],
})
export class MediaModule {}
