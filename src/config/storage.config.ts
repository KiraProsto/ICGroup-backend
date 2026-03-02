import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: parseInt(process.env['MINIO_PORT'] ?? '9000', 10),
  useSsl: process.env['MINIO_USE_SSL'] === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'],
  secretKey: process.env['MINIO_SECRET_KEY'],
  bucketContent: process.env['MINIO_BUCKET_CONTENT'] ?? 'content-images',
}));
