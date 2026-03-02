import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env['DATABASE_URL'],
  poolMax: parseInt(process.env['DB_POOL_MAX'] ?? '10', 10),
  poolConnectTimeoutMs: parseInt(process.env['DB_POOL_CONNECT_TIMEOUT_MS'] ?? '3000', 10),
  poolIdleTimeoutMs: parseInt(process.env['DB_POOL_IDLE_TIMEOUT_MS'] ?? '10000', 10),
}));
