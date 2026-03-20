import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  return {
    nodeEnv,
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    corsOrigins: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
    logLevel: process.env['LOG_LEVEL'] ?? (nodeEnv === 'production' ? 'info' : 'debug'),
  };
});
