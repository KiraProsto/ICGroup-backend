import {
  Controller,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import { UploadMediaResponseDto } from './dto/upload-media-response.dto.js';
import { MimeTypeValidator } from './validators/mime-type.validator.js';

/** 5 MiB in bytes. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Allowed MIME types for content uploads.
 * SVG is intentionally excluded — it can embed JavaScript (XSS risk).
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
] as const;

/**
 * Handles file upload to object storage (MinIO in dev, S3 in prod).
 *
 * CASL policy matrix:
 *   POST /admin/content/media/upload → create MediaAsset (CM, SA)
 *
 * All routes sit behind the global JwtAuthGuard + PoliciesGuard.
 */
@ApiTags('admin/content/media')
@ApiBearerAuth('access-token')
@Controller('admin/content/media')
export class MediaController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Uploads a single file (max 5 MiB) to the content bucket and returns its
   * publicly accessible URL.
   *
   * Allowed MIME types: image/jpeg · image/png · image/webp · image/gif ·
   *   image/avif · application/pdf
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('create', 'MediaAsset'))
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // Keep file in memory — no disk writes
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Upload a media file (max 5 MiB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload (JPEG, PNG, WebP, GIF, AVIF, PDF — max 5 MiB)',
        },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: UploadMediaResponseDto, description: 'File uploaded successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions (CM or SA required)' })
  @ApiUnprocessableEntityResponse({ description: 'File type or size validation failed' })
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MimeTypeValidator({ allowedTypes: ALLOWED_MIME_TYPES })],
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    file: Express.Multer.File,
  ): Promise<UploadMediaResponseDto> {
    const result = await this.storageService.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    return {
      url: result.url,
      key: result.key,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
}
