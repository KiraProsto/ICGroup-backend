import { ApiProperty } from '@nestjs/swagger';

/**
 * Response returned by `POST /admin/content/media/upload`.
 */
export class UploadMediaResponseDto {
  @ApiProperty({
    description: 'Publicly accessible URL of the uploaded file.',
    example: 'http://localhost:9000/content-images/2026/03/a1b2c3d4-....jpg',
  })
  url!: string;

  @ApiProperty({
    description: 'Object storage key (path inside the bucket).',
    example: '2026/03/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg',
  })
  key!: string;

  @ApiProperty({
    description: 'MIME type of the uploaded file.',
    example: 'image/jpeg',
  })
  mimeType!: string;

  @ApiProperty({
    description: 'Size of the uploaded file in bytes.',
    example: 204800,
  })
  size!: number;
}
