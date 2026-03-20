import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60', 10),
  limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '120', 10),
  loginTtl: parseInt(process.env['THROTTLE_LOGIN_TTL'] ?? '60', 10),
  loginLimit: parseInt(process.env['THROTTLE_LOGIN_LIMIT'] ?? '5', 10),
}));
