import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  // Joi validates presence at startup; the non-null assertion is safe.
  accessSecret: process.env['JWT_ACCESS_SECRET']!,
  refreshSecret: process.env['JWT_REFRESH_SECRET']!,
  accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
  refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
}));
