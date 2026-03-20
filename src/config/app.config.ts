import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const isProdLike = nodeEnv === 'production' || nodeEnv === 'staging';
  return {
    nodeEnv,
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    corsOrigins: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
    logLevel: process.env['LOG_LEVEL'] ?? (isProdLike ? 'info' : 'debug'),
    trustProxy: process.env['TRUST_PROXY'] === 'true',
    swaggerEnabled: process.env['SWAGGER_ENABLED'] === 'true',
    // Max milliseconds to wait for in-flight requests / module destroy hooks
    // before the process is forcefully terminated on SIGTERM / SIGINT.
    shutdownTimeoutMs: parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '10000', 10),
  };
});
