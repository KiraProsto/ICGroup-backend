import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  corsOrigins: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
}));
