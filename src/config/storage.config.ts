import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => {
  const endpoint = process.env['MINIO_ENDPOINT'] ?? 'localhost';
  const port = parseInt(process.env['MINIO_PORT'] ?? '9000', 10);
  const useSsl = process.env['MINIO_USE_SSL'] === 'true';
  const protocol = useSsl ? 'https' : 'http';
  const bucketContent = process.env['MINIO_BUCKET_CONTENT'] ?? 'content-images';

  // Public URL used to serve uploaded objects in HTTP responses.
  // In production set MINIO_PUBLIC_URL to your CDN / S3 bucket URL.
  // In dev it defaults to the MinIO S3 API endpoint.
  const publicUrl =
    process.env['MINIO_PUBLIC_URL']?.replace(/\/$/, '') ?? `${protocol}://${endpoint}:${port}`;

  return {
    endpoint,
    port,
    useSsl,
    accessKey: process.env['MINIO_ACCESS_KEY'],
    secretKey: process.env['MINIO_SECRET_KEY'],
    bucketContent,
    publicUrl,
  };
});
