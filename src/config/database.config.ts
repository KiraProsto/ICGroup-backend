import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env['DATABASE_URL'],
  poolMax: Number(process.env['DB_POOL_MAX'] ?? '10'),
  poolConnectTimeoutMs: Number(process.env['DB_POOL_CONNECT_TIMEOUT_MS'] ?? '3000'),
  poolIdleTimeoutMs: Number(process.env['DB_POOL_IDLE_TIMEOUT_MS'] ?? '10000'),
  statementTimeoutMs: Number(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '30000'),
}));
