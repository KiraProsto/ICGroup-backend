import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  /** Window duration in seconds — converted to ms when passed to ThrottlerModule. */
  ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60', 10),
  limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '120', 10),
  /** Window duration in seconds — applied only to routes annotated with @Throttle({ login: {} }). */
  loginTtl: parseInt(process.env['THROTTLE_LOGIN_TTL'] ?? '60', 10),
  loginLimit: parseInt(process.env['THROTTLE_LOGIN_LIMIT'] ?? '5', 10),
}));
